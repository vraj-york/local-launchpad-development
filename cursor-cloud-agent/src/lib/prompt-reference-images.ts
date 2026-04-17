import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { CloudLaunchPromptImage } from "@/lib/cloud-agents-types";

const REF_ROOT = ".cursor-cloud-api/prompt-ref";

export function stripBase64Payload(data: string): { base64: string; mimeHint?: string } {
  const trimmed = data.trim();
  if (!trimmed.startsWith("data:")) {
    return { base64: trimmed };
  }
  const comma = trimmed.indexOf(",");
  if (comma === -1) {
    throw new Error("Invalid data URL: missing comma");
  }
  const header = trimmed.slice(5, comma);
  const payload = trimmed.slice(comma + 1);
  const mimeMatch = /^([^;]+)/.exec(header);
  const mimeHint = mimeMatch?.[1]?.toLowerCase();
  const isBase64 = /;base64/i.test(header);
  if (!isBase64) {
    throw new Error("prompt.images[].data must be base64 or a data: URL with ;base64,");
  }
  return { base64: payload.replace(/\s/g, ""), mimeHint };
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/x-png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function inferExtension(buffer: Buffer, mimeHint?: string): string {
  if (mimeHint && MIME_TO_EXT[mimeHint]) {
    return MIME_TO_EXT[mimeHint];
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return ".png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return ".jpg";
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return ".gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  return ".png";
}

function decodeImageBuffer(data: string): { buffer: Buffer; mimeHint?: string } {
  const { base64, mimeHint } = stripBase64Payload(data);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw new Error("prompt.images[].data decoded to empty buffer");
  }
  return { buffer, mimeHint };
}

/** For Zod: true if data decodes to non-empty buffer. */
export function isValidPromptImageBase64(data: string): boolean {
  try {
    decodeImageBuffer(data);
    return true;
  } catch {
    return false;
  }
}

export function buildAgentPromptWithImageRefs(userText: string, relPaths: string[]): string {
  const lines = [
    userText.trim(),
    "",
    "NOTE: The following paths are temporary reference images for the AI only. They are not part of the product, are not used elsewhere, and will be removed before version control steps. Use them only as visual context:",
    ...relPaths.map((p) => `- ${p}`),
  ];
  return lines.join("\n");
}

export async function writePromptReferenceImages(
  cwd: string,
  agentId: string,
  images: CloudLaunchPromptImage[] | undefined,
): Promise<{ dir?: string; relPaths: string[] }> {
  if (!images?.length) {
    return { relPaths: [] };
  }

  const absDir = join(cwd, REF_ROOT, agentId);
  const relBase = `${REF_ROOT}/${agentId}`;
  await mkdir(absDir, { recursive: true });

  const relPaths: string[] = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const { buffer, mimeHint } = decodeImageBuffer(images[i].data);
      const ext = inferExtension(buffer, mimeHint);
      const name = `${String(i).padStart(3, "0")}${ext}`;
      await writeFile(join(absDir, name), buffer);
      relPaths.push(`${relBase}/${name}`);
    }
  } catch (err) {
    await rm(absDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return { dir: absDir, relPaths };
}
