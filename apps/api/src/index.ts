import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logInfo } from "./observability/logger.js";

const app = createApp();

app.listen(env.API_PORT, () => {
  logInfo("server.start", {
    port: env.API_PORT,
    url: `http://localhost:${env.API_PORT}`
  });
});
