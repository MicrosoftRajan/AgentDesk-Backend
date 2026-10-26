import cors from "cors";
import express from "express";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import api from "./routes/index.js";

const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "agentdesk-api",
    },
  });
});

app.use("/api/v1", api);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
