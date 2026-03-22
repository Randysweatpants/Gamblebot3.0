import express from "express";
import cors from "cors";
import { access, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCEPTED_PICK_LOG_FIELDS = [
  "date",
  "gameKey",
  "pickKey",
  "player",
  "side",
  "line",
  "book",
  "odds",
  "proj",
  "fairProb",
  "impliedProb",
  "ev",
  "confidence",
];
const LOG_DIR = path.join(__dirname, "logs");
const ACCEPTED_PICKS_JSON_LOG_FILE = path.join(LOG_DIR, "accepted-picks.jsonl");
const ACCEPTED_PICKS_CSV_LOG_FILE = path.join(LOG_DIR, "accepted-picks.csv");

app.use(
  cors({
    origin: "https://randysweatpants.github.io",
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "PropEdge backend is running" });
});

app.get("/healthz", (req, res) => {
  res.send("ok");
});

function toCsvCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/\"/g, '""')}"`;
  }
  return str;
}

function normalizeAcceptedPickPayload(payload) {
  return {
    date: payload.date ? String(payload.date) : new Date().toISOString(),
    gameKey: payload.gameKey ? String(payload.gameKey) : "",
    pickKey: payload.pickKey ? String(payload.pickKey) : "",
    player: payload.player ? String(payload.player) : "",
    side: payload.side ? String(payload.side) : "",
    line: payload.line ?? null,
    book: payload.book ? String(payload.book) : "",
    odds: payload.odds ?? null,
    proj: payload.proj ?? null,
    fairProb: payload.fairProb ?? null,
    impliedProb: payload.impliedProb ?? null,
    ev: payload.ev ?? null,
    confidence: payload.confidence ?? null,
  };
}

function validateAcceptedPickPayload(pick) {
  const requiredFields = [
    "gameKey",
    "pickKey",
    "player",
    "side",
    "line",
    "book",
    "odds",
    "proj",
    "fairProb",
    "impliedProb",
    "ev",
    "confidence",
  ];
  const missing = requiredFields.filter((field) => pick[field] === "" || pick[field] === null || pick[field] === undefined);
  return missing;
}

app.post("/api/accepted-picks/log", async (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  if (format !== "json" && format !== "csv") {
    return res.status(400).json({
      error: "invalid format",
      details: "use ?format=json or ?format=csv",
    });
  }

  const logEntry = normalizeAcceptedPickPayload(req.body || {});
  const missingFields = validateAcceptedPickPayload(logEntry);
  if (missingFields.length > 0) {
    return res.status(400).json({
      error: "missing required fields",
      missingFields,
    });
  }

  try {
    await mkdir(LOG_DIR, { recursive: true });

    if (format === "csv") {
      let csvExists = true;
      try {
        await access(ACCEPTED_PICKS_CSV_LOG_FILE);
      } catch {
        csvExists = false;
      }

      if (!csvExists) {
        await appendFile(ACCEPTED_PICKS_CSV_LOG_FILE, `${ACCEPTED_PICK_LOG_FIELDS.join(",")}\n`, "utf8");
      }

      const row = ACCEPTED_PICK_LOG_FIELDS.map((field) => toCsvCell(logEntry[field])).join(",");
      await appendFile(ACCEPTED_PICKS_CSV_LOG_FILE, `${row}\n`, "utf8");

      return res.json({
        ok: true,
        format,
        file: "logs/accepted-picks.csv",
        loggedAt: new Date().toISOString(),
      });
    }

    await appendFile(ACCEPTED_PICKS_JSON_LOG_FILE, `${JSON.stringify(logEntry)}\n`, "utf8");
    return res.json({
      ok: true,
      format,
      file: "logs/accepted-picks.jsonl",
      loggedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: "failed to write accepted pick log",
      details: String(error),
    });
  }
});

function americanToImpliedProbability(odds) {
  if (odds === null || odds === undefined || Number.isNaN(odds)) return null;
  const num = Number(odds);
  if (num === 0) return null;
  if (num > 0) {
    return 100 / (num + 100);
  }
  return Math.abs(num) / (Math.abs(num) + 100);
}

function normalizePick({
  player = "",
  team = "",
  opp = "",
  market = "",
  line = 0,
  side = "",
  book = "",
  odds = 0,
  proj = 0,
  fairProb = 0,
  impliedProb = 0,
  ev = 0,
  confidence = 0,
  notes = "",
}) {
  return {
    player,
    team,
    opp,
    market,
    line,
    side,
    book,
    odds,
    proj,
    fairProb,
    impliedProb,
    ev,
    confidence,
    notes,
  };
}


// ============================================================
// NHL Shots on Goal – Stats Adapter
// Sources:
//   Player:  search.d3.nhle.com  (name -> playerId)
//            api-web.nhle.com/v1/player/{id}/game-log/now
//   Team env: api-web.nhle.com/v1/standings/now (shots for/against per game)
// ============================================================

const LEAGUE_AVG_SHOTS_ALLOWED_PER60 = 30.5; // approximate NHL team average

// ---- Team standings cache (refreshed every 6 hours) ----
let _standingsCache = null;
let _standingsCacheTime = 0;
const STANDINGS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Fetches NHL standings and returns two lookup maps:
 *   byAbbrev: { "BOS": { shotsForPerGame, shotsAgainstPerGame, fullName } }
 *   byName:   { "boston bruins": "BOS" }
 */
async function getTeamStandingsMap() {
  const now = Date.now();
  if (_standingsCache && now - _standingsCacheTime < STANDINGS_TTL_MS) {
    return _standingsCache;
  }
  try {
    const resp = await fetch("https://api-web.nhle.com/v1/standings/now");
    if (!resp.ok) return { byAbbrev: {}, byName: {} };
    const data = await resp.json();
    const standings = Array.isArray(data.standings) ? data.standings : [];
    const byAbbrev = {};
    const byName = {};
    for (const team of standings) {
      const abbrev = (
        typeof team.teamAbbrev === "object" ? team.teamAbbrev.default : team.teamAbbrev
      ) || "";
      const fullName = (
        typeof team.teamName === "object" ? team.teamName.default
          : team.teamName
      ) || (
        typeof team.teamCommonName === "object" ? team.teamCommonName.default
          : team.teamCommonName
      ) || "";
      if (!abbrev) continue;
      const key = abbrev.toUpperCase();
      byAbbrev[key] = {
        shotsForPerGame: team.shotsForPerGame ?? null,
        shotsAgainstPerGame: team.shotsAgainstPerGame ?? null,
        fullName,
      };
      if (fullName) byName[fullName.toLowerCase()] = key;
    }
    _standingsCache = { byAbbrev, byName };
    _standingsCacheTime = now;
    return _standingsCache;
  } catch (err) {
    console.error("[Standings] fetch error:", err.message);
    return { byAbbrev: {}, byName: {} };
  }
}

function nullStats() {
  return {
    last10Avg: null,
    last5Avg: null,
    seasonAvg: null,
    avgTOI: null,
    avgPPTOI: null,
    teamShotsForPer60: null,
    opponentShotsAllowedPer60: null,
  };
}

function parseTOIStr(toiStr) {
  if (!toiStr || typeof toiStr !== "string") return null;
  const parts = toiStr.split(":");
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0], 10);
  const secs = parseInt(parts[1], 10);
  if (isNaN(mins) || isNaN(secs)) return null;
  return mins + secs / 60;
}

/**
 * Fetch real NHL shots-on-goal stats for a player, including
 * team shots-for and opponent shots-against from the standings.
 *
 * @param {string} playerName   Display name from the Odds API
 * @param {string} homeTeam     Full home team name from the Odds API event
 * @param {string} awayTeam     Full away team name from the Odds API event
 * @param {{ byAbbrev: object, byName: object }} standingsMap  Pre-fetched standings
 * @returns {Promise<object>}
 */
async function getPlayerSOGStats(playerName, homeTeam, awayTeam, standingsMap) {
  try {
    // Step 1: Resolve player name -> NHL playerId
    const searchUrl =
      `https://search.d3.nhle.com/api/v1/search/player` +
      `?culture=en-us&limit=5&active=true&q=${encodeURIComponent(playerName)}`;
    const searchResp = await fetch(searchUrl);
    if (!searchResp.ok) return nullStats();
    const searchResults = await searchResp.json();
    if (!Array.isArray(searchResults) || searchResults.length === 0) return nullStats();

    // Prefer exact name match, fall back to first result
    const normalizedQuery = playerName.toLowerCase().trim();
    const match =
      searchResults.find((p) => (p.name || "").toLowerCase().trim() === normalizedQuery) ||
      searchResults[0];
    const playerId = match.playerId;
    if (!playerId) return nullStats();

    // Extract the player's current team abbreviation from the search result
    const playerTeamAbbrev = (
      match.currentTeamAbbrev ?? match.teamAbbrev ?? ""
    ).toUpperCase();

    // Step 2: Fetch current-season game log (newest game first)
    const gameLogUrl = `https://api-web.nhle.com/v1/player/${playerId}/game-log/now`;
    const gameLogResp = await fetch(gameLogUrl);
    if (!gameLogResp.ok) return nullStats();
    const gameLogData = await gameLogResp.json();
    const games = Array.isArray(gameLogData.gameLog) ? gameLogData.gameLog : [];
    if (games.length === 0) return nullStats();

    // Step 3: Compute rolling averages (require ≥3 games to avoid tiny samples)
    const recent10 = games.slice(0, Math.min(10, games.length));
    const recent5 = games.slice(0, Math.min(5, games.length));

    const avgField = (arr, field) =>
      arr.reduce((s, g) => s + Number(g[field] ?? 0), 0) / arr.length;

    const last10Avg = recent10.length >= 3 ? avgField(recent10, "shots") : null;
    const last5Avg = recent5.length >= 3 ? avgField(recent5, "shots") : null;
    const seasonAvg = games.length >= 1 ? avgField(games, "shots") : null;

    // Step 4: TOI – use recent 10 games
    const toiVals = recent10.map((g) => parseTOIStr(g.toi)).filter((v) => v !== null);
    const avgTOI = toiVals.length > 0
      ? toiVals.reduce((s, v) => s + v, 0) / toiVals.length
      : null;

    // Step 5: PPTOI – field name varies by season; try common variants
    const ppToiVals = recent10
      .map((g) => parseTOIStr(g.ppToi ?? g.pptoi ?? g.powerPlayToi ?? null))
      .filter((v) => v !== null);
    const avgPPTOI = ppToiVals.length > 0
      ? ppToiVals.reduce((s, v) => s + v, 0) / ppToiVals.length
      : null;

    // Step 6: Team shots-for environment from standings
    let teamShotsForPer60 = null;
    if (playerTeamAbbrev && standingsMap.byAbbrev[playerTeamAbbrev]) {
      teamShotsForPer60 = standingsMap.byAbbrev[playerTeamAbbrev].shotsForPerGame ?? null;
    }

    // Step 7: Opponent shots-against environment from standings
    // Determine which of the event's two teams is the opponent by cross-referencing
    // the player's team abbreviation against both Odds API names.
    let opponentShotsAllowedPer60 = null;
    if (playerTeamAbbrev && homeTeam && awayTeam) {
      const homeAbbrev = standingsMap.byName[homeTeam.toLowerCase()] ?? null;
      const awayAbbrev = standingsMap.byName[awayTeam.toLowerCase()] ?? null;
      const oppAbbrev =
        homeAbbrev === playerTeamAbbrev ? awayAbbrev
        : awayAbbrev === playerTeamAbbrev ? homeAbbrev
        : null;
      if (oppAbbrev && standingsMap.byAbbrev[oppAbbrev]) {
        opponentShotsAllowedPer60 =
          standingsMap.byAbbrev[oppAbbrev].shotsAgainstPerGame ?? null;
      }
    }

    return {
      last10Avg,
      last5Avg,
      seasonAvg,
      avgTOI,
      avgPPTOI,
      teamShotsForPer60,
      opponentShotsAllowedPer60,
    };
  } catch (err) {
    console.error(`[SOG stats] NHL API error for "${playerName}":`, err.message);
    return nullStats();
  }
}

