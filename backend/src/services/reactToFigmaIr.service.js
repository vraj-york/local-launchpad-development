/**
 * React/JSX → layout IR via Anthropic Messages API.
 * IR is consumed by LaunchPad 2 Figma plugin (build-from-ir).
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export const IR_SCHEMA_PROMPT = `You convert React/JSX (or TSX) layout snippets into a single JSON object for a Figma plugin.
Output ONLY valid JSON. No markdown fences, no commentary.

Root must be exactly one object with "type":"FRAME" (the screen root).

Allowed node shapes:
1) FRAME: {
  "type":"FRAME",
  "name"?: string,
  "width"?: number,
  "height"?: number,
  "layoutMode"?: "NONE" | "HORIZONTAL" | "VERTICAL",
  "primaryAxisAlignItems"?: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN",
  "counterAxisAlignItems"?: "MIN" | "MAX" | "CENTER" | "BASELINE",
  "paddingLeft"?: number, "paddingRight"?: number, "paddingTop"?: number, "paddingBottom"?: number,
  "itemSpacing"?: number,
  "fills"?: [{ "r":0-1,"g":0-1,"b":0-1,"a"?:0-1 }],
  "cornerRadius"?: number,
  "children"?: [ FRAME | RECTANGLE | TEXT ... ]
}
2) RECTANGLE: {
  "type":"RECTANGLE",
  "name"?: string,
  "width"?: number,
  "height"?: number,
  "fills"?: [{ "r","g","b","a"? }],
  "cornerRadius"?: number
}
3) TEXT: {
  "type":"TEXT",
  "name"?: string,
  "characters": string (required),
  "fontSize"?: number,
  "fontFamily"?: string (prefer "Inter"),
  "fontStyle"?: "Regular" | "Medium" | "Semi Bold" | "Bold" | "Italic",
  "fills"?: [{ "r","g","b","a"? }],
  "width"?: number
}

Rules:
- Use layoutMode HORIZONTAL or VERTICAL when the React uses flex row/column; otherwise NONE.
- Map gap to itemSpacing; map padding shorthand to padding* fields when obvious.
- Approximate colors from className (e.g. bg-gray-100) or inline styles as RGB 0-1.
- Ignore hooks, state, and event handlers; preserve visible structure (nested divs → nested FRAMEs).
- Keep total nodes under 80; depth under 12.
- Every TEXT must have non-empty "characters" (use placeholder " " if needed).

Example output:
{"type":"FRAME","name":"Card","width":360,"height":200,"layoutMode":"VERTICAL","paddingTop":16,"paddingBottom":16,"paddingLeft":16,"paddingRight":16,"itemSpacing":12,"fills":[{"r":1,"g":1,"b":1,"a":1}],"cornerRadius":12,"children":[{"type":"TEXT","name":"Title","characters":"Hello","fontSize":18,"fontStyle":"Semi Bold","fills":[{"r":0.1,"g":0.1,"b":0.1}]},{"type":"RECTANGLE","name":"Accent","width":120,"height":4,"fills":[{"r":0.2,"g":0.5,"b":1}],"cornerRadius":2}]}`;

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validateIrRoot(node, stats = { count: 0, depth: 0 }, maxDepth = 12, maxNodes = 120) {
  if (!node || typeof node !== "object") return "IR must be an object";
  if (node.type !== "FRAME") return 'Root must have type "FRAME"';
  if (stats.depth > maxDepth) return "IR too deep";
  if (stats.count > maxNodes) return "Too many nodes";
  stats.count += 1;
  const children = node.children;
  if (children != null) {
    if (!Array.isArray(children)) return "children must be an array";
    for (const ch of children) {
      const err = validateIrNode(ch, stats, maxDepth, maxNodes);
      if (err) return err;
    }
  }
  return null;
}

function validateIrNode(node, stats, maxDepth, maxNodes) {
  if (!node || typeof node !== "object") return "Invalid child node";
  if (stats.count > maxNodes) return "Too many nodes";
  stats.count += 1;
  stats.depth += 1;
  if (stats.depth > maxDepth) {
    stats.depth -= 1;
    return "IR too deep";
  }
  const t = node.type;
  if (t === "FRAME") {
    if (node.children != null && !Array.isArray(node.children)) {
      stats.depth -= 1;
      return "FRAME children must be array";
    }
    for (const ch of node.children || []) {
      const err = validateIrNode(ch, stats, maxDepth, maxNodes);
      if (err) {
        stats.depth -= 1;
        return err;
      }
    }
    stats.depth -= 1;
    return null;
  }
  if (t === "RECTANGLE") {
    stats.depth -= 1;
    return null;
  }
  if (t === "TEXT") {
    if (typeof node.characters !== "string") {
      stats.depth -= 1;
      return "TEXT requires string characters";
    }
    stats.depth -= 1;
    return null;
  }
  stats.depth -= 1;
  return `Unknown node type: ${t}`;
}

export function validateIr(ir) {
  const stats = { count: 0, depth: 0 };
  return validateIrRoot(ir, stats);
}

/**
 * @param {string} source
 * @returns {Promise<{ ir?: object, error?: string }>}
 */
export async function reactSourceToIr(source) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return { error: "Server missing ANTHROPIC_API_KEY" };
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const maxSource = Number(process.env.REACT_TO_FIGMA_MAX_CHARS) || 120_000;
  const src = typeof source === "string" ? source : "";
  if (!src.trim()) {
    return { error: "source is required" };
  }
  if (src.length > maxSource) {
    return { error: `source exceeds ${maxSource} characters` };
  }

  const body = {
    model,
    max_tokens: 8192,
    system: IR_SCHEMA_PROMPT,
    messages: [
      {
        role: "user",
        content: `Convert this React/JSX into one JSON IR object as specified:\n\n${src}`,
      },
    ],
  };

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Anthropic request failed" };
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: `Anthropic HTTP ${res.status}: non-JSON body` };
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || text.slice(0, 200);
    return { error: `Anthropic HTTP ${res.status}: ${msg}` };
  }

  const blocks = data?.content;
  if (!Array.isArray(blocks)) {
    return { error: "Unexpected Anthropic response shape" };
  }
  const textOut = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  const ir = extractJsonObject(textOut);
  if (!ir) {
    return { error: "Could not parse JSON from model output" };
  }
  const verr = validateIr(ir);
  if (verr) {
    return { error: `Invalid IR: ${verr}` };
  }
  return { ir };
}
