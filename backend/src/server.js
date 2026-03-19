import app from "./app.js";
import config from "./config/index.js";
import { startAllProjectServers } from "./projectServers.js";
import { cleanupStalePreviews } from "./services/project.service.js";
import { warmupJwksCache } from "./utils/cognitoAuth.js";

const PORT = config.PORT;
// In Docker the server must listen on 0.0.0.0 to accept connections from outside the container
const HOST = process.env.HOST || "0.0.0.0";

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

console.log("Starting server...");
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${config.BASE_URL}`);
  warmupJwksCache().then(() => console.log("JWKS cache warmed up")).catch(() => {});
  // Delay so DB is ready in Docker; then start per-project static servers (localhost:8004 etc.)
  setTimeout(() => {
    startAllProjectServers().catch((err) => console.error("[startup] project servers:", err.message));
  }, 2000);

  // _preview TTL: remove preview build dirs after 1 hour (also runs at switch version start)
  cleanupStalePreviews().catch(() => {});
  const PREVIEW_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
  setInterval(() => {
    cleanupStalePreviews().catch((e) => console.warn("[preview cleanup]", e.message));
  }, PREVIEW_CLEANUP_INTERVAL_MS);
});
