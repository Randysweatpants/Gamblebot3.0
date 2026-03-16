import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";

const app: Express = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(express.static(publicDir));

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
