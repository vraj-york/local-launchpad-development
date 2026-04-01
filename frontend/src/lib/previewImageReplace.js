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
 * Best-effort: img, picture, svg, single-url background, or a single descendant img/picture.
 * @param {Element | null} el
 * @returns {'img' | 'picture' | 'svg' | 'background' | 'nested_img' | 'nested_picture' | null}
 */
export function detectReplacementKind(el) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName?.toUpperCase();
  if (tag === "IMG") return "img";
  if (tag === "PICTURE") return "picture";
  if (tag === "SVG") return "svg";

  const win = el.ownerDocument?.defaultView;
  let bg = "";
  try {
    bg = win?.getComputedStyle(el).getPropertyValue("background-image") || "";
  } catch {
    bg = "";
  }
  if (isSingleUrlBackgroundImage(bg)) return "background";

  const pictures = el.querySelectorAll("picture");
  if (pictures.length === 1 && pictures[0].querySelector("img")) {
    return "nested_picture";
  }

  const imgs = el.querySelectorAll("img");
  if (imgs.length === 1) return "nested_img";

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
 * @param {HTMLImageElement} img
 * @param {string} dataUrl
 */
function applyToImgElement(img, dataUrl) {
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  img.src = dataUrl;
}

/**
 * @param {Element} svgEl
 * @param {string} dataUrl
 */
function replaceSvgWithImg(svgEl, dataUrl) {
  const doc = svgEl.ownerDocument;
  if (!doc || !svgEl.parentNode) return false;
  const img = doc.createElement("img");
  img.src = dataUrl;
  img.alt = svgEl.getAttribute("aria-label") || svgEl.getAttribute("title") || "";
  if (typeof svgEl.className === "string" && svgEl.className.trim()) {
    img.className = svgEl.className;
  }
  const w = svgEl.getAttribute("width");
  const h = svgEl.getAttribute("height");
  if (w && !Number.isNaN(parseInt(w, 10))) img.setAttribute("width", w);
  if (h && !Number.isNaN(parseInt(h, 10))) img.setAttribute("height", h);
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
 * @returns {{ ok: boolean, message?: string }}
 */
export function applyPreviewImageReplacement(iframe, ctx, dataUrl) {
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

  try {
    switch (kind) {
      case "img":
      case "nested_img": {
        const target = kind === "img" ? el : el.querySelector("img");
        if (!target || target.tagName !== "IMG") {
          return { ok: false, message: "No image element found to update." };
        }
        applyToImgElement(target, dataUrl);
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
        applyToImgElement(img, dataUrl);
        break;
      }
      case "svg":
        if (!replaceSvgWithImg(el, dataUrl)) {
          return { ok: false, message: "Could not replace SVG." };
        }
        break;
      case "background":
        el.style.backgroundImage = `url("${escapeDataUrlForCssUrl(dataUrl)}")`;
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
