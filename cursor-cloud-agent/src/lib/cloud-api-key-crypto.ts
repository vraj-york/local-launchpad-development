import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";

const ENV = "CLOUD_API_KEY_ENCRYPTION_SECRET";

export class CloudApiKeyCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudApiKeyCryptoError";
  }
}

function requireSecret(): string {
  const s = process.env[ENV]?.trim();
  if (!s) {
    throw new CloudApiKeyCryptoError(
      `${ENV} must be set to encrypt or decrypt cloud agent API keys (use a long random string).`,
    );
  }
  return s;
}

function deriveAesKey(): Buffer {
  return createHash("sha256").update(`${requireSecret()}:aes`).digest();
}

function deriveHmacKey(): Buffer {
  return createHash("sha256").update(`${requireSecret()}:fp`).digest();
}

/** AES-256-GCM; returns base64url(iv || tag || ciphertext). */
export function encryptApiKey(plaintext: string): string {
  const key = deriveAesKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptApiKey(stored: string): string {
  const raw = Buffer.from(stored, "base64url");
  if (raw.length < 12 + 16) {
    throw new CloudApiKeyCryptoError("Invalid encrypted API key payload");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const key = deriveAesKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Deterministic per-key value for SQL equality (tenant scope). */
export function fingerprintApiKey(plaintext: string): string {
  return createHmac("sha256", deriveHmacKey()).update(plaintext).digest("hex");
}
