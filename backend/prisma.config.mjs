import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root .env is canonical for Docker; backend/.env overrides for local CLI.
loadEnv({ path: resolve(__dirname, "../.env"), quiet: true });
loadEnv({ path: resolve(__dirname, ".env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "node prisma/seed.js",
  },
});
