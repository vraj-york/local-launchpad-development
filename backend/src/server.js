import app from "./app.js";
import config from "./config/index.js";
import { startAllProjectServers } from "./projectServers.js";

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
  // Delay so DB is ready in Docker; then start per-project static servers (localhost:8004 etc.)
  setTimeout(() => {
    startAllProjectServers().catch((err) => console.error("[startup] project servers:", err.message));
  }, 2000);
});
