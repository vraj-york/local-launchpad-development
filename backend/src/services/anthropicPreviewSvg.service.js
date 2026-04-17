/**
 * AI SVG preview — Anthropic Messages API (server-side; key from env).
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_SVG_MODEL = "claude-sonnet-4-20250514";

const SUPPORTED_IMAGE_MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Max length for optional user-supplied instructions (sent with icon + animation passes). */
const MAX_CUSTOM_PROMPT_CHARS = 4000;

/**
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function normalizeCustomPrompt(raw) {
  if (raw == null) return undefined;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return undefined;
  return s.length > MAX_CUSTOM_PROMPT_CHARS
    ? s.slice(0, MAX_CUSTOM_PROMPT_CHARS)
    : s;
}

function extractRawSvg(text) {
  const s = String(text || "").trim();
  const lower = s.toLowerCase();
  const start = lower.indexOf("<svg");
  if (start === -1) return null;
  const endClose = lower.lastIndexOf("</svg>");
  if (endClose === -1) return null;
  return s.slice(start, endClose + "</svg>".length);
}

function svgStringToImageDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function dualToneSystemPrompt(w, h) {
  return `You are an expert SVG icon designer. Your ONLY job is to output raw SVG markup — nothing else.

RULES (non-negotiable):
1. Output ONLY the raw <svg>...</svg> element. Zero extra words, zero markdown, zero backticks, zero explanation.
2. Start your response with exactly "<svg" and end with "</svg>". Nothing before or after.
3. Use viewBox="-48 -48 96 96". Do NOT set width or height attributes on the root svg in isolation — rule 11 adds them for embedding.
4. Dual-tone: pick one bold background colour and one lighter foreground colour that complement each other.
5. Background: a rounded rect (rx="16") covering the full viewBox.
6. Icon shape: recognisable, clean, centred in the viewBox.
7. Animation: include at least one SMIL <animate> or <animateTransform> for a looping effect.
8. Use fill/stroke attributes directly on elements — no CSS, no classes.
9. All attributes must use double quotes.
10. SVG must be valid and self-contained.
11. Set attributes width="${w}" and height="${h}" on the root <svg> (integer CSS pixels) to match the target display size in the user message. Keep viewBox="-48 -48 96 96".

If the user uploads an image, derive colour palette and icon concept from it.
AGAIN: output ONLY the SVG. The very first character must be '<' and the very last must be '>'.`;
}

const ANIMATION_SYSTEM_PROMPT = `You are an SVG animation expert. Given an SVG icon and an animation request, you modify it.

RULES:
1. Output ONLY the modified <svg>...</svg>. No extra text, markdown, or explanation.
2. Keep the exact same shapes, colors, and viewBox — only add or improve SMIL animations.
3. Use <animate> and <animateTransform> with repeatCount="indefinite".
4. Animations must be smooth, lightweight, and web-optimized. No CSS or JS.
5. All attributes use double quotes. Return valid self-contained SVG.`;

function assistantTextFromResponse(data) {
  const blocks = data?.content;
  if (!Array.isArray(blocks)) return "";
  const textBlock = blocks.find((b) => b && b.type === "text");
  return typeof textBlock?.text === "string" ? textBlock.text : "";
}

async function fetchAnthropicMessages({
  apiKey,
  model = ANTHROPIC_SVG_MODEL,
  max_tokens = 4096,
  system,
  messages,
}) {
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system,
        messages,
      }),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Anthropic request failed",
    };
  }

  let rawText = "";
  try {
    rawText = await res.text();
  } catch {
    return { ok: false, message: "Could not read API response." };
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      message: res.ok ? "Invalid JSON from API." : `API error (${res.status}).`,
    };
  }

  if (!res.ok) {
    const msg =
      (typeof data?.error?.message === "string" && data.error.message) ||
      (typeof data?.message === "string" && data.message) ||
      `API error (${res.status}).`;
    return { ok: false, message: msg };
  }

  const text = assistantTextFromResponse(data);
  if (!text.trim()) {
    return { ok: false, message: "Empty response from model." };
  }
  return { ok: true, text };
}

/**
 * @param {{
 *   apiKey: string,
 *   mediaType: string,
 *   base64: string,
 *   fileName: string,
 *   width: number,
 *   height: number,
 *   animate: boolean,
 *   customPrompt?: string,
 * }} params
 * @returns {Promise<{ ok: true, dataUrl: string } | { ok: false, message: string }>}
 */
export async function generateAiSvgDataUrl({
  apiKey,
  mediaType,
  base64,
  fileName,
  width,
  height,
  animate,
  customPrompt: customPromptRaw,
}) {
  if (!apiKey?.trim()) {
    return { ok: false, message: "Missing Anthropic API key on server." };
  }
  const mt = String(mediaType || "").split(";")[0].trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MEDIA.has(mt)) {
    return {
      ok: false,
      message: "Use JPEG, PNG, GIF, or WebP as the reference image.",
    };
  }

  const customPrompt = normalizeCustomPrompt(customPromptRaw);

  let userText = `Create a dual-tone animated icon inspired by the uploaded image.

Target display size in the preview (CSS pixels, width × height): ${width} × ${height}.
File name: ${fileName || "(upload)"}

Derive colour palette and icon concept from the uploaded image.`;

  if (customPrompt) {
    userText += `\n\nAdditional instructions from the user:\n${customPrompt}`;
  }

  const userContent = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mt,
        data: base64,
      },
    },
    {
      type: "text",
      text: userText,
    },
  ];

  const first = await fetchAnthropicMessages({
    apiKey: apiKey.trim(),
    system: dualToneSystemPrompt(width, height),
    messages: [{ role: "user", content: userContent }],
  });
  if (!first.ok) return first;

  let svg = extractRawSvg(first.text);
  if (!svg) {
    return {
      ok: false,
      message: "Model did not return valid SVG markup. Try again.",
    };
  }

  if (animate) {
    let animationUser = `${svg}\n\nEnhance/add SMIL animations per the system rules.`;
    if (customPrompt) {
      animationUser += `\n\nAdditional instructions from the user (respect for animation and motion):\n${customPrompt}`;
    }
    const second = await fetchAnthropicMessages({
      apiKey: apiKey.trim(),
      system: ANIMATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: animationUser,
        },
      ],
    });
    if (!second.ok) return second;
    const improved = extractRawSvg(second.text);
    if (!improved) {
      return {
        ok: false,
        message: "Animation pass did not return valid SVG. Try again.",
      };
    }
    svg = improved;
  }

  return { ok: true, dataUrl: svgStringToImageDataUrl(svg) };
}