// --- Poisson helpers for fair-probability estimation ---

function _logFactorial(n) {
  let r = 0;
  for (let i = 2; i <= n; i++) r += Math.log(i);
  return r;
}

function _poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - _logFactorial(k));
}

/** P(X <= k) for Poisson(lambda) */
function _poissonCDF(k, lambda) {
  let sum = 0;
  const intK = Math.floor(k);
  for (let i = 0; i <= intK; i++) sum += _poissonPMF(i, lambda);
  return sum;
}

/**
 * Given a projected SOG mean and a book line, return fair over/under probs.
 * Uses Poisson distribution.  For line=3.5: Over = P(X >= 4).
 * @returns {{ fairOver: number, fairUnder: number }}
 */
function fairProbsFromProjection(projMean, line) {
  if (projMean <= 0) return { fairOver: 0.5, fairUnder: 0.5 };
  const fairUnder = _poissonCDF(Math.floor(line), projMean);
  const fairOver = 1 - fairUnder;
  return {
    fairOver: Math.min(Math.max(fairOver, 0.01), 0.99),
    fairUnder: Math.min(Math.max(fairUnder, 0.01), 0.99),
  };
}

function getCurrentNbaSeason() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  const endYear = String(startYear + 1).slice(-2);
  return `${startYear}-${endYear}`;
}

