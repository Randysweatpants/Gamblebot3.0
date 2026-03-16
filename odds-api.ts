/**
 * The Odds API Client
 * https://the-odds-api.com
 * Fetches real sportsbook player prop odds for NHL
 */

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "icehockey_nhl";

function getApiKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY environment variable is not set");
  return key;
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface OddsApiOutcome {
  name: "Over" | "Under";
  description: string; // player name
  price: number;       // American odds
  point: number;       // the line
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEventOdds extends OddsApiEvent {
  bookmakers: OddsApiBookmaker[];
}

export interface NormalizedPlayerProp {
  playerName: string;
  market: "points" | "assists" | "shots_on_goal" | "goals";
  line: number;
  sportsbook: string;
  sportsbookTitle: string;
  overOdds: number | null;
  underOdds: number | null;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
}

// Mapping from Odds API market keys → PropEdge market names
const MARKET_MAP: Record<string, "points" | "assists" | "shots_on_goal" | "goals"> = {
  player_points_alternate: "points",
  player_assists_alternate: "assists",
  player_goals_alternate: "goals",
  player_shots_on_goal_alternate: "shots_on_goal",
  // Standard (non-alternate) markets if available
  player_points: "points",
  player_assists: "assists",
  player_goals: "goals",
  player_shots_on_goal: "shots_on_goal",
};

// Markets to request from The Odds API (in priority order)
export const NHL_PROP_MARKETS = [
  "player_points_alternate",
  "player_assists_alternate",
  "player_goals_alternate",
  "player_shots_on_goal_alternate",
];

// Sportsbooks to prefer (ordered by reliability/availability)
const PREFERRED_BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "pointsbetus",
  "betrivers",
  "williamhill_us",
];

