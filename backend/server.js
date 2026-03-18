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

    if (eventIds.length === 0) {
      return res.json({ picks: [] });
    }

    const firstEventId = eventIds[0];
    const markets = ["player_points", "player_assists", "player_shots_on_goal"];

    const oddsUrl = new URL(
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(
        firstEventId
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
      const text = await oddsResponse.text();
      return res.status(oddsResponse.status).json({ error: "failed fetching odds", details: text });
    }

    const oddsData = await oddsResponse.json();
    console.log("Raw event-odds response for first NHL event:", oddsData);

    return res.json({ eventId: firstEventId, raw: oddsData });
  } catch (error) {
    return res.status(500).json({ error: "request failed", details: String(error) });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
