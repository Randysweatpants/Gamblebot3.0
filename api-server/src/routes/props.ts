import { Router, type IRouter } from "express";
import { db, propsTable, playerGameLogsTable, projectionsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { computeProjection, generateMatchupNotes, type Market } from "../services/nhl/projection-engine.js";
import {
  americanToImplied,
  devig,
  calculateEV,
  projectionToFairProbs,
  calculateConfidence,
} from "../services/ev-calculator.js";
import { OPPONENT_ADJUSTMENTS } from "../services/nhl/seed-data.js";

const router: IRouter = Router();

async function buildPropResult(prop: typeof propsTable.$inferSelect) {
  // Fetch game logs for this player
  const logs = await db
    .select()
    .from(playerGameLogsTable)
    .where(
      and(
        eq(playerGameLogsTable.player_slug, prop.player_slug),
        eq(playerGameLogsTable.sport, prop.sport)
      )
    )
    .orderBy(sql`${playerGameLogsTable.game_date} DESC`)
    .limit(20);

  const market = prop.market as Market;
  const opponentAdj = OPPONENT_ADJUSTMENTS[prop.opponent_abbr]?.[market] ?? 0;

  const projData = computeProjection({
    gameLogs: logs,
    market,
    opponentAdj,
    usageAdj: 0,
    isBackToBack: prop.is_back_to_back ?? false,
    homeAway: (prop.home_away as "home" | "away") ?? "home",
  });

  const { projection, last5Avg, last10Avg, seasonAvg } = projData;

  // Calculate probabilities
  let fairOverProb: number | null = null;
  let fairUnderProb: number | null = null;
  let impliedOverProb: number | null = null;
  let impliedUnderProb: number | null = null;
  let evOver: number | null = null;
  let evUnder: number | null = null;
  let bestSide: string | null = null;
  let bestEV: number | null = null;

  if (projection > 0) {
    const fairProbs = projectionToFairProbs(projection, prop.line);
    fairOverProb = Math.round(fairProbs.fairOver * 10000) / 10000;
    fairUnderProb = Math.round(fairProbs.fairUnder * 10000) / 10000;

    if (prop.over_odds != null && prop.under_odds != null) {
      const rawImpliedOver = americanToImplied(prop.over_odds);
      const rawImpliedUnder = americanToImplied(prop.under_odds);
      const devigged = devig(rawImpliedOver, rawImpliedUnder);
      impliedOverProb = Math.round(devigged.over * 10000) / 10000;
      impliedUnderProb = Math.round(devigged.under * 10000) / 10000;

      evOver = Math.round(calculateEV(fairOverProb, prop.over_odds) * 10000) / 10000;
      evUnder = Math.round(calculateEV(fairUnderProb, prop.under_odds) * 10000) / 10000;

      if (evOver >= evUnder) {
        bestSide = "over";
        bestEV = evOver;
      } else {
        bestSide = "under";
        bestEV = evUnder;
      }
    }
  }

  const confidence = projection > 0
    ? calculateConfidence({
        gamesPlayed: logs.length,
        projection,
        line: prop.line,
        bestEV: bestEV ?? 0,
        opponentAdjAvailable: opponentAdj !== 0,
      })
    : null;

  const matchupNotes =
    projection > 0 && evOver != null && evUnder != null
      ? generateMatchupNotes({
          playerName: prop.player_name,
          team: prop.team_abbr,
          opponent: prop.opponent_abbr,
          market,
          projection,
          line: prop.line,
          last5Avg,
          last10Avg,
          seasonAvg,
          opponentAdj,
          homeAway: prop.home_away ?? "home",
          isBackToBack: prop.is_back_to_back ?? false,
          evOver,
          evUnder,
        })
      : null;

  // Find game time from games table (cached lookup - we'll get it from games)
  const gameEventId = prop.event_id;
  const homeAway = prop.home_away === "home" ? "home" : "away";
  const gameStr = homeAway === "home"
    ? `${prop.opponent_abbr} @ ${prop.team_abbr}`
    : `${prop.team_abbr} @ ${prop.opponent_abbr}`;

  return {
    id: prop.id,
    sport: prop.sport,
    event_id: prop.event_id,
    game: gameStr,
    game_time: "",
    player_name: prop.player_name,
    player_slug: prop.player_slug,
    team: prop.team,
    team_abbr: prop.team_abbr,
    opponent: prop.opponent,
    opponent_abbr: prop.opponent_abbr,
    market: prop.market,
    line: prop.line,
    sportsbook: prop.sportsbook,
    over_odds: prop.over_odds ?? null,
    under_odds: prop.under_odds ?? null,
    projection: projection > 0 ? projection : null,
    implied_over_probability: impliedOverProb,
    implied_under_probability: impliedUnderProb,
    fair_over_probability: fairOverProb,
    fair_under_probability: fairUnderProb,
    ev_over: evOver,
    ev_under: evUnder,
    best_side: bestSide,
    best_ev: bestEV,
    confidence,
    matchup_notes: matchupNotes,
    last_5_avg: last5Avg > 0 ? last5Avg : null,
    last_10_avg: last10Avg > 0 ? last10Avg : null,
    season_avg: seasonAvg > 0 ? seasonAvg : null,
    home_away: prop.home_away ?? null,
    is_back_to_back: prop.is_back_to_back ?? null,
  };
}

router.get("/props", async (req, res) => {
  try {
    const sport = (req.query.sport as string) || "NHL";
    const market = req.query.market as string | undefined;
    const sportsbook = req.query.sportsbook as string | undefined;
    const team = req.query.team as string | undefined;
    const minEV = req.query.min_ev ? Number(req.query.min_ev) : undefined;
    const gameId = req.query.game_id ? Number(req.query.game_id) : undefined;
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

    let query = db
      .select()
      .from(propsTable)
      .where(and(eq(propsTable.sport, sport), eq(propsTable.game_date, date)));

    const rawProps = await query;

    // Build results with EV calculations
    const results = await Promise.all(rawProps.map(buildPropResult));

    // Apply post-calculation filters
    let filtered = results;
    if (market) filtered = filtered.filter((p) => p.market === market);
    if (sportsbook) filtered = filtered.filter((p) => p.sportsbook === sportsbook);
    if (team) filtered = filtered.filter((p) => p.team_abbr === team || p.team === team);
    if (minEV !== undefined) filtered = filtered.filter((p) => (p.best_ev ?? -Infinity) >= minEV);

    res.json({
      props: filtered,
      total: filtered.length,
      sport,
      date,
    });
  } catch (err) {
    console.error("GET /props error:", err);
    res.status(500).json({ error: "Failed to fetch props", detail: String(err) });
  }
});

router.get("/top-ev-picks", async (req, res) => {
  try {
    const sport = (req.query.sport as string) || "NHL";
    const limit = Number(req.query.limit) || 20;
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

    const rawProps = await db
      .select()
      .from(propsTable)
      .where(and(eq(propsTable.sport, sport), eq(propsTable.game_date, date)));

    const results = await Promise.all(rawProps.map(buildPropResult));

    // Sort by EV descending
    const sorted = results.filter((p) => p.best_ev != null).sort((a, b) => (b.best_ev ?? 0) - (a.best_ev ?? 0));

    const topOver = sorted.filter((p) => p.best_side === "over").slice(0, limit);
    const topUnder = sorted.filter((p) => p.best_side === "under").slice(0, limit);

    const markets = ["points", "assists", "shots_on_goal"];
    const topByMarket: Record<string, typeof results> = {};
    for (const m of markets) {
      topByMarket[m] = sorted.filter((p) => p.market === m).slice(0, 5);
    }

    res.json({
      top_over: topOver.slice(0, 10),
      top_under: topUnder.slice(0, 10),
      top_by_market: topByMarket,
      date,
      sport,
    });
  } catch (err) {
    console.error("GET /top-ev-picks error:", err);
    res.status(500).json({ error: "Failed to fetch top EV picks", detail: String(err) });
  }
});

export default router;