function getCurrentNbaSeasonYear() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function parseNbaMinutes(min) {
  if (min === null || min === undefined) return null;
  if (typeof min === "number") return Number.isFinite(min) ? min : null;
  const str = String(min).trim();
  if (!str) return null;
  if (str.includes(":")) {
    const parts = str.split(":");
    if (parts.length !== 2) return null;
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
    return mins + secs / 60;
  }
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullReboundStats() {
  return {
    last10Avg: null,
    last5Avg: null,
    seasonAvg: null,
    minutesAvg: null,
  };
}

const BALLDONTLIE_BASE = "https://api.balldontlie.io/v1";
const NBA_STATS_TIMEOUT_MS = 8000;
const BDL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// normalizedName -> { playerId: number|null, ts: number }
const _bdlPlayerIdCache = new Map();
// playerId -> { stats: {last10Avg,last5Avg,seasonAvg,minutesAvg}, ts: number }
const _bdlStatsCache = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = NBA_STATS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === "AbortError") {
      const timeoutError = new Error(`request timed out after ${timeoutMs}ms`);
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function incrementNbaStatsCounter(statsDebug, field) {
  if (!statsDebug || typeof statsDebug !== "object") return;
  if (typeof statsDebug[field] !== "number") statsDebug[field] = 0;
  statsDebug[field] += 1;
}

function hasUsableReboundStats(stats) {
  if (!stats) return false;
  const fields = [stats.last10Avg, stats.last5Avg, stats.seasonAvg, stats.minutesAvg];
  return fields.some((value) => value != null);
}

/** Normalize a player name for matching. */
function normalizePlayerName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .trim()
    // Remove common suffixes
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\.?\b/gi, "")
    // Remove punctuation except spaces
    .replace(/[^a-z0-9\s]/g, "")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract first initial and last name from a full name. */
function getInitialLastName(fullName) {
  const parts = normalizePlayerName(fullName).split(/\s+/);
  if (parts.length < 2) return null;
  const firstInitial = parts[0].charAt(0);
  const lastName = parts[parts.length - 1];
  return `${firstInitial}${lastName}`;
}

/**
 * Look up a balldontlie player ID by display name.
 * Uses multiple matching strategies to find the best match.
 * Results are cached for the server lifetime (player IDs are stable).
 */
async function getBdlPlayerId(playerName, apiKey, statsDebug) {
  const normalizedOddsName = normalizePlayerName(playerName);
  if (!normalizedOddsName) return null;

  const cachedPlayer = _bdlPlayerIdCache.get(normalizedOddsName);
  if (cachedPlayer && Date.now() - cachedPlayer.ts < BDL_CACHE_TTL_MS) {
    incrementNbaStatsCounter(statsDebug, "nbaPlayerCacheHitCount");
    if (cachedPlayer.playerId) {
      incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchSuccessCount");
    } else {
      incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchFailureCount");
    }
    return cachedPlayer.playerId;
  }
  incrementNbaStatsCounter(statsDebug, "nbaPlayerCacheMissCount");

  try {
    // Split the full name into first and last name
    // Balldontlie search only works on first_name or last_name independently
    const nameParts = normalizedOddsName.split(/\s+/).filter(Boolean);
    if (nameParts.length < 1) {
      incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchFailureCount");
      return null;
    }

    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    let players = [];

    // Strategy 1: Search by first name
    try {
      const firstNameUrl = new URL(`${BALLDONTLIE_BASE}/players`);
      firstNameUrl.searchParams.set("search", firstName);
      firstNameUrl.searchParams.set("per_page", "20");

      let resp = await fetchWithTimeout(
        firstNameUrl.toString(),
        { headers: { Authorization: apiKey } },
        NBA_STATS_TIMEOUT_MS
      );
      if (resp.ok) {
        const data = await resp.json();
        players = Array.isArray(data.data) ? data.data : [];
      }
    } catch (err) {
      // First name search failed, try last name
    }

    // Look for exact full-name match in first-name search results
    if (players.length > 0) {
      let matchedPlayer = players.find((p) => {
        const bdlFullName = normalizePlayerName(
          `${p.first_name} ${p.last_name}`
        );
        return bdlFullName === normalizedOddsName;
      });
      if (matchedPlayer && matchedPlayer.id) {
        _bdlPlayerIdCache.set(normalizedOddsName, {
          playerId: matchedPlayer.id,
          ts: Date.now(),
        });
        incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchSuccessCount");
        return matchedPlayer.id;
      }
    }

    // Strategy 2: Search by last name if first name search didn't match
    try {
      const lastNameUrl = new URL(`${BALLDONTLIE_BASE}/players`);
      lastNameUrl.searchParams.set("search", lastName);
      lastNameUrl.searchParams.set("per_page", "20");

      const resp = await fetchWithTimeout(
        lastNameUrl.toString(),
        { headers: { Authorization: apiKey } },
        NBA_STATS_TIMEOUT_MS
      );
      if (resp.ok) {
        const data = await resp.json();
        players = Array.isArray(data.data) ? data.data : [];
      }
    } catch (err) {
      // Last name search also failed
    }

    if (players.length === 0) {
      incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchFailureCount");
      return null;
    }

    // Look for exact full-name match in last-name search results  
    let matchedPlayer = players.find((p) => {
      const bdlFullName = normalizePlayerName(
        `${p.first_name} ${p.last_name}`
      );
      return bdlFullName === normalizedOddsName;
    });
    if (matchedPlayer && matchedPlayer.id) {
      _bdlPlayerIdCache.set(normalizedOddsName, {
        playerId: matchedPlayer.id,
        ts: Date.now(),
      });
      incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchSuccessCount");
      return matchedPlayer.id;
    }

    // No exact match found from either search
    _bdlPlayerIdCache.set(normalizedOddsName, {
      playerId: null,
      ts: Date.now(),
    });
    incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchFailureCount");
    return null;
  } catch (err) {
    if (err && err.code === "TIMEOUT") {
      incrementNbaStatsCounter(statsDebug, "nbaStatsTimeoutCount");
    } else {
      incrementNbaStatsCounter(statsDebug, "nbaPlayerMatchFailureCount");
    }
    return null;
  }
}

/**
 * Fetch per-player rebound stats for the current NBA season using balldontlie.
 * Results are cached for BDL_CACHE_TTL_MS to avoid duplicate API calls
 * across multiple line/book groups for the same player.
 */
