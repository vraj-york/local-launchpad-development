import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

function getKey() {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY is required (32-byte key, base64-encoded)",
    );
  }
  const buf = Buffer.from(raw.trim(), "base64");
  if (buf.length !== 32) {
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)",
    );
  }
  return buf;
}

/**
 * @param {string} plaintext
 * @returns {string} base64(iv + tag + ciphertext)
 */
export function encryptToken(plaintext) {
  if (plaintext == null || plaintext === "") return "";
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} stored base64(iv + tag + ciphertext)
 * @returns {string}
 */
export function decryptToken(stored) {
  if (!stored || typeof stored !== "string" || !stored.trim()) return "";
  const key = getKey();
  const buf = Buffer.from(stored.trim(), "base64");
  if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new Error("Invalid encrypted token payload");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const data = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
