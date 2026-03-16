import { Router, type IRouter } from "express";
import { db, gamesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/games", async (req, res) => {
  try {
    const sport = (req.query.sport as string) || "NHL";
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

    const games = await db
      .select()
      .from(gamesTable)
      .where(and(eq(gamesTable.sport, sport), eq(gamesTable.game_date, date)));

    res.json({ games, date, sport });
  } catch (err) {
    console.error("GET /games error:", err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

export default router;