async function getPlayerReboundStats(playerName, homeTeam, awayTeam, statsDebug) {
  incrementNbaStatsCounter(statsDebug, "nbaPlayersProcessedCount");

  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) {
    incrementNbaStatsCounter(statsDebug, "nbaStatsFailureCount");
    return nullReboundStats();
  }

  try {
    const playerId = await getBdlPlayerId(playerName, apiKey, statsDebug);
    if (!playerId) {
      incrementNbaStatsCounter(statsDebug, "nbaStatsFailureCount");
      return nullReboundStats();
    }

    // Return cached stats by balldontlie player ID if still fresh
    const cached = _bdlStatsCache.get(playerId);
    if (cached && Date.now() - cached.ts < BDL_CACHE_TTL_MS) {
      incrementNbaStatsCounter(statsDebug, "nbaStatsCacheHitCount");
      // Count as success since we already have usable stats
      if (hasUsableReboundStats(cached.stats)) {
        incrementNbaStatsCounter(statsDebug, "nbaStatsSuccessCount");
      }
      return { ...cached.stats, homeTeam, awayTeam };
    }
    incrementNbaStatsCounter(statsDebug, "nbaStatsCacheMissCount");

    const seasonYear = getCurrentNbaSeasonYear();
    const statsUrl = new URL(`${BALLDONTLIE_BASE}/stats`);
    statsUrl.searchParams.set("player_ids[]", String(playerId));
    statsUrl.searchParams.set("seasons[]", String(seasonYear));
    statsUrl.searchParams.set("per_page", "100");

    const statsResp = await fetchWithTimeout(
      statsUrl.toString(),
      { headers: { Authorization: apiKey } },
      NBA_STATS_TIMEOUT_MS
    );
    if (!statsResp.ok) {
      incrementNbaStatsCounter(statsDebug, "nbaStatsFailureCount");
      return nullReboundStats();
    }

    const statsData = await statsResp.json();
    const gameEntries = Array.isArray(statsData.data) ? statsData.data : [];

    // Sort newest-first (balldontlie does not guarantee date order)
    gameEntries.sort((a, b) => {
      const da = (a.game && a.game.date) ? a.game.date : "";
      const db = (b.game && b.game.date) ? b.game.date : "";
      return db.localeCompare(da);
    });

    // Exclude DNP rows (min null, "0", or "0:00")
    const statRows = gameEntries
      .filter((g) => {
        const minVal = parseNbaMinutes(String(g.min ?? "0"));
        return minVal !== null && minVal > 0 && g.reb !== null && g.reb !== undefined;
      })
      .map((g) => ({
        reb: Number(g.reb),
        min: parseNbaMinutes(String(g.min ?? "0")),
      }))
      .filter((row) => Number.isFinite(row.reb));

    if (statRows.length === 0) {
      incrementNbaStatsCounter(statsDebug, "nbaStatsFailureCount");
      return nullReboundStats();
    }

    const recent10 = statRows.slice(0, Math.min(10, statRows.length));
    const recent5 = statRows.slice(0, Math.min(5, statRows.length));
    const avg = (arr, field) =>
      arr.reduce((sum, item) => sum + Number(item[field] ?? 0), 0) / arr.length;

    const last10Avg = recent10.length >= 3 ? avg(recent10, "reb") : null;
    const last5Avg = recent5.length >= 3 ? avg(recent5, "reb") : null;
    const seasonAvg = statRows.length >= 1 ? avg(statRows, "reb") : null;

    const minuteSamples = recent10
      .map((row) => row.min)
      .filter((v) => v != null && Number.isFinite(v));
    const minutesAvg = minuteSamples.length
      ? minuteSamples.reduce((sum, v) => sum + v, 0) / minuteSamples.length
      : null;

    const coreStats = { last10Avg, last5Avg, seasonAvg, minutesAvg };
    _bdlStatsCache.set(playerId, { stats: coreStats, ts: Date.now() });

    const stats = { ...coreStats, homeTeam, awayTeam };
    if (hasUsableReboundStats(stats)) {
      incrementNbaStatsCounter(statsDebug, "nbaStatsSuccessCount");
    } else {
      incrementNbaStatsCounter(statsDebug, "nbaStatsFailureCount");
    }
    return stats;
  } catch (err) {
    if (err && err.code === "TIMEOUT") {
      incrementNbaStatsCounter(statsDebug, "nbaStatsTimeoutCount");
    } else {
      incrementNbaStatsCounter(statsDebug, "nbaStatsFailureCount");
    }
    console.error(`[Rebounds stats] balldontlie error for "${playerName}":`, err.message);
    return nullReboundStats();
  }
}

function computeProjectedRebounds(stats) {
  const windows = [
    { val: stats.last10Avg, wt: 40 },
    { val: stats.last5Avg, wt: 30 },
    { val: stats.seasonAvg, wt: 20 },
  ];
  const available = windows.filter((window) => window.val != null);
  if (available.length === 0) return null;

  const totalWeight = available.reduce((sum, window) => sum + window.wt, 0);
  const baseProjection = available.reduce((sum, window) => sum + window.val * window.wt, 0) / totalWeight;

  let minutesAdjusted = baseProjection;
  if (stats.minutesAvg != null) {
    const MIN_BASELINE = 30;
    const minuteScalar = Math.min(Math.max(stats.minutesAvg / MIN_BASELINE, 0.75), 1.25);
    minutesAdjusted = baseProjection * minuteScalar;
  }

  return (baseProjection * 90 + minutesAdjusted * 10) / 100;
}

const NBA_REBOUNDS_FALLBACK_NOTES = "no-vig fallback (NBA stats unavailable)";
const NBA_REBOUNDS_MODEL_NOTES = "model EV estimate using NBA recent rebounds data";

/**
 * Compute a weighted projected SOG mean.
 * Weights: 35% L10 avg | 25% L5 avg | 20% season avg |
 *          10% TOI/PP role adjustment | 10% opponent adjustment.
 * Missing inputs cause their weight to be redistributed to the base average.
 * Returns null when no stat window is available at all.
 * @param {{ last10Avg, last5Avg, seasonAvg, avgTOI, avgPPTOI,
 *           teamShotsForPer60, opponentShotsAllowedPer60 }} stats
 * @returns {number|null}
 */
function computeProjectedSOG(stats) {
  const {
    last10Avg, last5Avg, seasonAvg,
    avgTOI, avgPPTOI,
    teamShotsForPer60, opponentShotsAllowedPer60,
  } = stats;

  // Weighted base from available rolling windows
  const windows = [
    { val: last10Avg, wt: 35 },
    { val: last5Avg,  wt: 25 },
    { val: seasonAvg, wt: 20 },
  ];
  const available = windows.filter((c) => c.val != null);
  if (available.length === 0) return null;

  const totalBaseWt = available.reduce((s, c) => s + c.wt, 0);
  const baseProjected = available.reduce((s, c) => s + c.val * c.wt, 0) / totalBaseWt;

  // TOI/PP role adjustment (10% weight bucket)
  let toiAdjusted = baseProjected;
  if (avgTOI != null) {
    const TOI_BASELINE = 18; // minutes – typical top-6 forward
    const toiScalar = Math.min(Math.max(avgTOI / TOI_BASELINE, 0.7), 1.3);
    toiAdjusted = baseProjected * toiScalar;
  }
  if (avgPPTOI != null && avgPPTOI > 1.5) {
    // Extra PP time adds shot opportunities; cap additional bump at 15%
    toiAdjusted = Math.min(toiAdjusted + avgPPTOI * 0.05, toiAdjusted * 1.15);
  }

  // Environment adjustment (10% weight bucket): blend team shots-for AND opp shots-against
  // Scalars are capped so no single environment factor moves the projection more than ±20%.
  let envSum = 0;
  let envCount = 0;
  if (opponentShotsAllowedPer60 != null) {
    const oppScalar = Math.min(
      Math.max(opponentShotsAllowedPer60 / LEAGUE_AVG_SHOTS_ALLOWED_PER60, 0.8),
      1.2
    );
    envSum += baseProjected * oppScalar;
    envCount++;
  }
  if (teamShotsForPer60 != null) {
    // Generous team shooting creates more individual opportunities
    const teamScalar = Math.min(
      Math.max(teamShotsForPer60 / LEAGUE_AVG_SHOTS_ALLOWED_PER60, 0.85),
      1.15
    );
    envSum += baseProjected * teamScalar;
    envCount++;
  }
  const envAdjusted = envCount > 0 ? envSum / envCount : baseProjected;

  // Final blend: 80% base | 10% toi-adjusted | 10% env-adjusted
  return (baseProjected * 80 + toiAdjusted * 10 + envAdjusted * 10) / 100;
}

