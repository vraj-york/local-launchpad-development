import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root .env (e.g. docker-compose); backend/.env wins for same keys so local DATABASE_URL is not shadowed by root.
loadEnv({ path: resolve(__dirname, "../.env"), quiet: true });
loadEnv({ path: resolve(__dirname, ".env"), quiet: true, override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "node prisma/seed.js",
  },
});
