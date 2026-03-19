import dns from "dns";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { IPv4Fetcher } from "./ipv4Fetcher.js";

// dns.setDefaultResultOrder("ipv4");
dns.setDefaultResultOrder("verbatim");
const prisma = new PrismaClient();

let cognitoIdVerifier = null;
let cognitoAccessVerifier = null;
let jwksCache = null;

function getCognitoEnv() {
  const userPoolId = (process.env.AWS_COGNITO_USER_POOL_ID)?.trim();
  const clientId = (process.env.AWS_COGNITO_APP_CLIENT_ID)?.trim();
  return { userPoolId, clientId };
}

function getJwksCache() {
  if (!jwksCache) jwksCache = new SimpleJwksCache({ fetcher: new IPv4Fetcher() });
  return jwksCache;
}

/**
 * Get Cognito ID token verifier (for launchpad API validation).
 * Uses IPv4-only JWKS fetcher to avoid connectivity issues to AWS.
 */
export function getCognitoVerifier() {
  const { userPoolId, clientId } = getCognitoEnv();
  if (!userPoolId || !clientId) return null;
  if (!cognitoIdVerifier) {
    cognitoIdVerifier = CognitoJwtVerifier.create(
      { userPoolId, tokenUse: "id", clientId },
      { jwksCache: getJwksCache() }
    );
  }
  return cognitoIdVerifier;
}

/**
 * Get Cognito access token verifier. Frontend uses access token for Hub and launchpad;
 * launchpad accepts both ID and access tokens.
 */
export function getCognitoAccessVerifier() {
  const { userPoolId, clientId } = getCognitoEnv();
  if (!userPoolId || !clientId) return null;
  if (!cognitoAccessVerifier) {
    cognitoAccessVerifier = CognitoJwtVerifier.create(
      { userPoolId, tokenUse: "access", clientId },
      { jwksCache: getJwksCache() }
    );
  }
  return cognitoAccessVerifier;
}

/**
 * Pre-fetch JWKS on startup to avoid cold start on first request.
 * Call once after app starts (e.g. in app.js or server entry).
 */
export async function warmupJwksCache() {
  const { userPoolId } = getCognitoEnv();
  if (!userPoolId) return;
  try {
    const verifier = getCognitoVerifier();
    if (!verifier) return;
    const { jwksUri } = CognitoJwtVerifier.parseUserPoolId(userPoolId);
    if (jwksCache) await jwksCache.getJwks(jwksUri);
  } catch (err) {
    const msg = err?.message || "Unknown error";
    console.warn(`[cognitoAuth] JWKS warmup failed: ${msg}. Will retry on first request.`);
  }
}

/**
 * Extract email from Cognito payload. DB uses email (not username); Hub/Cognito may send
 * email in different claims. Prefer explicit email claims; use username/preferred_username
 * only when they look like an email (contain @).
 */
function getEmailFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.email,
    payload["cognito:username"],
    payload["custom:email"],
    payload.username,
    payload.preferred_username,
  ].filter(Boolean);
  for (const v of candidates) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    if (s.includes("@")) return s;
  }
  return null;
}

/**
 * From verified Cognito token payload (ID or access): find or create launchpad DB user.
 * Email is taken from payload (email, cognito:username, username when it looks like email, etc.);
 * DB field is email, not username. Returns null if domain restricted or no email found.
 */
export async function findOrCreateUserFromCognitoPayload(payload, role = "manager") {
  const email = getEmailFromPayload(payload);
  if (!email) return null;
  const allowedDomain = process.env.AUTH_ALLOWED_DOMAIN?.trim();
  if (allowedDomain && !email.endsWith(allowedDomain)) return null;
  const name = payload.name || payload.given_name || email.split("@")[0];
  const picture = payload.picture ?? null;
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const randomPassword = crypto.randomBytes(16).toString("hex");
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role, image: picture },
    });
  } else {
    const updateData = {};
    if (name && name !== user.name) updateData.name = name;
    if (picture !== undefined && picture !== user.image) updateData.image = picture;
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { email },
        data: updateData,
      });
      user = await prisma.user.findUnique({ where: { email } });
    }
  }
  return user;
}
