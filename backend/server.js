import express from "express";
import cors from "cors";

const app = express();

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

app.get("/api/top-ev-picks", async (req, res) => {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ODDS_API_KEY is not set in process.env" });
  }

  const sport = "icehockey_nhl";
  const book = req.query.book ? String(req.query.book) : undefined;

  const eventListUrl = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds`);
  eventListUrl.searchParams.set("apiKey", apiKey);
  eventListUrl.searchParams.set("regions", "us");
  eventListUrl.searchParams.set("markets", "h2h");
  eventListUrl.searchParams.set("oddsFormat", "american");
  eventListUrl.searchParams.set("dateFormat", "iso");
  if (book) eventListUrl.searchParams.set("bookmakers", book);

  try {
    const listResponse = await fetch(eventListUrl.toString());
    if (!listResponse.ok) {
      const text = await listResponse.text();
      return res.status(listResponse.status).json({
        error: "failed fetching event list",
        details: text,
      });
    }

    const listData = await listResponse.json();
    const eventIds = Array.isArray(listData)
      ? listData.map((event) => event.id ?? event.event_id).filter(Boolean)
      : [];

    const markets = ["player_points", "player_assists", "player_shots_on_goal"];
    const marketMap = {
      player_points: "Points",
      player_assists: "Assists",
      player_shots_on_goal: "Shots on Goal",
    };

    const picks = [];

    await Promise.all(
      eventIds.map(async (eventId) => {
        const oddsUrl = new URL(
          `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds`
        );
        oddsUrl.searchParams.set("apiKey", apiKey);
        oddsUrl.searchParams.set("regions", "us");
        oddsUrl.searchParams.set("markets", markets.join(","));
        oddsUrl.searchParams.set("oddsFormat", "american");
        oddsUrl.searchParams.set("dateFormat", "iso");
        if (book) oddsUrl.searchParams.set("bookmakers", book);

        const oddsResponse = await fetch(oddsUrl.toString());
        if (!oddsResponse.ok) {
          return;
        }

        const oddsData = await oddsResponse.json();
        const bookmakers = Array.isArray(oddsData.bookmakers) ? oddsData.bookmakers : [];

        for (const bookmaker of bookmakers) {
          if (book && bookmaker.key !== book) continue;

          const bookName = bookmaker.title || bookmaker.key || "";
          const marketsList = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];

          for (const m of marketsList) {
            if (!markets.includes(m.key)) continue;

            const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];

            for (const outcome of outcomes) {
              const oddsValue = outcome.price ?? 0;
              const impliedProb = americanToImpliedProbability(oddsValue) ?? 0;

              const pick = normalizePick({
                player: outcome.description || "",
                team: "",
                opp: "",
                market: marketMap[m.key] || m.key,
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
              // Store event context for team/opponent environment lookup
              pick._homeTeam = oddsData.home_team || "";
              pick._awayTeam = oddsData.away_team || "";

              picks.push(pick);
            }
          }
        }
      })
    );

    // --- Shots on Goal: model-based EV ---
    const shotsRaw = picks.filter((p) => p.market === "Shots on Goal");

    // Pair Over and Under by player + line + book
    const shotsGroups = {};
    for (const pick of shotsRaw) {
      const key = `${pick.player}|${pick.line}|${pick.book}`;
      if (!shotsGroups[key]) shotsGroups[key] = {};
      shotsGroups[key][pick.side] = pick;
    }

    // Fetch standings once for the whole SOG loop (cached; one NHL API call)
    const standingsMap = await getTeamStandingsMap();

    const topShots = [];
    for (const key of Object.keys(shotsGroups)) {
      const group = shotsGroups[key];
      const over = group["Over"];
      const under = group["Under"];
      if (!over || !under) continue; // both sides required

      const playerName = over.player;
      const line = over.line;

      // Fetch real player stats + team/opp environment from NHL API
      const stats = await getPlayerSOGStats(
        playerName,
        over._homeTeam || "",
        over._awayTeam || "",
        standingsMap
      );
      const projMean = computeProjectedSOG(stats);

      let fairOver, fairUnder, notesText, confScore;

      // 7-field confidence: rolling windows + TOI + PPTOI + team env + opp env
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
        // --- Model-based path: Poisson fair probabilities from projection ---
        ({ fairOver, fairUnder } = fairProbsFromProjection(projMean, line));
        confScore = Math.round((dataPointsAvailable / statFields.length) * 100);
        notesText = "model EV estimate using NHL recent SOG data";
      } else {
        // --- Fallback: no-vig removal when no player stats are available ---
        const pOver = over.impliedProb;
        const pUnder = under.impliedProb;
        const sum = pOver + pUnder;
        if (sum === 0) continue;
        fairOver = pOver / sum;
        fairUnder = pUnder / sum;
        confScore = 10; // low confidence – no stat data
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

    // Placeholder logic for Points/Assists
    const topPoints = picks
      .filter((p) => p.market === "Points")
      .sort((a, b) => b.impliedProb - a.impliedProb)
      .slice(0, 10);

    const topAssists = picks
      .filter((p) => p.market === "Assists")
      .sort((a, b) => b.impliedProb - a.impliedProb)
      .slice(0, 10);

    return res.json({
      topPoints,
      topAssists,
      topShots: cleanedTopShotsResult.topShots,
      topShotsDebug: cleanedTopShotsResult.debug,
      allPicksCount: picks.length,
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
