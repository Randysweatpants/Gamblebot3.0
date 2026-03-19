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
// Replace getPlayerSOGStats() body with a live stats source
// (e.g. NHL API, Natural Stat Trick, MoneyPuck) when ready.
// The mocked structure is kept so the projection engine and EV
// logic work end-to-end against live odds today.
// ============================================================

const LEAGUE_AVG_SHOTS_ALLOWED_PER60 = 30.5; // approximate NHL team average

/**
 * Returns per-player SOG stats keyed by player name.
 * All values are null until a real data source is wired in.
 * @param {string} _playerName
 * @returns {{ last10Avg: number|null, last5Avg: number|null, seasonAvg: number|null,
 *             avgTOI: number|null, avgPPTOI: number|null,
 *             teamShotsForPer60: number|null, opponentShotsAllowedPer60: number|null }}
 */
function getPlayerSOGStats(_playerName) {
  // TODO: replace stub with live lookup (e.g. fetch from NHL stats API by playerName)
  return {
    last10Avg: null,                   // player's last-10-game SOG average
    last5Avg: null,                    // player's last-5-game SOG average
    seasonAvg: null,                   // player's full-season SOG average
    avgTOI: null,                      // average time on ice (minutes)
    avgPPTOI: null,                    // average power-play TOI (minutes)
    teamShotsForPer60: null,           // team shots-for per 60 min
    opponentShotsAllowedPer60: null,   // opponent shots allowed per 60 min
  };
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
  const { last10Avg, last5Avg, seasonAvg, avgTOI, avgPPTOI, opponentShotsAllowedPer60 } = stats;

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

  // Opponent shot-environment adjustment (10% weight bucket)
  let oppAdjusted = baseProjected;
  if (opponentShotsAllowedPer60 != null) {
    const oppScalar = Math.min(
      Math.max(opponentShotsAllowedPer60 / LEAGUE_AVG_SHOTS_ALLOWED_PER60, 0.8),
      1.2
    );
    oppAdjusted = baseProjected * oppScalar;
  }

  // Final blend: 80% base | 10% toi-adjusted | 10% opp-adjusted
  return (baseProjected * 80 + toiAdjusted * 10 + oppAdjusted * 10) / 100;
}

/** Decimal payout per $1 risked from American odds */
function americanPayout(odds) {
  if (odds > 0) return odds / 100;
  return 100 / Math.abs(odds);
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

    const topShots = [];
    for (const key of Object.keys(shotsGroups)) {
      const group = shotsGroups[key];
      const over = group["Over"];
      const under = group["Under"];
      if (!over || !under) continue; // both sides required

      const playerName = over.player;
      const line = over.line;

      // Fetch player stats from adapter (placeholder until real source is wired)
      const stats = getPlayerSOGStats(playerName);
      const projMean = computeProjectedSOG(stats);

      let fairOver, fairUnder, notesText, confScore;

      const statFields = [
        stats.last10Avg,
        stats.last5Avg,
        stats.seasonAvg,
        stats.avgTOI,
        stats.opponentShotsAllowedPer60,
      ];
      const dataPointsAvailable = statFields.filter((v) => v != null).length;

      if (projMean != null && projMean > 0) {
        // --- Model-based path: Poisson fair probabilities from projection ---
        ({ fairOver, fairUnder } = fairProbsFromProjection(projMean, line));
        confScore = Math.round((dataPointsAvailable / statFields.length) * 100);
        notesText = "model EV estimate using recent SOG + role + opponent";
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

    // Sort by EV descending, take top 10
    const sortedTopShots = topShots.sort((a, b) => b.ev - a.ev).slice(0, 10);

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
      topShots: sortedTopShots,
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
