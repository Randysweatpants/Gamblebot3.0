import { Router, type IRouter } from "express";
import { db, sportsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/sports", async (_req, res) => {
  try {
    const sports = await db.select().from(sportsTable).where(undefined);
    res.json({ sports });
  } catch (err) {
    console.error("GET /sports error:", err);
    res.status(500).json({ error: "Failed to fetch sports" });
  }
});

export default router;
