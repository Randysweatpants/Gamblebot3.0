/**
 * NHL Data Pipeline
 * Orchestrates fetching from:
 *   1. The Odds API → real sportsbook player prop odds
 *   2. NHL Stats API → real player game logs & roster data
 * Then seeds the database for EV calculations.
 */

import { db, gamesTable, playersTable, playerGameLogsTable, propsTable, sportsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { getAllNHLPropsToday, type NormalizedPlayerProp } from "../odds-api.js";
import {
  getTodaysNHLSchedule,
  buildGameRosterMap,
  getNHLPlayerGameLog,
  type NHLGame,
  type NHLGameLogEntry,
} from "./nhl-stats-api.js";

const TODAY = () => new Date().toISOString().split("T")[0];

const NHL_SPORT = {
  id: "NHL",
  name: "National Hockey League",
  league: "NHL",
  active: true,
  markets: ["points", "assists", "shots_on_goal", "goals"],
};

/**
 * Build a URL-safe slug from a player name
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Convert NHL API game log entry to our DB format
 */
function convertGameLog(
  log: NHLGameLogEntry,
  playerSlug: string
) {
  return {
    player_slug: playerSlug,
    sport: "NHL",
    game_date: log.gameDate,
    opponent: log.opponentAbbrev,
    opponent_abbr: log.opponentAbbrev,
    home_away: log.homeRoadFlag === "H" ? "home" : "away",
    result: "W", // We don't have W/L per player — use score context if needed
    goals: log.goals,
    assists: log.assists,
    points: log.points,
    shots_on_goal: log.shots,
    toi: log.toi,
    pp_toi: null,
    plus_minus: log.plusMinus,
    ev_goals: null,
    ev_assists: null,
  };
}

/**
 * Main pipeline: fetch real data and seed the database
 */
export async function runNHLDataPipeline(): Promise<{
  games: number;
  players: number;
  props: number;
  errors: string[];
}> {
  const today = TODAY();
  const errors: string[] = [];
  let propCount = 0;
  let playerCount = 0;
  let gameCount = 0;

  console.log(`[Pipeline] Starting NHL data pipeline for ${today}`);

  // ── 1. Upsert sport ──────────────────────────────────────────────────
  await db.insert(sportsTable).values(NHL_SPORT).onConflictDoUpdate({
    target: sportsTable.id,
    set: { active: true, markets: NHL_SPORT.markets },
  });

  // ── 2. Fetch real odds from The Odds API ─────────────────────────────
  console.log("[Pipeline] Fetching odds from The Odds API...");
  let oddsEvents: Awaited<ReturnType<typeof getAllNHLPropsToday>>["events"] = [];
  let normalizedProps: NormalizedPlayerProp[] = [];

  try {
    const oddsData = await getAllNHLPropsToday();
    oddsEvents = oddsData.events;
    normalizedProps = oddsData.props;
    console.log(
      `[Pipeline] Got ${oddsEvents.length} events, ${normalizedProps.length} unique props`
    );
  } catch (err) {
    const msg = `Failed to fetch from Odds API: ${err}`;
    console.error("[Pipeline]", msg);
    errors.push(msg);
    return { games: 0, players: 0, props: 0, errors };
  }

  if (normalizedProps.length === 0) {
    errors.push("No props returned from Odds API — market may not be open yet");
    return { games: 0, players: 0, props: 0, errors };
  }

  // ── 3. Fetch today's schedule from NHL Stats API ──────────────────────
  console.log("[Pipeline] Fetching schedule from NHL Stats API...");
  let scheduleDay: Awaited<ReturnType<typeof getTodaysNHLSchedule>> = null;

  try {
    scheduleDay = await getTodaysNHLSchedule(today);
  } catch (err) {
    const msg = `Failed to fetch NHL schedule: ${err}`;
    console.error("[Pipeline]", msg);
    errors.push(msg);
  }

  // Build a map of team names → abbrev from The Odds API events
  // (Odds API uses full team names, NHL Stats API uses abbreviations)
  const teamNameToAbbrev = new Map<string, string>();
  if (scheduleDay) {
    for (const game of scheduleDay.games) {
      teamNameToAbbrev.set(
        game.homeTeam.commonName?.default?.toLowerCase() ?? "",
        game.homeTeam.abbrev
      );
      teamNameToAbbrev.set(
        game.awayTeam.commonName?.default?.toLowerCase() ?? "",
        game.awayTeam.abbrev
      );
      // Also map full name variations (e.g. "New Jersey Devils" → "NJD")
      teamNameToAbbrev.set(game.homeTeam.abbrev.toLowerCase(), game.homeTeam.abbrev);
      teamNameToAbbrev.set(game.awayTeam.abbrev.toLowerCase(), game.awayTeam.abbrev);
    }
  }

  // Helper: resolve team abbrev from Odds API full name
  function resolveTeamAbbrev(fullName: string): string | null {
    // Try direct NHL schedule lookup
    if (scheduleDay) {
      for (const game of scheduleDay.games) {
        if (
          game.homeTeam.commonName?.default &&
          fullName.includes(game.homeTeam.commonName.default)
        )
          return game.homeTeam.abbrev;
        if (
          game.awayTeam.commonName?.default &&
          fullName.includes(game.awayTeam.commonName.default)
        )
          return game.awayTeam.abbrev;
      }
    }
    // Fallback: look up from Odds API event data
    for (const event of oddsEvents) {
      if (event.home_team === fullName || event.away_team === fullName) {
        // Match via known mappings
        const parts = fullName.split(" ");
        const city = parts.slice(0, -1).join(" ");
        const teamName = parts[parts.length - 1];
        // Use NHL team name map
        return NHL_TEAM_NAME_MAP[fullName] ?? null;
      }
    }
    return null;
  }

  // ── 4. Upsert games ───────────────────────────────────────────────────
  const oddsEventById = new Map(oddsEvents.map((e) => [e.id, e]));

  for (const event of oddsEvents) {
    const homeAbbrev = resolveTeamAbbrev(event.home_team);
    const awayAbbrev = resolveTeamAbbrev(event.away_team);

    // Find matching NHL schedule game for venue/time
    let nhlGame: NHLGame | null = null;
    if (scheduleDay) {
      nhlGame =
        scheduleDay.games.find(
          (g) =>
            (g.homeTeam.abbrev === homeAbbrev || g.awayTeam.abbrev === awayAbbrev) &&
            (g.homeTeam.abbrev === awayAbbrev || g.awayTeam.abbrev === homeAbbrev ||
              homeAbbrev == null)
        ) ?? null;
    }

    const gameTime = event.commence_time
      ? new Date(event.commence_time).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
          hour12: true,
        }) + " ET"
      : "TBD";

    await db
      .insert(gamesTable)
      .values({
        sport: "NHL",
        event_id: event.id,
        home_team: event.home_team,
        away_team: event.away_team,
        home_team_abbr: homeAbbrev ?? event.home_team.split(" ").pop() ?? "UNK",
        away_team_abbr: awayAbbrev ?? event.away_team.split(" ").pop() ?? "UNK",
        game_date: today,
        game_time: gameTime,
        venue: nhlGame?.venue?.default ?? "",
        status: nhlGame?.gameState?.toLowerCase() ?? "scheduled",
      })
      .onConflictDoUpdate({
        target: gamesTable.event_id,
        set: {
          status: nhlGame?.gameState?.toLowerCase() ?? "scheduled",
          updated_at: new Date(),
        },
      });
    gameCount++;
  }

  console.log(`[Pipeline] Upserted ${gameCount} games`);

  // ── 5. Build player-to-game mapping from props ────────────────────────
  // Group props by event so we can fetch rosters per game
  const propsByEvent = new Map<string, NormalizedPlayerProp[]>();
  for (const prop of normalizedProps) {
    if (!propsByEvent.has(prop.eventId)) propsByEvent.set(prop.eventId, []);
    propsByEvent.get(prop.eventId)!.push(prop);
  }

  // ── 6. For each game: fetch rosters, match players, fetch game logs ───
  const playerIdCache = new Map<string, number>(); // playerSlug → NHL player ID
  const playerDataCache = new Map<
    string,
    { id: number; team: string; position: string; firstName: string; lastName: string }
  >();

  for (const [eventId, eventProps] of propsByEvent.entries()) {
    const event = oddsEventById.get(eventId);
    if (!event) continue;

    const homeAbbrev = resolveTeamAbbrev(event.home_team);
    const awayAbbrev = resolveTeamAbbrev(event.away_team);

    if (!homeAbbrev || !awayAbbrev) {
      console.warn(
        `[Pipeline] Cannot resolve team abbrevs for event ${eventId}: ${event.home_team} vs ${event.away_team}`
      );
      errors.push(
        `Cannot resolve team abbreviations for ${event.home_team} vs ${event.away_team}`
      );
      continue;
    }

    let rosterMap: Awaited<ReturnType<typeof buildGameRosterMap>>;
    try {
      rosterMap = await buildGameRosterMap(homeAbbrev, awayAbbrev);
    } catch (err) {
      console.error(
        `[Pipeline] Failed to fetch roster for ${homeAbbrev} vs ${awayAbbrev}:`,
        err
      );
      errors.push(`Failed to fetch roster: ${homeAbbrev} vs ${awayAbbrev}`);
      continue;
    }

    // Unique player names in this game's props
    const playerNames = [...new Set(eventProps.map((p) => p.playerName))];

    for (const playerName of playerNames) {
      const slug = slugify(playerName);
      if (playerIdCache.has(slug)) continue; // already processed

      // Match against roster
      const normalizedName = playerName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z ]/g, "")
        .trim();

      const rosterPlayer = rosterMap.get(normalizedName);

      if (!rosterPlayer) {
        console.warn(`[Pipeline] No roster match for "${playerName}"`);
        errors.push(`No roster match for player: ${playerName}`);
        continue;
      }

      playerIdCache.set(slug, rosterPlayer.id);
      playerDataCache.set(slug, {
        id: rosterPlayer.id,
        team: rosterPlayer.team,
        position: rosterPlayer.positionCode,
        firstName: rosterPlayer.firstName.default,
        lastName: rosterPlayer.lastName.default,
      });

      // Upsert player
      const teamAbbrev = rosterPlayer.team;
      const teamFullName =
        teamAbbrev === homeAbbrev ? event.home_team : event.away_team;

      await db
        .insert(playersTable)
        .values({
          sport: "NHL",
          player_slug: slug,
          player_name: playerName,
          team: teamFullName,
          team_abbr: teamAbbrev,
          position: rosterPlayer.positionCode,
        })
        .onConflictDoUpdate({
          target: playersTable.player_slug,
          set: {
            team: teamFullName,
            team_abbr: teamAbbrev,
            updated_at: new Date(),
          },
        });
      playerCount++;

      // Fetch and store game log from NHL Stats API
      try {
        const logs = await getNHLPlayerGameLog(rosterPlayer.id);
        const recent = logs.slice(0, 20); // last 20 games

        for (const log of recent) {
          const entry = convertGameLog(log, slug);
          await db
            .insert(playerGameLogsTable)
            .values(entry)
            .onConflictDoNothing();
        }
        console.log(
          `[Pipeline] ${playerName} (${teamAbbrev}): ${recent.length} game log entries`
        );
      } catch (err) {
        console.error(
          `[Pipeline] Failed to fetch game log for ${playerName} (id=${rosterPlayer.id}):`,
          err
        );
        errors.push(`Failed to fetch game log for ${playerName}`);
      }
    }
  }

  // ── 7. Clear today's existing props and re-insert from Odds API ───────
  // Delete today's existing NHL props before fresh insert
  await db
    .delete(propsTable)
    .where(and(eq(propsTable.sport, "NHL"), eq(propsTable.game_date, today)));

  // ── 8. Insert normalized props ────────────────────────────────────────
  for (const prop of normalizedProps) {
    const slug = slugify(prop.playerName);
    const playerData = playerDataCache.get(slug);

    if (!playerData) continue; // Skip unmatched players

    const event = oddsEventById.get(prop.eventId);
    if (!event) continue;

    const homeAbbrev = resolveTeamAbbrev(event.home_team);
    const awayAbbrev = resolveTeamAbbrev(event.away_team);
    const playerTeamAbbrev = playerData.team;
    const opponentAbbrev =
      playerTeamAbbrev === homeAbbrev ? awayAbbrev : homeAbbrev;
    const opponentFullName =
      playerTeamAbbrev === homeAbbrev ? event.away_team : event.home_team;
    const homeAway = playerTeamAbbrev === homeAbbrev ? "home" : "away";

    await db.insert(propsTable).values({
      sport: "NHL",
      event_id: prop.eventId,
      game_date: today,
      player_slug: slug,
      player_name: prop.playerName,
      team: playerTeamAbbrev === homeAbbrev ? event.home_team : event.away_team,
      team_abbr: playerTeamAbbrev,
      opponent: opponentFullName ?? "",
      opponent_abbr: opponentAbbrev ?? "",
      market: prop.market,
      line: prop.line,
      sportsbook: prop.sportsbookTitle,
      over_odds: prop.overOdds,
      under_odds: prop.underOdds,
      home_away: homeAway,
      is_back_to_back: false,
    }).onConflictDoNothing();
    propCount++;
  }

  console.log(
    `[Pipeline] Done. Games: ${gameCount}, Players: ${playerCount}, Props: ${propCount}, Errors: ${errors.length}`
  );
  return { games: gameCount, players: playerCount, props: propCount, errors };
}

