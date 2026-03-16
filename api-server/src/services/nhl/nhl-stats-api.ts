/**
 * NHL Stats API Client
 * Official NHL API: api-web.nhle.com/v1
 * No API key required — publicly accessible
 */

const NHL_API = "https://api-web.nhle.com/v1";
const SEASON = "20252026";
const SEASON_TYPE = "2"; // 2 = regular season

async function nhlFetch<T>(path: string): Promise<T> {
  const url = `${NHL_API}${path}`;
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "PropEdge/1.0" },
  });
  if (!res.ok) throw new Error(`NHL API error ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

export interface NHLGame {
  id: number;
  homeTeam: { abbrev: string; commonName: { default: string } };
  awayTeam: { abbrev: string; commonName: { default: string } };
  startTimeUTC: string;
  gameState: string;
  venue: { default: string };
}

export interface NHLScheduleDay {
  date: string;
  games: NHLGame[];
}

export interface NHLScheduleResponse {
  gameWeek: NHLScheduleDay[];
}

export interface NHLRosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber: number;
  positionCode: string;
}

export interface NHLRosterResponse {
  forwards: NHLRosterPlayer[];
  defensemen: NHLRosterPlayer[];
  goalies: NHLRosterPlayer[];
}

export interface NHLGameLogEntry {
  gameId: number;
  teamAbbrev: string;
  homeRoadFlag: string;
  gameDate: string;
  goals: number;
  assists: number;
  points: number;
  shots: number; // shots on goal
  toi: string;
  plusMinus: number;
  powerPlayGoals: number;
  powerPlayPoints: number;
  pim: number;
  opponentAbbrev: string;
}

export interface NHLGameLogResponse {
  gameLog: NHLGameLogEntry[];
}

export interface NHLPlayerLandingResponse {
  playerId: number;
  firstName: { default: string };
  lastName: { default: string };
  currentTeamAbbrev: string;
  position: string;
  teamLogo: string;
}

/**
 * Get today's NHL schedule
 */
export async function getTodaysNHLSchedule(date?: string): Promise<NHLScheduleDay | null> {
  const targetDate = date || new Date().toISOString().split("T")[0];
  const data = await nhlFetch<NHLScheduleResponse>(`/schedule/${targetDate}`);
  return data.gameWeek?.find((d) => d.date === targetDate) ?? data.gameWeek?.[0] ?? null;
}

/**
 * Get full roster for a team by abbreviation
 */
export async function getNHLTeamRoster(teamAbbrev: string): Promise<NHLRosterPlayer[]> {
  const data = await nhlFetch<NHLRosterResponse>(`/roster/${teamAbbrev}/current`);
  return [
    ...(data.forwards ?? []),
    ...(data.defensemen ?? []),
    ...(data.goalies ?? []),
  ];
}

/**
 * Get a player's game log for the current season (last N games, most recent first)
 */
export async function getNHLPlayerGameLog(playerId: number): Promise<NHLGameLogEntry[]> {
  const data = await nhlFetch<NHLGameLogResponse>(
    `/player/${playerId}/game-log/${SEASON}/${SEASON_TYPE}`
  );
  return (data.gameLog ?? []).sort((a, b) => b.gameDate.localeCompare(a.gameDate));
}

/**
 * Normalize a player name for fuzzy matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z ]/g, "")
    .trim();
}

/**
 * Build a name lookup map from a roster
 */
export function buildRosterNameMap(
  players: NHLRosterPlayer[]
): Map<string, NHLRosterPlayer> {
  const map = new Map<string, NHLRosterPlayer>();
  for (const p of players) {
    const full = normalizeName(`${p.firstName.default} ${p.lastName.default}`);
    map.set(full, p);
    // Also index by last name only (for disambiguation later)
    const lastName = normalizeName(p.lastName.default);
    if (!map.has(lastName)) map.set(lastName, p);
  }
  return map;
}

/**
 * Match a player name from The Odds API to an NHL player ID
 */
export function matchPlayerName(
  name: string,
  rosterMap: Map<string, NHLRosterPlayer>
): NHLRosterPlayer | null {
  const normalized = normalizeName(name);
  return rosterMap.get(normalized) ?? null;
}

/**
 * Get both teams' rosters for a game and build a combined lookup
 */
export async function buildGameRosterMap(
  homeTeam: string,
  awayTeam: string
): Promise<Map<string, NHLRosterPlayer & { team: string }>> {
  const [homeRoster, awayRoster] = await Promise.all([
    getNHLTeamRoster(homeTeam),
    getNHLTeamRoster(awayTeam),
  ]);

  const map = new Map<string, NHLRosterPlayer & { team: string }>();
  for (const p of homeRoster) {
    const key = normalizeName(`${p.firstName.default} ${p.lastName.default}`);
    map.set(key, { ...p, team: homeTeam });
  }
  for (const p of awayRoster) {
    const key = normalizeName(`${p.firstName.default} ${p.lastName.default}`);
    map.set(key, { ...p, team: awayTeam });
  }
  return map;
}
