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

    // --- Shots on Goal: true EV logic ---
    const shotsRaw = picks.filter((p) => p.market === "Shots on Goal");
    // Group by player+line+book
    const shotsGroups = {};
    for (const pick of shotsRaw) {
      const key = `${pick.player}|${pick.line}|${pick.book}`;
      if (!shotsGroups[key]) shotsGroups[key] = {};
      shotsGroups[key][pick.side] = pick;
    }

    const topShots = [];
    for (const key in shotsGroups) {
      const group = shotsGroups[key];
      const over = group["Over"];
      const under = group["Under"];
      if (!over || !under) continue; // Need both sides

      // Implied probabilities
      const pOver = over.impliedProb;
      const pUnder = under.impliedProb;
      const sum = pOver + pUnder;
      if (sum === 0) continue;
      // No-vig probabilities
      const fairOver = pOver / sum;
      const fairUnder = pUnder / sum;

      // EV calculation: EV = (fairProb * payout) - (1 - fairProb)
      // payout = odds/100 if +odds, 100/abs(odds) if -odds
      function payout(odds) {
        if (odds > 0) return odds / 100;
        return 100 / Math.abs(odds);
      }
      over.fairProb = fairOver;
      under.fairProb = fairUnder;
      over.ev = (fairOver * payout(over.odds)) - (1 - fairOver);
      under.ev = (fairUnder * payout(under.odds)) - (1 - fairUnder);
      over.notes = "no-vig EV estimate";
      under.notes = "no-vig EV estimate";
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