// Full team name → abbreviation mapping for The Odds API
const NHL_TEAM_NAME_MAP: Record<string, string> = {
  "Anaheim Ducks": "ANA",
  "Arizona Coyotes": "ARI",
  "Boston Bruins": "BOS",
  "Buffalo Sabres": "BUF",
  "Calgary Flames": "CGY",
  "Carolina Hurricanes": "CAR",
  "Chicago Blackhawks": "CHI",
  "Colorado Avalanche": "COL",
  "Columbus Blue Jackets": "CBJ",
  "Dallas Stars": "DAL",
  "Detroit Red Wings": "DET",
  "Edmonton Oilers": "EDM",
  "Florida Panthers": "FLA",
  "Los Angeles Kings": "LAK",
  "Minnesota Wild": "MIN",
  "Montreal Canadiens": "MTL",
  "Nashville Predators": "NSH",
  "New Jersey Devils": "NJD",
  "New York Islanders": "NYI",
  "New York Rangers": "NYR",
  "Ottawa Senators": "OTT",
  "Philadelphia Flyers": "PHI",
  "Pittsburgh Penguins": "PIT",
  "San Jose Sharks": "SJS",
  "Seattle Kraken": "SEA",
  "St. Louis Blues": "STL",
  "Tampa Bay Lightning": "TBL",
  "Toronto Maple Leafs": "TOR",
  "Utah Hockey Club": "UTA",
  "Vancouver Canucks": "VAN",
  "Vegas Golden Knights": "VGK",
  "Washington Capitals": "WSH",
  "Winnipeg Jets": "WPG",
};
