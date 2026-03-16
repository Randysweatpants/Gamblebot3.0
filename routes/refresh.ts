import { Router, type IRouter } from "express";
import { runNHLDataPipeline } from "../services/nhl/nhl-data-pipeline.js";

const router: IRouter = Router();

router.post("/refresh-data", async (req, res) => {
  try {
    const sport = (req.body?.sport as string) || "NHL";

    if (sport === "NHL") {
      const result = await runNHLDataPipeline();
      const totalRecords = result.games + result.players + result.props;
      res.json({
        success: result.errors.length === 0 || totalRecords > 0,
        message: `NHL data refreshed: ${result.games} games, ${result.players} players, ${result.props} props`,
        records_updated: totalRecords,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } else {
      res.json({
        success: false,
        message: `Sport '${sport}' not yet supported. Currently supporting: NHL`,
        records_updated: 0,
      });
    }
  } catch (err) {
    console.error("POST /refresh-data error:", err);
    res.status(500).json({ error: "Failed to refresh data", detail: String(err) });
  }
});

export default router;
