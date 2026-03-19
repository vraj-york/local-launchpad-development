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
let jwksCache = null;

function getCognitoEnv() {
  const userPoolId = (process.env.AWS_COGNITO_USER_POOL_ID)?.trim();
  const clientId = (process.env.AWS_COGNITO_APP_CLIENT_ID)?.trim();
  return { userPoolId, clientId };
}

/**
 * Get Cognito ID token verifier (for launchpad API validation).
 * Uses IPv4-only JWKS fetcher to avoid connectivity issues to AWS.
 */
export function getCognitoVerifier() {
  const { userPoolId, clientId } = getCognitoEnv();
  if (!userPoolId || !clientId) return null;
  if (!cognitoIdVerifier) {
    jwksCache = new SimpleJwksCache({ fetcher: new IPv4Fetcher() });
    cognitoIdVerifier = CognitoJwtVerifier.create(
      { userPoolId, tokenUse: "id", clientId },
      { jwksCache }
    );
  }
  return cognitoIdVerifier;
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
 * From verified Cognito id token payload: find or create launchpad DB user, then save/update
 * the user row so our system has the latest data. Other APIs (e.g. /auth/me) will read
 * updated user from the same table.
 * Returns null if domain restricted or no email.
 */
export async function findOrCreateUserFromCognitoPayload(payload, role = "manager") {
  const email = payload.email || payload["cognito:username"];
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