/** Decimal payout per $1 risked from American odds */
function americanPayout(odds) {
  if (odds > 0) return odds / 100;
  return 100 / Math.abs(odds);
}

function hasProjectionBuffer(pick) {
  if (!Number.isFinite(pick.proj) || !Number.isFinite(pick.line)) return false;
  if (pick.side === "Under") return pick.proj <= pick.line - 0.2;
  if (pick.side === "Over") return pick.proj >= pick.line + 0.2;
  return false;
}

function hasReboundProjectionBuffer(pick) {
  if (!Number.isFinite(pick.proj) || !Number.isFinite(pick.line)) return false;
  if (pick.side === "Under") return pick.proj <= pick.line - 0.3;
  if (pick.side === "Over") return pick.proj >= pick.line + 0.3;
  return false;
}

function isBetterSportsbookPrice(candidateOdds, currentOdds) {
  return Number(candidateOdds) > Number(currentOdds);
}

function getGameKey(pick) {
  const home = pick._homeTeam || "";
  const away = pick._awayTeam || "";
  return `${home}|${away}`;
}

function cleanTopShots(topShots) {
  const totalRawSOGPicks = topShots.length;
  const modelBasedShots = topShots.filter(
    (pick) => pick.notes === "model EV estimate using NHL recent SOG data"
  );
  const dedupedShots = new Map();

  for (const pick of modelBasedShots) {
    const dedupeKey = `${pick.player}|${pick.side}|${pick.line}`;
    const existingPick = dedupedShots.get(dedupeKey);
    const shouldReplace =
      !existingPick
      || isBetterSportsbookPrice(pick.odds, existingPick.odds)
      || (Number(pick.odds) === Number(existingPick.odds) && Number(pick.ev) > Number(existingPick.ev));
    if (shouldReplace) {
      dedupedShots.set(dedupeKey, pick);
    }
  }

  const afterDedupe = Array.from(dedupedShots.values());
  const afterConfidence = afterDedupe.filter((pick) => pick.confidence >= 55);
  const afterEV = afterConfidence.filter((pick) => pick.ev >= 0.02);
  const afterProjectionBuffer = afterEV.filter((pick) => hasProjectionBuffer(pick));

  const sortedByEv = afterProjectionBuffer.sort((a, b) => b.ev - a.ev);
  const gameCounts = new Map();
  const cappedByGame = [];

  for (const pick of sortedByEv) {
    const gameKey = getGameKey(pick);
    const count = gameCounts.get(gameKey) ?? 0;
    if (count >= 3) continue;
    cappedByGame.push(pick);
    gameCounts.set(gameKey, count + 1);
  }

  const finalTopShots = cappedByGame.sort((a, b) => b.ev - a.ev);

  return {
    topShots: finalTopShots,
    debug: {
      totalRawSOGPicks,
      afterDedupe: afterDedupe.length,
      afterConfidenceFilter: afterConfidence.length,
      afterEVFilter: afterEV.length,
      afterProjectionBuffer: afterProjectionBuffer.length,
      finalReturnedPicks: finalTopShots.length,
    },
  };
}

function cleanTopRebounds(topRebounds) {
  const totalRawPicks = topRebounds.length;

  // Dedupe by player + side + line, preferring better price then better EV
  const dedupedRebounds = new Map();
  for (const pick of topRebounds) {
    const dedupeKey = `${pick.player}|${pick.side}|${pick.line}`;
    const existingPick = dedupedRebounds.get(dedupeKey);
    const shouldReplace =
      !existingPick
      || isBetterSportsbookPrice(pick.odds, existingPick.odds)
      || (Number(pick.odds) === Number(existingPick.odds) && Number(pick.ev) > Number(existingPick.ev));
    if (shouldReplace) dedupedRebounds.set(dedupeKey, pick);
  }

  const afterDedupe = Array.from(dedupedRebounds.values());

  // Confidence filter: model picks require confidence >= 55; fallback picks always pass
  const afterConfidence = afterDedupe.filter((pick) => {
    if (pick.notes === NBA_REBOUNDS_MODEL_NOTES) return pick.confidence >= 55;
    return true;
  });

  // EV filter: model picks require EV >= 2%; fallback picks always pass
  const afterEV = afterConfidence.filter((pick) => {
    if (pick.notes === NBA_REBOUNDS_FALLBACK_NOTES) return true;
    return pick.ev >= 0.02;
  });

  // Projection buffer: apply only when proj > 0; if no projection exists, allow through
  const afterProjectionBuffer = afterEV.filter((pick) => {
    const hasProj = Number.isFinite(pick.proj) && pick.proj > 0;
    if (!hasProj) return true;
    return hasReboundProjectionBuffer(pick);
  });

  const afterFallbackMode = afterProjectionBuffer.filter(
    (pick) => pick.notes === NBA_REBOUNDS_FALLBACK_NOTES
  ).length;

  // Model picks sorted by EV desc (placed first); fallback picks sorted by impliedProb desc
  const sortedModel = afterProjectionBuffer
    .filter((pick) => pick.notes === NBA_REBOUNDS_MODEL_NOTES)
    .sort((a, b) => b.ev - a.ev);
  const sortedFallback = afterProjectionBuffer
    .filter((pick) => pick.notes !== NBA_REBOUNDS_MODEL_NOTES)
    .sort((a, b) => b.impliedProb - a.impliedProb);
  const sortedAll = [...sortedModel, ...sortedFallback];

  // Cap 2 picks per game
  const gameCounts = new Map();
  const gameCapped = [];
  for (const pick of sortedAll) {
    const gameKey = getGameKey(pick);
    const count = gameCounts.get(gameKey) ?? 0;
    if (count >= 2) continue;
    gameCapped.push(pick);
    gameCounts.set(gameKey, count + 1);
  }

  // Fallback fill to 5 picks if needed, maintaining sortedAll order
  let finalRebounds = [...gameCapped];
  if (finalRebounds.length < 5) {
    const selectedKeys = new Set(
      finalRebounds.map(
        (pick) => `${pick.player}|${pick.market}|${pick.side}|${pick.line}|${pick.book}`
      )
    );
    for (const pick of sortedAll) {
      const key = `${pick.player}|${pick.market}|${pick.side}|${pick.line}|${pick.book}`;
      if (selectedKeys.has(key)) continue;
      finalRebounds.push(pick);
      selectedKeys.add(key);
      if (finalRebounds.length >= 5) break;
    }
  }

  // Cap at 10, preserve model-first ordering
  finalRebounds = finalRebounds.slice(0, 10);

  const nbaModelPickCount = finalRebounds.filter((p) => p.notes === NBA_REBOUNDS_MODEL_NOTES).length;
  const nbaFallbackPickCount = finalRebounds.filter((p) => p.notes !== NBA_REBOUNDS_MODEL_NOTES).length;

  return {
    topRebounds: finalRebounds,
    nbaModelPickCount,
    nbaFallbackPickCount,
    debug: {
      totalRawReboundPicks: totalRawPicks,
      afterDedupe: afterDedupe.length,
      afterConfidenceFilter: afterConfidence.length,
      afterEVFilter: afterEV.length,
      afterProjectionBuffer: afterProjectionBuffer.length,
      afterFallbackMode,
      afterGameCap: gameCapped.length,
      finalReturnedPicks: finalRebounds.length,
    },
  };
}

