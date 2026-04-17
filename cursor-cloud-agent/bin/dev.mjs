#!/usr/bin/env node

import { createServer } from "net";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { networkInterfaces } from "os";
import { randomInt } from "crypto";
import qrcode from "qrcode-terminal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

function isValidPort(n) {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/** CLI wins over PORT env: `-p` / `--port`, or a bare port token (e.g. `npm start -- -p 3055` → `--start 3055`). */
function parsePortFromArgv(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-p" || a === "--port") {
      const v = args[i + 1];
      if (v !== undefined) {
        const n = parseInt(v, 10);
        if (isValidPort(n)) return n;
        i++;
      }
    }
  }
  for (const a of args) {
    if (a === "--start" || a === "--log" || a === "-p" || a === "--port") continue;
    if (/^\d+$/.test(a)) {
      const n = parseInt(a, 10);
      if (isValidPort(n)) return n;
    }
  }
  return null;
}

function defaultPortFromEnv() {
  const n = parseInt(process.env.PORT || "3100", 10);
  if (!Number.isFinite(n) || !isValidPort(n)) return 3100;
  return n;
}

const startPort = parsePortFromArgv(process.argv) ?? defaultPortFromEnv();
const MAX_ATTEMPTS = 20;

const WORDS = [
  "alpha","amber","apple","atlas","azure","birch","blaze","bloom","brave","brook",
  "cedar","charm","chess","climb","cloud","coral","crane","crisp","crown","dance",
  "delta","dream","drift","eagle","ember","fable","flame","flint","frost","gleam",
  "globe","grace","grove","haven","hazel","honey","ivory","jewel","karma","latch",
  "lemon","light","lotus","maple","marsh","melon","mirth","noble","north","oasis",
  "ocean","olive","orbit","pearl","petal","pilot","plume","prism","quail","quest",
  "raven","ridge","rover","royal","ruby","sage","shore","silk","slate","solar",
  "spark","spire","stone","storm","swift","thorn","tiger","torch","trail","trend",
  "trick","trout","tulip","ultra","umbra","unity","upper","urban","vault","verse",
  "vigor","vinyl","viola","viper","vivid","wagon","watch","wheat","whirl","width",
  "wired","yacht","zebra","zephyr",
];

function generateToken() {
  return `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}`;
}

function isPortAvailable(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once("error", () => res(false));
    srv.listen(port, "0.0.0.0", () => srv.close(() => res(true)));
  });
}

async function findPort(start) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const p = start + i;
    if (p > 65535) break;
    if (await isPortAvailable(p)) return p;
  }
  return null;
}

const port = await findPort(startPort);
if (!port) {
  console.error(`No available port found starting from ${startPort}`);
  process.exit(1);
}
if (port !== startPort) {
  console.log(`Port ${startPort} in use, using ${port}`);
}

const authToken = process.env.AUTH_TOKEN || generateToken();

const isStart = process.argv.includes("--start");
const httpLog = process.argv.includes("--log");
const nextBin = resolve(projectRoot, "node_modules", ".bin", "next");
const args = isStart
  ? ["start", "--hostname", "0.0.0.0", "--port", String(port)]
  : ["dev", "--hostname", "0.0.0.0", "--port", String(port)];

const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((a) => a?.family === "IPv4" && !a.internal)?.address;

const localUrl = `http://localhost:${port}`;
const networkUrl = lanIp ? `http://${lanIp}:${port}` : null;
const authUrl = `${networkUrl || localUrl}?token=${authToken}`;

console.log(`\n  \x1b[2mLocal:\x1b[0m   ${localUrl}?token=${authToken}`);
if (networkUrl) {
  console.log(`  \x1b[2mNetwork:\x1b[0m ${authUrl}`);
}
console.log(`  \x1b[2mToken:\x1b[0m   ${authToken}\n`);

if (networkUrl) {
  console.log("  \x1b[2mScan to connect from your phone:\x1b[0m\n");
  qrcode.generate(authUrl, { small: true }, (code) => {
    console.log(code.split("\n").map((l) => "    " + l).join("\n") + "\n");
  });
}

const child = spawn(nextBin, args, {
  cwd: projectRoot,
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    AUTH_TOKEN: authToken,
    ...(httpLog ? { CLR_DEV_HTTP_LOG: "1" } : {}),
  },
});

child.on("close", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
