/**
 * Start an ngrok tunnel to the API port, set NGROK_URL, then boot the backend.
 * Webhook callback URLs resolve via getApiPublicBaseUrl() (NGROK_URL before VITE_FRONTEND_URL).
 *
 * Uses the official @ngrok/ngrok SDK (current ngrok cloud). The legacy `ngrok` npm package is unsupported.
 *
 * Prerequisites (pick one):
 * - Set NGROK_AUTHTOKEN in backend/.env (https://dashboard.ngrok.com/get-started/your-authtoken — use Authtoken, not an API key), or
 * - Run `ngrok http <PORT>` yourself and set NGROK_URL to the HTTPS origin (then use `npm start` instead).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import ngrok from "@ngrok/ngrok";
import { WEBHOOK_PATHS } from "../src/constants/contstants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, "..", ".env") });

const port = Number(process.env.PORT || 5000);
let startedTunnel = false;
/** @type {{ url: () => string; close: () => Promise<void> } | null} */
let ngrokListener = null;

let ngrokUrl = (process.env.NGROK_URL || "").trim().replace(/\/+$/, "");

if (!ngrokUrl) {
  const authtoken = (process.env.NGROK_AUTHTOKEN || "").trim();
  if (!authtoken) {
    console.error(
      "[dev-with-ngrok] Missing NGROK_URL and NGROK_AUTHTOKEN. Add NGROK_AUTHTOKEN to .env or set NGROK_URL to an existing tunnel HTTPS origin.",
    );
    process.exit(1);
  }
  try {
    ngrokListener = await ngrok.forward({
      addr: `127.0.0.1:${port}`,
      authtoken,
    });
    ngrokUrl = String(ngrokListener.url()).replace(/\/+$/, "");
    process.env.NGROK_URL = ngrokUrl;
    startedTunnel = true;
    console.error(`[dev-with-ngrok] Tunnel: ${ngrokUrl} → http://127.0.0.1:${port}`);
    console.error(`[dev-with-ngrok] SCM webhooks: ${ngrokUrl}${WEBHOOK_PATHS.GITHUB_PUSH}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[dev-with-ngrok] Failed to start tunnel:", msg);
    if (err instanceof Error && err.cause) {
      console.error("[dev-with-ngrok] Cause:", err.cause);
    }
    console.error(
      "[dev-with-ngrok] Use the Authtoken from https://dashboard.ngrok.com/get-started/your-authtoken (not an API key). Strip quotes/spaces in .env.",
    );
    process.exit(1);
  }
} else {
  console.error(`[dev-with-ngrok] Using NGROK_URL=${ngrokUrl} (no embedded tunnel)`);
}

async function shutdown() {
  if (startedTunnel && ngrokListener) {
    try {
      await ngrokListener.close();
    } catch {
      try {
        await ngrok.disconnect();
      } catch {
        // ignore
      }
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await import("../src/server.js");
