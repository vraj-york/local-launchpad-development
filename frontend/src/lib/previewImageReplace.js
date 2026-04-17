import { clientLinkAiPreviewSvg } from "@/api";
import html2canvas from "html2canvas-pro";

/** Max file size for in-preview image replace (data URL in memory). */
export const PREVIEW_REPLACE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * @param {string} dataUrl
 * @returns {string}
 */
export function escapeDataUrlForCssUrl(dataUrl) {
  return String(dataUrl).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * @param {string} backgroundImage
 * @returns {boolean}
 */
export function isSingleUrlBackgroundImage(backgroundImage) {
  const s = String(backgroundImage || "").trim();
  if (!s || s === "none") return false;
  if (/linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient/i.test(s)) {
    return false;
  }
  const urlCalls = s.match(/url\(/gi);
  return Array.isArray(urlCalls) && urlCalls.length === 1;
}

/**
 * First `url(...)` inside a computed background-image value (e.g. gradients + url stacked).
 * @param {string} backgroundImageValue
 * @returns {string | null} raw URL text (may be relative)
 */
export function extractFirstBackgroundImageUrl(backgroundImageValue) {
  const s = String(backgroundImageValue || "").trim();
  if (!s || s === "none") return null;
  const re = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+?))\s*\)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (raw) return raw;
  }
  return null;
}

/** Elements we allow a full DOM raster snapshot for (AI SVG + replace-as-background). */
const BLOCK_SNAPSHOT_TAGS = new Set([
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "HEADER",
  "FOOTER",
  "NAV",
  "ASIDE",
  "BUTTON",
  "SPAN",
  "A",
  "P",
  "LI",
  "UL",
  "OL",
  "TD",
  "TH",
  "LABEL",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/**
 * Best-effort: img, picture, svg, CSS background (any url()), single descendant img/picture, or a block-level snapshot.
 * @param {Element | null} el
 * @returns {'img' | 'picture' | 'svg' | 'background' | 'nested_img' | 'nested_picture' | 'block_snapshot' | null}
 */
export function detectReplacementKind(el) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName?.toUpperCase();
  if (tag === "IMG") return "img";
  if (tag === "PICTURE") return "picture";
  if (tag === "SVG") return "svg";

  const pictures = el.querySelectorAll("picture");
  if (pictures.length === 1 && pictures[0].querySelector("img")) {
    return "nested_picture";
  }

  const imgs = el.querySelectorAll("img");
  if (imgs.length === 1) return "nested_img";

  const win = el.ownerDocument?.defaultView;
  let bg = "";
  try {
    bg = win?.getComputedStyle(el).getPropertyValue("background-image") || "";
  } catch {
    bg = "";
  }
  if (extractFirstBackgroundImageUrl(bg)) return "background";

  let rect = null;
  try {
    rect = el.getBoundingClientRect();
  } catch {
    rect = null;
  }
  if (
    rect &&
    rect.width >= 4 &&
    rect.height >= 4 &&
    tag !== "HTML" &&
    tag !== "BODY" &&
    BLOCK_SNAPSHOT_TAGS.has(tag)
  ) {
    return "block_snapshot";
  }

  return null;
}

/**
 * When the user clicks a child of an SVG (path, g, use), treat the root SVG as the pick target.
 * @param {Element | null} el
 * @returns {Element | null}
 */
export function resolveReplacementElement(el) {
  if (!el || el.nodeType !== 1) return el;
  if (detectReplacementKind(el)) return el;
  const svgAncestor =
    typeof el.closest === "function" ? el.closest("svg") : null;
  if (svgAncestor && detectReplacementKind(svgAncestor)) return svgAncestor;
  return el;
}

/**
 * @param {string} dataUrl
 * @returns {{ mimeType: string, base64: string } | null}
 */
export function parseDataUrlParts(dataUrl) {
  const s = String(dataUrl);
  const m = /^data:([^;]+);base64,(.+)$/s.exec(s);
  if (!m) return null;
  return { mimeType: m[1].trim(), base64: m[2].replace(/\s/g, "") };
}

/**
 * @param {string} dataUrl
 * @returns {Promise<{ width: number, height: number }>}
 */
export function getImageDimensionsFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve({ width: 512, height: 512 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      resolve({
        width: Math.max(1, img.naturalWidth || img.width || 512),
        height: Math.max(1, img.naturalHeight || img.height || 512),
      });
    };
    img.onerror = () => resolve({ width: 512, height: 512 });
    img.src = dataUrl;
  });
}

