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
  const minEv = req.query.minEv ? Number(req.query.minEv) : -Infinity;
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
      return res.status(listResponse.status).json({ error: "failed fetching event list", details: text });
    }

    const listData = await listResponse.json();
    const eventIds = Array.isArray(listData)
      ? listData.map((event) => event.id ?? event.event_id).filter(Boolean)
      : [];

    const markets = ["player_points", "player_assists", "player_shots_on_goal"];
    const marketMap = {
      player_points: "Points",
      player_assists: "Assists",
      player_shots_on_goal: "Shots on Goal"
    };
    const picks = [];

    await Promise.all(
      eventIds.map(async (eventId) => {
        const oddsUrl = new URL(
          `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(
            eventId
          )}/odds`
        );
        oddsUrl.searchParams.set("apiKey", apiKey);
        oddsUrl.searchParams.set("regions", "us");
        oddsUrl.searchParams.set("markets", markets.join(","));
        oddsUrl.searchParams.set("oddsFormat", "american");
        oddsUrl.searchParams.set("dateFormat", "iso");
        if (book) oddsUrl.searchParams.set("bookmakers", book);

        const oddsResponse = await fetch(oddsUrl.toString());
        if (!oddsResponse.ok) {
          return; // ignore failures for individual events
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

    return res.json({ picks });
  } catch (error) {
    return res.status(500).json({ error: "request failed", details: String(error) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