async function oddsApiFetch<T>(path: string): Promise<T> {
  const apiKey = getApiKey();
  const url = `${ODDS_API_BASE}${path}`;
  const fullUrl = url.includes("?") ? `${url}&apiKey=${apiKey}` : `${url}?apiKey=${apiKey}`;
  const res = await fetch(fullUrl);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odds API error ${res.status}: ${text}`);
  }
  // Log remaining quota
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  if (remaining) console.log(`[OddsAPI] Requests remaining: ${remaining} (used: ${used})`);
  return res.json() as Promise<T>;
}

/**
 * Get today's NHL events
 */
export async function getNHLEvents(): Promise<OddsApiEvent[]> {
  return oddsApiFetch<OddsApiEvent[]>(`/sports/${SPORT_KEY}/events`);
}

/**
 * Get player prop odds for a specific event
 */
export async function getEventPlayerProps(
  eventId: string,
  markets: string[] = NHL_PROP_MARKETS
): Promise<OddsApiEventOdds> {
  const marketsParam = markets.join(",");
  return oddsApiFetch<OddsApiEventOdds>(
    `/sports/${SPORT_KEY}/events/${eventId}/odds?regions=us&oddsFormat=american&markets=${marketsParam}`
  );
}

/**
 * Normalize Odds API outcomes into PropEdge format
 * For alternate markets: "Over" outcomes only → we need to synthesize Under from Over's odds
 * For standard markets: matched Over/Under pairs per player+line
 */
export function normalizeEventProps(eventOdds: OddsApiEventOdds): NormalizedPlayerProp[] {
  const results: NormalizedPlayerProp[] = [];

  for (const bookmaker of eventOdds.bookmakers) {
    // Prefer specific sportsbooks
    for (const market of bookmaker.markets) {
      const mappedMarket = MARKET_MAP[market.key];
      if (!mappedMarket) continue;

      const isAlternate = market.key.includes("_alternate");

      if (isAlternate) {
        // Alternate markets: group by player → each player has multiple lines
        // Pick the most relevant line (closest to 0.5 / 1.5 common standard lines)
        const byPlayer = new Map<string, OddsApiOutcome[]>();
        for (const outcome of market.outcomes) {
          const player = outcome.description;
          if (!byPlayer.has(player)) byPlayer.set(player, []);
          byPlayer.get(player)!.push(outcome);
        }

        for (const [playerName, outcomes] of byPlayer.entries()) {
          // For alternate markets, standard lines are 0.5, 1.5, 2.5...
          // Find the most liquid line (typically 0.5 for assists, 1.5 for points)
          const sorted = outcomes.slice().sort((a, b) => a.point - b.point);
          // Pick the smallest standard line (most likely to be priced near -110 to -130)
          const bestLine = sorted.find((o) =>
            [0.5, 1.5, 2.5, 3.5, 4.5].includes(o.point)
          ) ?? sorted[0];

          if (!bestLine) continue;

          results.push({
            playerName,
            market: mappedMarket,
            line: bestLine.point,
            sportsbook: bookmaker.key,
            sportsbookTitle: bookmaker.title,
            overOdds: bestLine.name === "Over" ? bestLine.price : null,
            underOdds: bestLine.name === "Under" ? bestLine.price : null,
            eventId: eventOdds.id,
            homeTeam: eventOdds.home_team,
            awayTeam: eventOdds.away_team,
            commenceTime: eventOdds.commence_time,
          });
        }
      } else {
        // Standard markets: group by player+line → pair Over and Under
        const byPlayerLine = new Map<string, Partial<NormalizedPlayerProp>>();

        for (const outcome of market.outcomes) {
          const key = `${outcome.description}|${outcome.point}`;
          if (!byPlayerLine.has(key)) {
            byPlayerLine.set(key, {
              playerName: outcome.description,
              market: mappedMarket,
              line: outcome.point,
              sportsbook: bookmaker.key,
              sportsbookTitle: bookmaker.title,
              eventId: eventOdds.id,
              homeTeam: eventOdds.home_team,
              awayTeam: eventOdds.away_team,
              commenceTime: eventOdds.commence_time,
            });
          }
          const entry = byPlayerLine.get(key)!;
          if (outcome.name === "Over") entry.overOdds = outcome.price;
          if (outcome.name === "Under") entry.underOdds = outcome.price;
        }

        for (const prop of byPlayerLine.values()) {
          results.push(prop as NormalizedPlayerProp);
        }
      }
    }
  }

  return results;
}

/**
 * Deduplicate props: keep best sportsbook per player+market+line combo
 * Priority: preferred sportsbooks → most complete odds (has both over/under)
 */
export function deduplicateProps(props: NormalizedPlayerProp[]): NormalizedPlayerProp[] {
  const byKey = new Map<string, NormalizedPlayerProp>();

  for (const prop of props) {
    const key = `${prop.playerName}|${prop.market}|${prop.line}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, prop);
      continue;
    }
    // Prefer props with both over and under odds
    const existingComplete = existing.overOdds != null && existing.underOdds != null;
    const newComplete = prop.overOdds != null && prop.underOdds != null;
    if (newComplete && !existingComplete) {
      byKey.set(key, prop);
      continue;
    }
    // Prefer higher-ranked sportsbook
    const existingRank = PREFERRED_BOOKS.indexOf(existing.sportsbook);
    const newRank = PREFERRED_BOOKS.indexOf(prop.sportsbook);
    if (newRank !== -1 && (existingRank === -1 || newRank < existingRank)) {
      byKey.set(key, prop);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Get all NHL player props for all today's events in one sweep
 */
export async function getAllNHLPropsToday(): Promise<{
  events: OddsApiEvent[];
  props: NormalizedPlayerProp[];
}> {
  const events = await getNHLEvents();
  if (events.length === 0) return { events: [], props: [] };

  const allProps: NormalizedPlayerProp[] = [];

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Fetch props for each event with a delay to avoid rate limiting (429)
  for (const event of events) {
    try {
      const eventOdds = await getEventPlayerProps(event.id);
      const props = normalizeEventProps(eventOdds);
      allProps.push(...props);
      console.log(
        `[OddsAPI] ${event.away_team} @ ${event.home_team}: ${props.length} raw props`
      );
      // Throttle: Odds API free tier has 1 req/second rate limit
      await delay(1100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("EXCEEDED_FREQ_LIMIT")) {
        console.warn(`[OddsAPI] Rate limited on event ${event.id} — waiting 3s and retrying`);
        await delay(3000);
        try {
          const eventOdds = await getEventPlayerProps(event.id);
          const props = normalizeEventProps(eventOdds);
          allProps.push(...props);
          console.log(`[OddsAPI] Retry OK: ${event.away_team} @ ${event.home_team}: ${props.length} raw props`);
          await delay(1100);
        } catch (retryErr) {
          console.error(`[OddsAPI] Retry failed for event ${event.id}:`, retryErr);
        }
      } else {
        console.error(`[OddsAPI] Failed to fetch props for event ${event.id}:`, err);
      }
    }
  }

  const deduplicated = deduplicateProps(allProps);
  return { events, props: deduplicated };
}