/**
 * @param {number} n
 * @returns {number}
 */
function roundDisplayDim(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x) || x < 1) return 1;
  return Math.min(x, 8192);
}

/**
 * Best-effort size of the picked replacement slot in the preview iframe (CSS / intrinsic pixels).
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @returns {{ width: number, height: number }}
 */
export function getReplacementElementDisplaySize(iframe, ctx) {
  const fallback = { width: 96, height: 96 };
  if (!iframe || !canAccessIframeDoc(iframe) || !ctx?.selector?.trim()) {
    return fallback;
  }
  let doc;
  try {
    doc = iframe.contentDocument;
  } catch {
    return fallback;
  }
  if (!doc) return fallback;
  let el;
  try {
    el = doc.querySelector(ctx.selector);
  } catch {
    return fallback;
  }
  if (!el || el.nodeType !== 1) return fallback;

  const fromRect = (node) => {
    try {
      const r = node.getBoundingClientRect();
      return {
        width: roundDisplayDim(r.width),
        height: roundDisplayDim(r.height),
      };
    } catch {
      return fallback;
    }
  };

  /** @param {HTMLImageElement} img */
  const fromImg = (img) => {
    if (img?.tagName === "IMG") {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (nw > 0 && nh > 0) {
        return { width: roundDisplayDim(nw), height: roundDisplayDim(nh) };
      }
    }
    return fromRect(img);
  };

  const kind = ctx.replacementKind || detectReplacementKind(el);

  switch (kind) {
    case "img":
      return fromImg(/** @type {HTMLImageElement} */ (el));
    case "nested_img": {
      const img = el.querySelector("img");
      if (img) return fromImg(img);
      return fromRect(el);
    }
    case "picture":
    case "nested_picture": {
      const pic =
        kind === "picture"
          ? el
          : el.tagName === "PICTURE"
            ? el
            : el.querySelector("picture");
      const img = pic?.querySelector("img");
      if (img) return fromImg(img);
      return fromRect(el);
    }
    case "svg": {
      const wAttr = el.getAttribute("width");
      const hAttr = el.getAttribute("height");
      const pw = wAttr ? parseFloat(String(wAttr).replace(/px$/i, "").trim()) : NaN;
      const ph = hAttr ? parseFloat(String(hAttr).replace(/px$/i, "").trim()) : NaN;
      if (!Number.isNaN(pw) && pw > 0 && !Number.isNaN(ph) && ph > 0) {
        return { width: roundDisplayDim(pw), height: roundDisplayDim(ph) };
      }
      return fromRect(el);
    }
    case "background":
      return fromRect(el);
    default:
      return fromRect(el);
  }
}

/**
 * @param {HTMLImageElement} img
 * @param {string} dataUrl
 * @param {{ width?: number, height?: number } | undefined} displaySize
 */
function applyToImgElement(img, dataUrl, displaySize) {
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  img.src = dataUrl;
  if (displaySize?.width != null && displaySize?.height != null) {
    img.setAttribute("width", String(roundDisplayDim(displaySize.width)));
    img.setAttribute("height", String(roundDisplayDim(displaySize.height)));
  }
}

/**
 * @param {Element} svgEl
 * @param {string} dataUrl
 * @param {{ width?: number, height?: number } | undefined} displaySize
 */