app.get("/api/top-ev-picks", async (req, res) => {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ODDS_API_KEY is not set in process.env" });
  }

  const sportMap = {
    NHL: "icehockey_nhl",
    NBA: "basketball_nba",
  };
  const requestedSport = String(req.query.sport || "NHL").toUpperCase();
  const resolvedSportKey = sportMap[requestedSport] || sportMap.NHL;
  const book = req.query.book ? String(req.query.book) : undefined;
  const lowCostMode = ["1", "true", "yes", "on"].includes(
    String(req.query.lowCost || "").toLowerCase()
  );
  const parsedMaxEvents = Number(req.query.maxEvents);
  const maxEvents = Number.isFinite(parsedMaxEvents)
    ? Math.max(1, Math.min(20, Math.floor(parsedMaxEvents)))
    : lowCostMode ? 2 : null;

  function maybeLimitEventIds(eventIds) {
    if (!Array.isArray(eventIds)) return [];
    if (!maxEvents) return eventIds;
    return eventIds.slice(0, maxEvents);
  }

  try {
    const defaultShotsDebug = {
      totalRawSOGPicks: 0,
      afterDedupe: 0,
      afterConfidenceFilter: 0,
      afterEVFilter: 0,
      afterProjectionBuffer: 0,
      finalReturnedPicks: 0,
    };
    const defaultReboundsDebug = {
      totalRawReboundPicks: 0,
      afterDedupe: 0,
      afterConfidenceFilter: 0,
      afterEVFilter: 0,
      afterProjectionBuffer: 0,
      afterGameCap: 0,
      finalReturnedPicks: 0,
    };

    if (resolvedSportKey === sportMap.NBA) {
      const nbaStatsDebug = {
        nbaStatsTimeoutCount: 0,
        nbaStatsFailureCount: 0,
        nbaStatsSuccessCount: 0,
        nbaPlayersProcessedCount: 0,
        nbaPlayerMatchSuccessCount: 0,
        nbaPlayerMatchFailureCount: 0,
        nbaPlayerCacheHitCount: 0,
        nbaPlayerCacheMissCount: 0,
        nbaStatsCacheHitCount: 0,
        nbaStatsCacheMissCount: 0,
      };
      const nbaReboundMarketCandidates = ["player_rebounds", "player_rebounds_alternate"];
      const eventListUrl = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportMap.NBA)}/odds`);
      eventListUrl.searchParams.set("apiKey", apiKey);
      eventListUrl.searchParams.set("regions", "us");
      eventListUrl.searchParams.set("markets", "h2h");
      eventListUrl.searchParams.set("oddsFormat", "american");
      eventListUrl.searchParams.set("dateFormat", "iso");
      if (book) eventListUrl.searchParams.set("bookmakers", book);

      const listResponse = await fetch(eventListUrl.toString());
      if (!listResponse.ok) {
        const text = await listResponse.text();
        return res.status(listResponse.status).json({
          error: "failed fetching event list",
          details: text,
          requestedSport,
          resolvedSportKey,
        });
      }

      const listData = await listResponse.json();
      const allEventIds = Array.isArray(listData)
        ? listData.map((event) => event.id ?? event.event_id).filter(Boolean)
        : [];
      const eventIds = maybeLimitEventIds(allEventIds);
      const eventListCount = eventIds.length;
      const firstEventId = eventIds[0] ?? null;
      let rawBookmakerCount = 0;
      let firstEventMarketKeys = [];
      let firstBookmakerKey = null;
      let firstBookmakerTitle = null;
      let firstEventBookmakerKeys = [];
      let firstEventBookmakerMarkets = [];
      let firstEventHasPlayerRebounds = false;
      let firstEventPlayerReboundsOutcomeCount = 0;
      let firstEventDetectedReboundsMarketKeys = [];

      const picks = [];
      await Promise.all(
        eventIds.map(async (eventId, idx) => {
          const oddsUrl = new URL(
            `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportMap.NBA)}/events/${encodeURIComponent(eventId)}/odds`
          );
          oddsUrl.searchParams.set("apiKey", apiKey);
          oddsUrl.searchParams.set("regions", "us");
          oddsUrl.searchParams.set("markets", nbaReboundMarketCandidates.join(","));
          oddsUrl.searchParams.set("oddsFormat", "american");
          oddsUrl.searchParams.set("dateFormat", "iso");
          if (book) oddsUrl.searchParams.set("bookmakers", book);

          const oddsResponse = await fetch(oddsUrl.toString());
          if (!oddsResponse.ok) return;

          const oddsData = await oddsResponse.json();
          const bookmakers = Array.isArray(oddsData.bookmakers) ? oddsData.bookmakers : [];
          if (idx === 0) rawBookmakerCount = bookmakers.length;

          if (idx === 0) {
            const marketKeySet = new Set();
            const detectedReboundMarketSet = new Set();
            let playerReboundsOutcomeCount = 0;

            firstEventBookmakerKeys = bookmakers
              .map((b) => String(b.key || ""))
              .filter(Boolean);

            if (bookmakers.length > 0) {
              firstBookmakerKey = bookmakers[0].key || null;
              firstBookmakerTitle = bookmakers[0].title || null;
            }

            firstEventBookmakerMarkets = bookmakers.map((b) => {
              const marketsList = Array.isArray(b.markets) ? b.markets : [];
              const marketKeys = marketsList
                .map((m) => String(m.key || "").toLowerCase())
                .filter(Boolean);

              for (const marketKey of marketKeys) {
                marketKeySet.add(marketKey);
                if (marketKey.includes("rebound")) {
                  detectedReboundMarketSet.add(marketKey);
                }
              }

              for (const market of marketsList) {
                if (String(market.key || "").toLowerCase() !== "player_rebounds") continue;
                const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
                playerReboundsOutcomeCount += outcomes.length;
              }

              return {
                bookmakerKey: b.key || "",
                bookmakerTitle: b.title || "",
                marketKeys,
              };
            });

            firstEventMarketKeys = Array.from(marketKeySet).sort();
            firstEventDetectedReboundsMarketKeys = Array.from(detectedReboundMarketSet).sort();
            firstEventHasPlayerRebounds = firstEventMarketKeys.includes("player_rebounds");
            firstEventPlayerReboundsOutcomeCount = playerReboundsOutcomeCount;
          }

          for (const bookmaker of bookmakers) {
            if (book && bookmaker.key !== book) continue;
            const bookName = bookmaker.title || bookmaker.key || "";
            const marketsList = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];

            for (const m of marketsList) {
              const marketKey = String(m.key || "").toLowerCase();
              const isReboundsMarket =
                nbaReboundMarketCandidates.includes(marketKey) || marketKey.includes("rebound");
              if (!isReboundsMarket) continue;

              const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];

              for (const outcome of outcomes) {
                const outcomeName = String(outcome.name || "").trim();
                const outcomeDescription = String(outcome.description || "").trim();

                let side = outcomeName;
                let player = outcomeDescription;
                if (/^(over|under)$/i.test(outcomeDescription) && !/^(over|under)$/i.test(outcomeName)) {
                  side = outcomeDescription;
                  player = outcomeName;
                }
                if (!/^(over|under)$/i.test(side)) continue;

                const oddsValue = outcome.price ?? 0;
                const impliedProb = americanToImpliedProbability(oddsValue) ?? 0;
                const pick = normalizePick({
                  player,
                  team: "",
                  opp: "",
                  market: "Rebounds",
                  line: outcome.point ?? m.point ?? 0,
                  side,
                  book: bookName,
                  odds: oddsValue,
                  proj: 0,
                  fairProb: impliedProb,
                  impliedProb,
                  ev: 0,
                  confidence: 0,
                  notes: "live prop odds - projection pending",
                });
                pick._homeTeam = oddsData.home_team || "";
                pick._awayTeam = oddsData.away_team || "";
                picks.push(pick);
              }
            }
          }
        })
      );

      const reboundGroups = {};
      const reboundsRaw = picks.filter((pick) => pick.market === "Rebounds");
      for (const pick of reboundsRaw) {
        const key = `${pick.player}|${pick.market}|${pick.line}|${pick.book}`;
        if (!reboundGroups[key]) reboundGroups[key] = {};
        reboundGroups[key][pick.side] = pick;
      }

      const groupedKeys = Object.keys(reboundGroups);
      const reboundPairs = await Promise.all(
        groupedKeys.map(async (key) => {
          const group = reboundGroups[key];
          const over = group.Over;
          const under = group.Under;
          if (!over || !under) return [];

          let fairOver;
          let fairUnder;
          let notesText;
          let confScore;
          let proj = 0;

          try {
            const stats = await getPlayerReboundStats(
              over.player,
              over._homeTeam || "",
              over._awayTeam || "",
              nbaStatsDebug
            );
            const projMean = computeProjectedRebounds(stats);
            const statInputs = [stats.last10Avg, stats.last5Avg, stats.seasonAvg, stats.minutesAvg];
            const statInputsAvailable = statInputs.filter((value) => value != null).length;

            if (projMean != null && projMean > 0) {
              ({ fairOver, fairUnder } = fairProbsFromProjection(projMean, over.line));
              confScore = Math.round((statInputsAvailable / statInputs.length) * 100);
              notesText = NBA_REBOUNDS_MODEL_NOTES;
              proj = Math.round(projMean * 100) / 100;
            } else {
              const pOver = over.impliedProb;
              const pUnder = under.impliedProb;
              const sum = pOver + pUnder;
              if (sum === 0) return [];
              fairOver = pOver / sum;
              fairUnder = pUnder / sum;
              confScore = 10;
              notesText = NBA_REBOUNDS_FALLBACK_NOTES;
            }
          } catch (err) {
            const pOver = over.impliedProb;
            const pUnder = under.impliedProb;
            const sum = pOver + pUnder;
            if (sum === 0) return [];
            fairOver = pOver / sum;
            fairUnder = pUnder / sum;
            confScore = 10;
            notesText = NBA_REBOUNDS_FALLBACK_NOTES;
          }

          over.proj = proj;
          over.fairProb = Math.round(fairOver * 10000) / 10000;
          over.ev = Math.round((fairOver * americanPayout(over.odds) - (1 - fairOver)) * 10000) / 10000;
          over.confidence = confScore;
          over.notes = notesText;

          under.proj = proj;
          under.fairProb = Math.round(fairUnder * 10000) / 10000;
          under.ev = Math.round((fairUnder * americanPayout(under.odds) - (1 - fairUnder)) * 10000) / 10000;
          under.confidence = confScore;
          under.notes = notesText;

          return [over, under];
        })
      );
      const topRebounds = reboundPairs.flat();

      const cleanedTopReboundsResult = cleanTopRebounds(topRebounds);
      const returnedTopRebounds = cleanedTopReboundsResult.nbaModelPickCount > 0
        ? cleanedTopReboundsResult.topRebounds.filter(
          (pick) => pick.notes === NBA_REBOUNDS_MODEL_NOTES
        )
        : [];
      const topReboundsWithTracking = returnedTopRebounds.map((pick) => {
        const homeTeam = pick._homeTeam || "";
        const awayTeam = pick._awayTeam || "";
        return {
          ...pick,
          gameKey: `${homeTeam} vs ${awayTeam}`,
          pickKey: `${pick.player}|${pick.market}|${pick.side}|${pick.line}|${pick.book}`,
        };
      });
      const topReboundsDebug = {
        ...cleanedTopReboundsResult.debug,
        finalReturnedPicks: topReboundsWithTracking.length,
      };

      return res.json({
        topPoints: [],
        topAssists: [],
        topShots: [],
        topShotsDebug: defaultShotsDebug,
        topRebounds: topReboundsWithTracking,
        topReboundsDebug,
        nbaModelPickCount: cleanedTopReboundsResult.nbaModelPickCount,
        nbaFallbackPickCount: cleanedTopReboundsResult.nbaFallbackPickCount,
        nbaStatus: cleanedTopReboundsResult.nbaModelPickCount > 0 ? "model_ready" : "model_unavailable",
        allPicksCount: picks.length,
        requestedSport,
        resolvedSportKey,
        eventListCount,
        rawBookmakerCount,
        firstEventId,
        firstEventMarketKeys,
        firstBookmakerKey,
        firstBookmakerTitle,
        firstEventBookmakerKeys,
        firstEventBookmakerMarkets,
        firstEventHasPlayerRebounds,
        firstEventPlayerReboundsOutcomeCount,
        firstEventDetectedReboundsMarketKeys,
        nbaStatsTimeoutCount: nbaStatsDebug.nbaStatsTimeoutCount,
        nbaStatsFailureCount: nbaStatsDebug.nbaStatsFailureCount,
        nbaStatsSuccessCount: nbaStatsDebug.nbaStatsSuccessCount,
        nbaPlayersProcessedCount: nbaStatsDebug.nbaPlayersProcessedCount,
        nbaPlayerMatchSuccessCount: nbaStatsDebug.nbaPlayerMatchSuccessCount,
        nbaPlayerMatchFailureCount: nbaStatsDebug.nbaPlayerMatchFailureCount,
        nbaPlayerCacheHitCount: nbaStatsDebug.nbaPlayerCacheHitCount,
        nbaPlayerCacheMissCount: nbaStatsDebug.nbaPlayerCacheMissCount,
        nbaStatsCacheHitCount: nbaStatsDebug.nbaStatsCacheHitCount,
        nbaStatsCacheMissCount: nbaStatsDebug.nbaStatsCacheMissCount,
        nbaStatsSource: "balldontlie",
      });
    }

    // NHL explicit flow (default)
    const eventListUrl = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportMap.NHL)}/odds`);
    eventListUrl.searchParams.set("apiKey", apiKey);
    eventListUrl.searchParams.set("regions", "us");
    eventListUrl.searchParams.set("markets", "h2h");
    eventListUrl.searchParams.set("oddsFormat", "american");
    eventListUrl.searchParams.set("dateFormat", "iso");
    if (book) eventListUrl.searchParams.set("bookmakers", book);

    const listResponse = await fetch(eventListUrl.toString());
    if (!listResponse.ok) {
      const text = await listResponse.text();
      return res.status(listResponse.status).json({
        error: "failed fetching event list",
        details: text,
        requestedSport,
        resolvedSportKey,
      });
    }

    const listData = await listResponse.json();
    const allEventIds = Array.isArray(listData)
      ? listData.map((event) => event.id ?? event.event_id).filter(Boolean)
      : [];
    const eventIds = maybeLimitEventIds(allEventIds);
    const eventListCount = eventIds.length;
    let rawBookmakerCount = 0;

    const picks = [];
    await Promise.all(
      eventIds.map(async (eventId, idx) => {
        const oddsUrl = new URL(
          `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportMap.NHL)}/events/${encodeURIComponent(eventId)}/odds`
        );
        oddsUrl.searchParams.set("apiKey", apiKey);
        oddsUrl.searchParams.set("regions", "us");
        oddsUrl.searchParams.set("markets", "player_points,player_assists,player_shots_on_goal");
        oddsUrl.searchParams.set("oddsFormat", "american");
        oddsUrl.searchParams.set("dateFormat", "iso");
        if (book) oddsUrl.searchParams.set("bookmakers", book);

        const oddsResponse = await fetch(oddsUrl.toString());
        if (!oddsResponse.ok) return;

        const oddsData = await oddsResponse.json();
        const bookmakers = Array.isArray(oddsData.bookmakers) ? oddsData.bookmakers : [];
        if (idx === 0) rawBookmakerCount = bookmakers.length;

        for (const bookmaker of bookmakers) {
          if (book && bookmaker.key !== book) continue;

          const bookName = bookmaker.title || bookmaker.key || "";
          const marketsList = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];

          for (const m of marketsList) {
            if (!["player_points", "player_assists", "player_shots_on_goal"].includes(m.key)) continue;
            const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];

            for (const outcome of outcomes) {
              const oddsValue = outcome.price ?? 0;
              const impliedProb = americanToImpliedProbability(oddsValue) ?? 0;
              const marketLabel =
                m.key === "player_points" ? "Points"
                : m.key === "player_assists" ? "Assists"
                : "Shots on Goal";

              const pick = normalizePick({
                player: outcome.description || "",
                team: "",
                opp: "",
                market: marketLabel,
                line: outcome.point ?? 0,
                side: outcome.name || "",
                book: bookName,
                odds: oddsValue,
                proj: 0,
                fairProb: impliedProb,
                impliedProb,
                ev: 0,
                confidence: 0,
                notes: "live prop odds - projection pending",
              });
              pick._homeTeam = oddsData.home_team || "";
              pick._awayTeam = oddsData.away_team || "";
              picks.push(pick);
            }
          }
        }
      })
    );

    const shotsRaw = picks.filter((p) => p.market === "Shots on Goal");
    const shotsGroups = {};
    for (const pick of shotsRaw) {
      const key = `${pick.player}|${pick.line}|${pick.book}`;
      if (!shotsGroups[key]) shotsGroups[key] = {};
      shotsGroups[key][pick.side] = pick;
    }

    const standingsMap = await getTeamStandingsMap();
    const topShots = [];

    for (const key of Object.keys(shotsGroups)) {
      const group = shotsGroups[key];
      const over = group.Over;
      const under = group.Under;
      if (!over || !under) continue;

      const stats = await getPlayerSOGStats(
        over.player,
        over._homeTeam || "",
        over._awayTeam || "",
        standingsMap
      );
      const projMean = computeProjectedSOG(stats);

      let fairOver;
      let fairUnder;
      let notesText;
      let confScore;

      const statFields = [
        stats.last10Avg,
        stats.last5Avg,
        stats.seasonAvg,
        stats.avgTOI,
        stats.avgPPTOI,
        stats.teamShotsForPer60,
        stats.opponentShotsAllowedPer60,
      ];
      const dataPointsAvailable = statFields.filter((v) => v != null).length;

      if (projMean != null && projMean > 0) {
        ({ fairOver, fairUnder } = fairProbsFromProjection(projMean, over.line));
        confScore = Math.round((dataPointsAvailable / statFields.length) * 100);
        notesText = "model EV estimate using NHL recent SOG data";
      } else {
        const pOver = over.impliedProb;
        const pUnder = under.impliedProb;
        const sum = pOver + pUnder;
        if (sum === 0) continue;
        fairOver = pOver / sum;
        fairUnder = pUnder / sum;
        confScore = 10;
        notesText = "no-vig fallback (player stats not yet available)";
      }

      const proj = projMean != null ? Math.round(projMean * 100) / 100 : 0;

      over.proj = proj;
      over.fairProb = Math.round(fairOver * 10000) / 10000;
      over.ev = Math.round((fairOver * americanPayout(over.odds) - (1 - fairOver)) * 10000) / 10000;
      over.confidence = confScore;
      over.notes = notesText;

      under.proj = proj;
      under.fairProb = Math.round(fairUnder * 10000) / 10000;
      under.ev = Math.round((fairUnder * americanPayout(under.odds) - (1 - fairUnder)) * 10000) / 10000;
      under.confidence = confScore;
      under.notes = notesText;

      topShots.push(over, under);
    }

    const cleanedTopShotsResult = cleanTopShots(topShots);

    const topPoints = picks
      .filter((p) => p.market === "Points")
      .sort((a, b) => b.impliedProb - a.impliedProb)
      .slice(0, 10);
    const topAssists = picks
      .filter((p) => p.market === "Assists")
      .sort((a, b) => b.impliedProb - a.impliedProb)
      .slice(0, 10);

    const topShotsWithTracking = cleanedTopShotsResult.topShots.map((pick) => {
      const homeTeam = pick._homeTeam || "";
      const awayTeam = pick._awayTeam || "";
      return {
        ...pick,
        gameKey: `${homeTeam} vs ${awayTeam}`,
        pickKey: `${pick.player}|${pick.market}|${pick.side}|${pick.line}|${pick.book}`,
      };
    });

    return res.json({
      topPoints,
      topAssists,
      topShots: topShotsWithTracking,
      topShotsDebug: cleanedTopShotsResult.debug,
      topRebounds: [],
      topReboundsDebug: defaultReboundsDebug,
      allPicksCount: picks.length,
      requestedSport,
      resolvedSportKey,
      eventListCount,
      rawBookmakerCount,
    });
  } catch (error) {
    return res.status(500).json({
      error: "request failed",
      details: String(error),
    });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
