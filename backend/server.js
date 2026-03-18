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

  const sport = req.query.sport === "NHL" ? "icehockey_nhl" : String(req.query.sport || "icehockey_nhl");
  const market = String(req.query.market || "playerprops");
  const book = req.query.book ? String(req.query.book) : undefined;
  const team = req.query.team ? String(req.query.team) : undefined;
  const minEv = req.query.minEv ? Number(req.query.minEv) : -Infinity;

  const url = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", market);
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  if (book) url.searchParams.set("bookmakers", book);
  if (team) url.searchParams.set("teams", team);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: "failed fetching odds", details: text });
    }

    const data = await response.json();

    const picks = [];

    if (Array.isArray(data)) {
      for (const event of data) {
        const teams = Array.isArray(event.teams) ? event.teams : [];
        const [homeTeam, awayTeam] = teams;
        const oppMap = {
          [homeTeam]: awayTeam,
          [awayTeam]: homeTeam,
        };

        const bookmakers = Array.isArray(event.bookmakers) ? event.bookmakers : [];
        for (const bookmaker of bookmakers) {
          if (book && bookmaker.key !== book) continue;
          const bookName = bookmaker.title || bookmaker.key || "";
          const markets = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];
          for (const m of markets) {
            if (market && m.key !== market) continue;
            const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];

            for (const outcome of outcomes) {
              const oddsValue = outcome.price ?? outcome.odds ?? 0;
              const impliedProb = americanToImpliedProbability(oddsValue) ?? 0;
              const fairProb = impliedProb;
              const ev = impliedProb; // placeholder: without projection, EV is just implied probability

              const pick = normalizePick({
                player: outcome.name || "",
                team: outcome.name || "",
                opp: oppMap[outcome.name] || "",
                market: m.key || market,
                line: outcome.point ?? 0,
                side: outcome.name || "",
                book: bookName,
                odds: oddsValue,
                proj: 0,
                fairProb,
                impliedProb,
                ev,
                confidence: 0,
                notes: "raw normalized odds data",
              });

              if (ev >= minEv) {
                picks.push(pick);
              }
            }
          }
        }
      }
    }

    return res.json({ picks });
  } catch (error) {
    return res.status(500).json({ error: "request failed", details: String(error) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