function replaceSvgWithImg(svgEl, dataUrl, displaySize) {
  const doc = svgEl.ownerDocument;
  if (!doc || !svgEl.parentNode) return false;
  const img = doc.createElement("img");
  img.src = dataUrl;
  img.alt = svgEl.getAttribute("aria-label") || svgEl.getAttribute("title") || "";
  if (typeof svgEl.className === "string" && svgEl.className.trim()) {
    img.className = svgEl.className;
  }
  if (displaySize?.width != null && displaySize?.height != null) {
    img.setAttribute("width", String(roundDisplayDim(displaySize.width)));
    img.setAttribute("height", String(roundDisplayDim(displaySize.height)));
  } else {
    const w = svgEl.getAttribute("width");
    const h = svgEl.getAttribute("height");
    if (w && !Number.isNaN(parseInt(w, 10))) img.setAttribute("width", w);
    if (h && !Number.isNaN(parseInt(h, 10))) img.setAttribute("height", h);
  }
  const style = svgEl.getAttribute("style");
  if (style) img.setAttribute("style", style);
  svgEl.parentNode.replaceChild(img, svgEl);
  return true;
}

/**
 * @param {File} file
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, dataUrl: string } | { ok: false, message: string }>}
 */
export function readImageFileAsDataUrl(file, maxBytes = PREVIEW_REPLACE_IMAGE_MAX_BYTES) {
  if (!file || !(file instanceof Blob)) {
    return Promise.resolve({ ok: false, message: "No file selected." });
  }
  if (!file.type || !file.type.startsWith("image/")) {
    return Promise.resolve({ ok: false, message: "Please choose an image file." });
  }
  if (file.size > maxBytes) {
    return Promise.resolve({
      ok: false,
      message: `Image must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`,
    });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) {
        resolve({ ok: false, message: "Could not read image." });
        return;
      }
      resolve({ ok: true, dataUrl });
    };
    reader.onerror = () => resolve({ ok: false, message: "Could not read file." });
    reader.readAsDataURL(file);
  });
}

/**
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @param {string} dataUrl
 * @param {{ displayWidth?: number, displayHeight?: number }} [opts]
 * @returns {{ ok: boolean, message?: string }}
 */
