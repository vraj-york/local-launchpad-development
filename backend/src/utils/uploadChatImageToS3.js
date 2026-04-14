import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "./uploadFileToS3.js";

/**
 * @param {unknown} raw
 * @param {number} [maxLen]
 * @returns {string}
 */
export function slugifyS3KeyPart(raw, maxLen = 56) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = s || "x";
  return base.slice(0, Math.max(1, maxLen));
}

/**
 * @param {{ kind: 'reference'|'replacement', projectSlug: string|null, projectName: string|null, releaseName: string|null, versionLabel: string|null, chatId: number, ext: string, partIndex?: number|null }} p
 * @returns {string}
 */
export function buildClientLinkChatImageS3Key(p) {
  const folder =
    p.kind === "replacement"
      ? "ai-chat-replacement-image"
      : "ai-chat-reference-image";
  const proj = slugifyS3KeyPart(p.projectSlug || p.projectName);
  const rel = slugifyS3KeyPart(p.releaseName);
  const ver = slugifyS3KeyPart(p.versionLabel);
  const id = Number(p.chatId);
  const safeId = Number.isInteger(id) && id > 0 ? id : 0;
  const extRaw = String(p.ext || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeExt = extRaw || "png";
  const pi = Number(p.partIndex);
  const part =
    Number.isInteger(pi) && pi >= 0 ? `-p${pi}` : "";
  return `${folder}/${proj}-${rel}-${ver}-${safeId}${part}.${safeExt}`;
}

/**
 * @param {{ key: string, body: Buffer, contentType?: string|null }} params
 * @returns {Promise<{ ok: true, url: string } | { ok: false, reason: string }>}
 */
export async function uploadBufferToS3Inline({ key, body, contentType }) {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  const region = process.env.AWS_REGION?.trim();
  if (!bucket || !region) {
    return { ok: false, reason: "no_bucket" };
  }
  const k = typeof key === "string" ? key.trim() : "";
  if (!k || !Buffer.isBuffer(body) || body.length < 1) {
    return { ok: false, reason: "bad_input" };
  }
  const ct =
    typeof contentType === "string" && contentType.trim()
      ? contentType.trim()
      : "application/octet-stream";
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: k,
        Body: body,
        ContentType: ct,
        ContentDisposition: "inline",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  } catch (e) {
    console.error("[uploadChatImageToS3] PutObject failed", e?.message || e);
    return { ok: false, reason: "put_failed" };
  }
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${encodeURI(k)}`;
  return { ok: true, url };
}
