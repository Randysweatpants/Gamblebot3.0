import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import sportsRouter from "./sports.js";
import gamesRouter from "./games.js";
import propsRouter from "./props.js";
import playersRouter from "./players.js";
import refreshRouter from "./refresh.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sportsRouter);
router.use(gamesRouter);
router.use(propsRouter);
router.use(playersRouter);
router.use(refreshRouter);

export default router;
