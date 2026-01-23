import app from "./app.js";
import config from "./config/index.js";

const PORT = config.PORT;

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

console.log("Starting server...")
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${config.BASE_URL}`);
});
