import app from "./app.js";

const PORT = process.env.PORT || 5001;
console.log("Starting server...")
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});