export function applyPreviewImageReplacement(iframe, ctx, dataUrl, opts) {
  if (!iframe || !canAccessIframeDoc(iframe)) {
    return { ok: false, message: "Preview is not available for editing." };
  }
  if (!ctx?.selector?.trim() || !dataUrl) {
    return { ok: false, message: "Nothing to replace." };
  }
  let doc;
  try {
    doc = iframe.contentDocument;
  } catch {
    return { ok: false, message: "Cannot access preview document." };
  }
  if (!doc) return { ok: false, message: "Cannot access preview document." };

  let el;
  try {
    el = doc.querySelector(ctx.selector);
  } catch {
    return { ok: false, message: "Invalid selector." };
  }
  if (!el || el.nodeType !== 1) {
    return { ok: false, message: "Selected element was not found in the preview." };
  }

  const kind = ctx.replacementKind || detectReplacementKind(el);
  if (!kind) {
    return {
      ok: false,
      message: "This element cannot be replaced as an image here.",
    };
  }

  const displaySize =
    opts?.displayWidth != null && opts?.displayHeight != null
      ? { width: opts.displayWidth, height: opts.displayHeight }
      : undefined;

  try {
    switch (kind) {
      case "img":
      case "nested_img": {
        const target = kind === "img" ? el : el.querySelector("img");
        if (!target || target.tagName !== "IMG") {
          return { ok: false, message: "No image element found to update." };
        }
        applyToImgElement(target, dataUrl, displaySize);
        break;
      }
      case "picture":
      case "nested_picture": {
        const pic =
          kind === "picture"
            ? el
            : el.tagName === "PICTURE"
              ? el
              : el.querySelector("picture");
        const img = pic?.querySelector("img");
        if (!img || img.tagName !== "IMG") {
          return { ok: false, message: "No image inside <picture> found." };
        }
        applyToImgElement(img, dataUrl, displaySize);
        break;
      }
      case "svg":
        if (!replaceSvgWithImg(el, dataUrl, displaySize)) {
          return { ok: false, message: "Could not replace SVG." };
        }
        break;
      case "background":
      case "block_snapshot":
        el.style.backgroundImage = `url("${escapeDataUrlForCssUrl(dataUrl)}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundRepeat = "no-repeat";
        break;
      default:
        return { ok: false, message: "Unsupported replacement type." };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg || "Replacement failed." };
  }

  return { ok: true, message: "Image updated in preview." };
}

function canAccessIframeDoc(iframe) {
  if (!iframe) return false;
  try {
    return !!(iframe.contentDocument?.documentElement);
  } catch {
    return false;
  }
}

/**
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @param {File} file
 * @param {{ onStagedForRepo?: (p: { previewDataUrl: string, mimeType: string, width: number, height: number, selector: string }) => void }} [opts]
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function runPreviewImageReplaceFromFile(iframe, ctx, file, opts = {}) {
  const read = await readImageFileAsDataUrl(file);
  if (!read.ok) return read;
  const applied = applyPreviewImageReplacement(iframe, ctx, read.dataUrl);
  if (!applied.ok) return applied;

  const { onStagedForRepo } = opts;
  if (onStagedForRepo && ctx?.selector?.trim() && read.dataUrl) {
    const parts = parseDataUrlParts(read.dataUrl);
    if (parts?.base64) {
      const { width, height } = await getImageDimensionsFromDataUrl(read.dataUrl);
      onStagedForRepo({
        previewDataUrl: read.dataUrl,
        mimeType: file.type || parts.mimeType || "image/png",
        width,
        height,
        selector: ctx.selector.trim(),
      });
    }
  }

  return applied;
}

/**
 * Resolve the concrete node used for raster capture (legacy / debugging).
 * @param {Document} doc
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @returns {{ el: Element, captureKind: 'svg' | 'img' | 'dom' } | null}
 */
export function getReplacementCaptureTarget(doc, ctx) {
  if (!ctx?.selector?.trim()) return null;
  let el;
  try {
    el = doc.querySelector(ctx.selector);
  } catch {
    return null;
  }
  if (!el || el.nodeType !== 1) return null;

  const kind = ctx.replacementKind || detectReplacementKind(el);
  switch (kind) {
    case "img": {
      if (el.tagName !== "IMG") return null;
      return { el, captureKind: "img" };
    }
    case "nested_img": {
      const img = el.querySelector("img");
      if (!img || img.tagName !== "IMG") return null;
      return { el: img, captureKind: "img" };
    }
    case "picture":
    case "nested_picture": {
      const pic =
        kind === "picture"
          ? el
          : el.tagName === "PICTURE"
            ? el
            : el.querySelector("picture");
      const img = pic?.querySelector("img");
      if (!img || img.tagName !== "IMG") return null;
      return { el: img, captureKind: "img" };
    }
    case "svg": {
      if (el.tagName !== "SVG") return null;
      return { el, captureKind: "svg" };
    }
    case "background":
    case "block_snapshot":
      return { el, captureKind: "dom" };
    default:
      return null;
  }
}

/**
 * @param {string} rawUrl
 * @param {Document} doc
 */
function resolveUrlAgainstDocument(rawUrl, doc) {
  const t = String(rawUrl || "").trim();
  if (!t) return t;
  if (t.startsWith("data:") || t.startsWith("blob:")) return t;
  if (/^https?:\/\//i.test(t) || t.startsWith("//")) {
    if (t.startsWith("//")) {
      try {
        const base = doc.defaultView?.location?.href || doc.baseURI;
        return new URL(t, base).href;
      } catch {
        return t;
      }
    }
    return t;
  }
  try {
    return new URL(t, doc.baseURI || doc.URL || undefined).href;
  } catch {
    return t;
  }
}

/**
 * @param {string} href
 * @param {number} cw
 * @param {number} ch
 */
function loadImageUrlToPngDataUrl(href, cw, ch) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const c = canvas.getContext("2d");
        if (!c) {
          reject(new Error("Canvas unsupported"));
          return;
        }
        c.drawImage(im, 0, 0, cw, ch);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    im.onerror = () => reject(new Error("Image load failed"));
    im.src = href;
  });
}

/**
 * @param {Element} el
 * @param {number} cw
 * @param {number} ch
 */
async function rasterizeElementHtml2Canvas(el, cw, ch) {
  try {
    const canvas = await html2canvas(el, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: 1,
      width: cw,
      height: ch,
      foreignObjectRendering: true,
    });
    return canvas.toDataURL("image/png");
  } catch {
    const canvas = await html2canvas(el, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: 1,
      width: cw,
      height: ch,
      foreignObjectRendering: false,
    });
    return canvas.toDataURL("image/png");
  }
}

/**
 * CSS backgrounds (incl. gradients), arbitrary divs, and composite visuals — url() fast path, then html2canvas-pro.
 * @param {Element} el
 * @param {Document} doc
 * @param {number} cw
 * @param {number} ch
 */
async function captureDomVisualForAi(el, doc, cw, ch) {
  let bg = "";
  try {
    bg =
      doc.defaultView?.getComputedStyle(el).getPropertyValue("background-image") ||
      "";
  } catch {
    bg = "";
  }
  const rawUrl = extractFirstBackgroundImageUrl(bg);
  if (rawUrl) {
    const href = resolveUrlAgainstDocument(rawUrl, doc);
    try {
      return await loadImageUrlToPngDataUrl(href, cw, ch);
    } catch {
      /* fall through — e.g. CORS or gradient stacks */
    }
  }
  return rasterizeElementHtml2Canvas(el, cw, ch);
}

/**
 * Rasterize the selected preview element to PNG for the vision API (SVG, img, CSS backgrounds, divs / layout).
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @returns {Promise<{ ok: true, base64: string, mimeType: string, fileName: string } | { ok: false, message: string }>}
 */
export async function captureReplacementElementAsPngForAi(iframe, ctx) {
  if (!iframe || !canAccessIframeDoc(iframe)) {
    return { ok: false, message: "Preview is not available." };
  }
  let doc;
  try {
    doc = iframe.contentDocument;
  } catch {
    return { ok: false, message: "Cannot access preview document." };
  }
  if (!doc) return { ok: false, message: "Cannot access preview document." };

  let el;
  try {
    el = doc.querySelector(ctx.selector);
  } catch {
    return { ok: false, message: "Invalid selector." };
  }
  if (!el || el.nodeType !== 1) {
    return { ok: false, message: "Selected element was not found in the preview." };
  }

  const kind = ctx.replacementKind || detectReplacementKind(el);
  if (!kind) {
    return {
      ok: false,
      message:
        "Pick a visible element in the preview (image, SVG, or a box with CSS / content).",
    };
  }

  const dims = getReplacementElementDisplaySize(iframe, ctx);
  const cw = Math.max(1, Math.min(2048, dims.width));
  const ch = Math.max(1, Math.min(2048, dims.height));

  try {
    if (kind === "svg") {
      const svgEl = /** @type {SVGSVGElement} */ (el);
      const clone = /** @type {SVGSVGElement} */ (svgEl.cloneNode(true));
      if (!clone.getAttribute("xmlns")) {
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      }
      const str = new XMLSerializer().serializeToString(clone);
      const dataUrl = await new Promise((resolve, reject) => {
        const blob = new Blob([str], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = cw;
            canvas.height = ch;
            const c2 = canvas.getContext("2d");
            if (!c2) {
              URL.revokeObjectURL(url);
              reject(new Error("Canvas unsupported"));
              return;
            }
            c2.drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/png"));
          } catch (e) {
            URL.revokeObjectURL(url);
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not rasterize SVG."));
        };
        img.src = url;
      });
      const parts = parseDataUrlParts(dataUrl);
      if (!parts?.base64) {
        return { ok: false, message: "Could not encode selected SVG." };
      }
      return {
        ok: true,
        base64: parts.base64,
        mimeType: "image/png",
        fileName: "selected-svg.png",
      };
    }

    if (
      kind === "img" ||
      kind === "nested_img" ||
      kind === "picture" ||
      kind === "nested_picture"
    ) {
      let imgEl = /** @type {HTMLImageElement | null} */ (null);
      if (kind === "img") {
        imgEl = el.tagName === "IMG" ? /** @type {HTMLImageElement} */ (el) : null;
      } else if (kind === "nested_img") {
        imgEl = el.querySelector("img");
      } else {
        const pic =
          kind === "picture"
            ? el
            : el.tagName === "PICTURE"
              ? el
              : el.querySelector("picture");
        imgEl = pic?.querySelector("img") ?? null;
      }
      if (!imgEl || imgEl.tagName !== "IMG") {
        return { ok: false, message: "No image element found to capture." };
      }
      if (!imgEl.complete) {
        await new Promise((resolve, reject) => {
          const onLoad = () => {
            cleanup();
            if (imgEl.naturalWidth > 0) resolve(undefined);
            else reject(new Error("Image not loaded"));
          };
          const onErr = () => {
            cleanup();
            reject(new Error("Image not loaded"));
          };
          const cleanup = () => {
            imgEl.removeEventListener("load", onLoad);
            imgEl.removeEventListener("error", onErr);
          };
          imgEl.addEventListener("load", onLoad);
          imgEl.addEventListener("error", onErr);
        });
      } else if (imgEl.naturalWidth === 0) {
        return { ok: false, message: "Image failed to load in the preview." };
      }

      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const c2 = canvas.getContext("2d");
      if (!c2) {
        return { ok: false, message: "Canvas not available." };
      }
      try {
        c2.drawImage(imgEl, 0, 0, cw, ch);
      } catch {
        return {
          ok: false,
          message:
            "Could not read this image (cross-origin or blocked). Try another asset.",
        };
      }
      const outUrl = canvas.toDataURL("image/png");
      const parts = parseDataUrlParts(outUrl);
      if (!parts?.base64) {
        return { ok: false, message: "Could not encode selected image." };
      }
      return {
        ok: true,
        base64: parts.base64,
        mimeType: "image/png",
        fileName: "selected-image.png",
      };
    }

    if (kind === "background" || kind === "block_snapshot") {
      const dataUrl = await captureDomVisualForAi(el, doc, cw, ch);
      const parts = parseDataUrlParts(dataUrl);
      if (!parts?.base64) {
        return { ok: false, message: "Could not capture this region as PNG." };
      }
      return {
        ok: true,
        base64: parts.base64,
        mimeType: "image/png",
        fileName:
          kind === "background" ? "selected-css-region.png" : "selected-region.png",
      };
    }

    return { ok: false, message: "Unsupported element type for AI capture." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg || "Could not capture selection." };
  }
}

/**
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @param {{
 *   animate?: boolean,
 *   customPrompt?: string,
 *   clientLinkAiSvgContext?: {
 *     slug: string,
 *     releaseId: number | string,
 *     clientEmail?: string,
 *     getClientEmail?: () => string | null | undefined,
 *   },
 *   onStagedForRepo?: (p: { previewDataUrl: string, mimeType: string, width: number, height: number, selector: string }) => void,
 * }} [opts]
 * @param {{ base64: string, mimeType: string, fileName: string }} imagePayload
 */
async function runAiPreviewSvgWithImagePayload(iframe, ctx, imagePayload, opts) {
  const dims = getReplacementElementDisplaySize(iframe, ctx);
  const link = opts.clientLinkAiSvgContext;
  const slug = typeof link?.slug === "string" ? link.slug.trim() : "";
  const releaseId = link?.releaseId;
  const emailRaw =
    typeof link?.getClientEmail === "function"
      ? link.getClientEmail()
      : link?.clientEmail;
  const clientEmail =
    typeof emailRaw === "string" ? emailRaw.trim() : "";

  if (!slug || releaseId == null || !clientEmail) {
    return {
      ok: false,
      message:
        "AI SVG needs Client Link context (project, version, and verified email).",
    };
  }

  let dataUrl;
  try {
    const data = await clientLinkAiPreviewSvg(slug, {
      releaseId,
      clientEmail,
      imageBase64: imagePayload.base64,
      mediaType: imagePayload.mimeType,
      fileName: imagePayload.fileName,
      width: dims.width,
      height: dims.height,
      animate: Boolean(opts.animate),
      customPrompt:
        typeof opts.customPrompt === "string" ? opts.customPrompt : undefined,
    });
    if (!data?.ok || typeof data.dataUrl !== "string" || !data.dataUrl) {
      const errMsg =
        (data && typeof data.error === "string" && data.error) ||
        "AI SVG generation failed.";
      return { ok: false, message: errMsg };
    }
    dataUrl = data.dataUrl;
  } catch (err) {
    const ax = err && typeof err === "object" ? err : null;
    const resp = ax?.response?.data;
    const msg =
      (resp && typeof resp.error === "string" && resp.error) ||
      (typeof ax?.message === "string" && ax.message) ||
      "AI SVG request failed.";
    return { ok: false, message: msg };
  }

  const applyOpts = {
    displayWidth: dims.width,
    displayHeight: dims.height,
  };
  const applied = applyPreviewImageReplacement(iframe, ctx, dataUrl, applyOpts);
  if (!applied.ok) return applied;

  if (opts.onStagedForRepo && ctx?.selector?.trim()) {
    opts.onStagedForRepo({
      previewDataUrl: dataUrl,
      mimeType: "image/svg+xml",
      width: dims.width,
      height: dims.height,
      selector: ctx.selector.trim(),
    });
  }

  return applied;
}

/**
 * Generate an AI SVG using the **currently selected** preview element (SVG or image) as the visual reference.
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @param {{
 *   animate?: boolean,
 *   customPrompt?: string,
 *   clientLinkAiSvgContext?: {
 *     slug: string,
 *     releaseId: number | string,
 *     clientEmail?: string,
 *     getClientEmail?: () => string | null | undefined,
 *   },
 *   onStagedForRepo?: (p: { previewDataUrl: string, mimeType: string, width: number, height: number, selector: string }) => void,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function runAiPreviewSvgFromSelection(iframe, ctx, opts = {}) {
  const cap = await captureReplacementElementAsPngForAi(iframe, ctx);
  if (!cap.ok) return cap;
  return runAiPreviewSvgWithImagePayload(
    iframe,
    ctx,
    {
      base64: cap.base64,
      mimeType: cap.mimeType,
      fileName: cap.fileName,
    },
    opts,
  );
}

/**
 * Generate an AI SVG from an uploaded reference file (Anthropic via backend proxy).
 * @param {HTMLIFrameElement | null} iframe
 * @param {{ selector?: string, replacementKind?: string | null }} ctx
 * @param {File} file
 * @param {{
 *   animate?: boolean,
 *   customPrompt?: string,
 *   clientLinkAiSvgContext?: {
 *     slug: string,
 *     releaseId: number | string,
 *     clientEmail?: string,
 *     getClientEmail?: () => string | null | undefined,
 *   },
 *   onStagedForRepo?: (p: { previewDataUrl: string, mimeType: string, width: number, height: number, selector: string }) => void,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function runAiPreviewSvgFromFile(iframe, ctx, file, opts = {}) {
  const read = await readImageFileAsDataUrl(file);
  if (!read.ok) return read;
  const parts = parseDataUrlParts(read.dataUrl);
  if (!parts?.base64) {
    return { ok: false, message: "Could not read reference image." };
  }
  return runAiPreviewSvgWithImagePayload(
    iframe,
    ctx,
    {
      base64: parts.base64,
      mimeType: parts.mimeType,
      fileName: file.name || "reference",
    },
    opts,
  );
}
