import React, { useCallback, useEffect, useRef, useState } from "react";

const MAX_OUTER_HTML = 800;
const MAX_TEXT = 200;
const MAX_SELECTOR_DEPTH = 10;

/**
 * Returns true if the preview iframe document is readable (same-origin / proxied).
 */
export function canAccessIframeDocument(iframe) {
  if (!iframe) return false;
  try {
    const doc = iframe.contentDocument;
    return !!(doc?.documentElement);
  } catch {
    return false;
  }
}

function truncate(s, max) {
  const t = typeof s === "string" ? s : String(s ?? "");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function escapeId(id) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, "\\$1");
}

export function buildSelector(el) {
  if (!el || el.nodeType !== 1) return "";
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
    return `#${escapeId(el.id)}`;
  }
  const parts = [];
  let node = el;
  let depth = 0;
  while (
    node &&
    node.nodeType === 1 &&
    node !== node.ownerDocument?.documentElement &&
    depth < MAX_SELECTOR_DEPTH
  ) {
    const tag = node.tagName?.toLowerCase() || "unknown";
    if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
      parts.unshift(`#${escapeId(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    let part = tag;
    if (parent) {
      const sameTag = [...parent.children].filter(
        (c) => c.tagName === node.tagName,
      );
      const idx = sameTag.indexOf(node) + 1;
      if (sameTag.length > 1) part += `:nth-of-type(${idx})`;
    }
    parts.unshift(part);
    node = parent;
    depth += 1;
  }
  return parts.join(" > ");
}

const COMPUTED_STYLE_KEYS = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "display",
  "width",
  "height",
  "padding",
  "margin",
  "border-radius",
  "gap",
];

/** Human-readable ancestor chain, e.g. `div#root > div.flex.min-h-svh`. */
export function buildDomPathString(el, maxDepth = 12) {
  const parts = [];
  let n = el;
  let d = 0;
  while (n && n.nodeType === 1 && d < maxDepth) {
    const tag = n.tagName.toLowerCase();
    let seg = tag;
    if (n.id) seg = `${tag}#${n.id}`;
    else if (typeof n.className === "string" && n.className.trim()) {
      const c = n.className
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(".");
      if (c) seg = `${tag}.${c}`;
    }
    parts.unshift(seg);
    if (tag === "html") break;
    n = n.parentElement;
    d += 1;
  }
  return parts.join(" > ");
}

function snapshotComputedStyles(el) {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  let cs;
  try {
    cs = win.getComputedStyle(el);
  } catch {
    return null;
  }
  const out = {};
  for (const k of COMPUTED_STYLE_KEYS) {
    const v = cs.getPropertyValue(k);
    if (v && String(v).trim()) out[k] = String(v).trim();
  }
  return Object.keys(out).length ? out : null;
}

function escapeAttrValue(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Single-line opening tag for inspector / prompts (truncated class list). */
export function buildOpeningTagSnippet(ctx, maxClassLen = 260) {
  if (!ctx?.tag) return "";
  let out = `<${ctx.tag}`;
  if (ctx.id) out += ` id="${escapeAttrValue(ctx.id)}"`;
  if (ctx.className) {
    const c =
      ctx.className.length > maxClassLen
        ? `${ctx.className.slice(0, maxClassLen - 1)}…`
        : ctx.className;
    out += ` class="${escapeAttrValue(c)}"`;
  }
  if (ctx.role) out += ` role="${escapeAttrValue(ctx.role)}"`;
  if (ctx.href) out += ` href="${escapeAttrValue(ctx.href)}"`;
  if (ctx.ariaLabel) out += ` aria-label="${escapeAttrValue(ctx.ariaLabel)}"`;
  if (ctx.dataTestId) out += ` data-testid="${escapeAttrValue(ctx.dataTestId)}"`;
  if (ctx.dataComponent)
    out += ` data-component="${escapeAttrValue(ctx.dataComponent)}"`;
  if (ctx.dataCy) out += ` data-cy="${escapeAttrValue(ctx.dataCy)}"`;
  out += ">";
  return out;
}

/**
 * Keep the element the browser actually hit. Do not walk up to the first ancestor
 * with an id — in React/Vite apps `#root` would steal every selection.
 * Only skip through script/style/noscript if the hit landed there somehow.
 */
function refinePickTarget(el) {
  let cur = el;
  let steps = 0;
  while (cur && cur.nodeType === 1 && steps < 24) {
    const tag = cur.tagName?.toUpperCase();
    if (tag === "HTML" || tag === "BODY") {
      return el;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
      cur = cur.parentElement;
      steps += 1;
      continue;
    }
    return cur;
  }
  return el;
}

export function serializePickedElement(el, win) {
  if (!el || el.nodeType !== 1) return null;
  const doc = el.ownerDocument;
  const w = win || doc?.defaultView;
  let path = "";
  try {
    if (w?.location) {
      path = `${w.location.pathname || ""}${w.location.search || ""}`;
    }
  } catch {
    path = "";
  }

  const tag = el.tagName?.toLowerCase() || "unknown";
  const className =
    typeof el.className === "string"
      ? el.className
      : el.className?.baseVal != null
        ? String(el.className.baseVal)
        : "";

  const componentHint =
    el.getAttribute("data-component") ||
    el.getAttribute("data-testid") ||
    el.getAttribute("data-cy") ||
    "";

  const domPath = buildDomPathString(el);
  const computedStyles = snapshotComputedStyles(el);

  return {
    tag,
    id: el.id || "",
    className: className.trim(),
    role: el.getAttribute("role") || "",
    ariaLabel: el.getAttribute("aria-label") || "",
    href: tag === "a" ? el.getAttribute("href") || "" : "",
    dataComponent: el.getAttribute("data-component") || "",
    dataTestId: el.getAttribute("data-testid") || "",
    dataCy: el.getAttribute("data-cy") || "",
    componentHint,
    path,
    domPath,
    selector: buildSelector(el),
    textPreview: truncate((el.innerText || "").trim().replace(/\s+/g, " "), MAX_TEXT),
    outerHTML: truncate(el.outerHTML || "", MAX_OUTER_HTML),
    computedStyles,
  };
}

export const FOLLOWUP_ELEMENT_USER_SPLIT = "\n\nUser request:\n\n";

export function formatPickedElementForPrompt(ctx) {
  if (!ctx) return "";
  const hint =
    ctx.componentHint ||
    [ctx.dataComponent && `data-component="${ctx.dataComponent}"`, ctx.dataTestId && `data-testid="${ctx.dataTestId}"`]
      .filter(Boolean)
      .join(", ");
  const lines = [
    "[Selected UI element — context for the AI]",
    `- Preview URL path: ${ctx.path || "(unknown)"}`,
    `- CSS selector (best effort): ${ctx.selector || "(none)"}`,
    `- Tag: ${ctx.tag}`,
    ctx.id ? `- id: ${ctx.id}` : null,
    ctx.className ? `- class: ${ctx.className}` : null,
    ctx.role ? `- role: ${ctx.role}` : null,
    ctx.ariaLabel ? `- aria-label: ${ctx.ariaLabel}` : null,
    ctx.href ? `- href: ${ctx.href}` : null,
    hint ? `- Component / test hint: ${hint}` : null,
    ctx.dataComponent ? `- data-component: ${ctx.dataComponent}` : null,
    ctx.dataTestId ? `- data-testid: ${ctx.dataTestId}` : null,
    ctx.dataCy ? `- data-cy: ${ctx.dataCy}` : null,
    ctx.domPath ? `- DOM path: ${ctx.domPath}` : null,
    ctx.textPreview
      ? `- Visible text: ${JSON.stringify(ctx.textPreview)}`
      : null,
    ctx.outerHTML ? `- HTML (truncated): ${ctx.outerHTML}` : null,
    ctx.computedStyles
      ? `- Computed styles (snapshot): ${JSON.stringify(ctx.computedStyles)}`
      : null,
    "",
    "User request:",
  ];
  return lines.filter((x) => x != null).join("\n");
}

/** Full technical context for tooltips (no trailing “User request” line). */
export function formatPickedElementTooltipBody(ctx) {
  if (!ctx) return "";
  return formatPickedElementForPrompt(ctx).replace(/\nUser request:\s*$/, "").trim();
}

/**
 * Rebuild inspector fields from a stored `[Selected UI element…]` block (before user text).
 */
export function parseContextBlockToInspectorCtx(block) {
  if (typeof block !== "string" || !block.trim()) return null;
  const ctx = {
    path: "",
    selector: "",
    tag: "element",
    id: "",
    className: "",
    role: "",
    ariaLabel: "",
    href: "",
    componentHint: "",
    dataComponent: "",
    dataTestId: "",
    dataCy: "",
    textPreview: "",
    outerHTML: "",
    domPath: "",
    computedStyles: null,
  };
  const lines = block.split("\n");
  for (const line of lines) {
    if (!line.startsWith("- ")) continue;
    const rest = line.slice(2);
    const sep = rest.indexOf(": ");
    if (sep === -1) continue;
    const key = rest.slice(0, sep).trim();
    let val = rest.slice(sep + 2).trim();

    if (key.startsWith("Preview URL path")) ctx.path = val;
    else if (key.startsWith("CSS selector")) ctx.selector = val;
    else if (key === "Tag") ctx.tag = val;
    else if (key === "id") ctx.id = val;
    else if (key === "class") ctx.className = val;
    else if (key === "role") ctx.role = val;
    else if (key === "aria-label") ctx.ariaLabel = val;
    else if (key === "href") ctx.href = val;
    else if (key.startsWith("Component / test hint")) ctx.componentHint = val;
    else if (key === "data-component") ctx.dataComponent = val;
    else if (key === "data-testid") ctx.dataTestId = val;
    else if (key === "data-cy") ctx.dataCy = val;
    else if (key.startsWith("DOM path")) ctx.domPath = val;
    else if (key.startsWith("Visible text")) {
      try {
        ctx.textPreview = JSON.parse(val);
      } catch {
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          ctx.textPreview = val.slice(1, -1).replace(/\\"/g, '"');
        } else {
          ctx.textPreview = val;
        }
      }
    } else if (key.startsWith("HTML (truncated)")) ctx.outerHTML = val;
    else if (key.startsWith("Computed styles (snapshot)")) {
      try {
        ctx.computedStyles = JSON.parse(val);
      } catch {
        ctx.computedStyles = null;
      }
    }
  }
  return ctx;
}

/**
 * Split a sent follow-up that included element context from {@link formatPickedElementForPrompt}.
 */
export function splitFollowupWithElementContext(fullText) {
  if (typeof fullText !== "string") return null;
  const prefix = "[Selected UI element — context for the AI]";
  if (!fullText.startsWith(prefix)) return null;
  const i = fullText.indexOf(FOLLOWUP_ELEMENT_USER_SPLIT);
  if (i === -1) return null;
  const contextBlock = fullText.slice(0, i).trim();
  const userText = fullText.slice(i + FOLLOWUP_ELEMENT_USER_SPLIT.length).trim();
  const tagM = contextBlock.match(/- Tag:\s*(\S+)/);
  const tag = tagM ? tagM[1] : "element";
  return { contextBlock, userText, tag };
}

/**
 * Map a rect from the iframe document's viewport into coordinates relative to the
 * overlay's padding box. Subframe getBoundingClientRect() is relative to the iframe
 * viewport, not the embedding window — omitting the iframe offset shifts the box
 * (often upward vs the real element).
 */
function elementRectToOverlayLocal(el, iframe, overlay) {
  if (!el || !iframe || !overlay) return null;
  const er = el.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const originLeft = iframeRect.left + iframe.clientLeft;
  const originTop = iframeRect.top + iframe.clientTop;
  return {
    left: originLeft + er.left - overlayRect.left,
    top: originTop + er.top - overlayRect.top,
    width: er.width,
    height: er.height,
  };
}

/**
 * Pointer position → coordinates for iframe document.elementFromPoint.
 */
function clientPointToIframeViewport(clientX, clientY, iframe) {
  const iframeRect = iframe.getBoundingClientRect();
  return {
    x: clientX - iframeRect.left - iframe.clientLeft,
    y: clientY - iframeRect.top - iframe.clientTop,
  };
}

/**
 * Full-screen overlay over the preview area when active. Requires same-origin iframe.
 */
function measurePinnedBox(iframe, overlay, selector) {
  if (!iframe || !overlay || !selector?.trim()) return null;
  let doc;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  let el;
  try {
    el = doc.querySelector(selector);
  } catch {
    return null;
  }
  if (!el || el.nodeType !== 1) return null;
  return elementRectToOverlayLocal(el, iframe, overlay);
}

export function ClientLinkPreviewPicker({
  iframeRef,
  active,
  pinned,
  onPinnedChange,
}) {
  const overlayRef = useRef(null);
  const [hoverBox, setHoverBox] = useState(null);
  const [hoverTag, setHoverTag] = useState("");
  const [pinnedBox, setPinnedBox] = useState(null);
  const rafRef = useRef(0);

  const updateHoverFromEvent = useCallback(
    (clientX, clientY) => {
      const iframe = iframeRef?.current;
      const overlay = overlayRef.current;
      if (!active || !iframe || !overlay) {
        setHoverBox(null);
        setHoverTag("");
        return;
      }
      if (!canAccessIframeDocument(iframe)) {
        setHoverBox(null);
        setHoverTag("");
        return;
      }

      const { x: ox, y: oy } = clientPointToIframeViewport(
        clientX,
        clientY,
        iframe,
      );
      if (
        ox < 0 ||
        oy < 0 ||
        ox > iframe.clientWidth ||
        oy > iframe.clientHeight
      ) {
        setHoverBox(null);
        setHoverTag("");
        return;
      }

      let doc;
      let win;
      try {
        doc = iframe.contentDocument;
        win = iframe.contentWindow;
      } catch {
        setHoverBox(null);
        setHoverTag("");
        return;
      }
      if (!doc || !win) {
        setHoverBox(null);
        setHoverTag("");
        return;
      }

      let el = doc.elementFromPoint(ox, oy);
      while (el && el.nodeType !== 1) el = el.parentElement;
      if (!el) {
        setHoverBox(null);
        setHoverTag("");
        return;
      }
      el = refinePickTarget(el);
      const topTag = el.tagName?.toUpperCase();
      if (topTag === "HTML" || topTag === "BODY") {
        setHoverBox(null);
        setHoverTag("");
        return;
      }

      const box = elementRectToOverlayLocal(el, iframe, overlay);
      if (!box) {
        setHoverBox(null);
        setHoverTag("");
        return;
      }
      setHoverBox(box);
      setHoverTag(el.tagName?.toLowerCase() || "");
    },
    [active, iframeRef],
  );

  const scheduleHover = useCallback(
    (clientX, clientY) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        updateHoverFromEvent(clientX, clientY);
      });
    },
    [updateHoverFromEvent],
  );

  useEffect(() => {
    if (!active) {
      setHoverBox(null);
      setHoverTag("");
      setPinnedBox(null);
    }
  }, [active]);

  const refreshPinnedBox = useCallback(() => {
    const iframe = iframeRef?.current;
    const overlay = overlayRef.current;
    if (!active || !pinned?.selector || !iframe || !overlay) {
      setPinnedBox(null);
      return;
    }
    const box = measurePinnedBox(iframe, overlay, pinned.selector);
    setPinnedBox(box);
  }, [active, iframeRef, pinned?.selector]);

  useEffect(() => {
    refreshPinnedBox();
  }, [refreshPinnedBox, pinned]);

  useEffect(() => {
    const iframe = iframeRef?.current;
    if (!active || !iframe || !canAccessIframeDocument(iframe)) return;

    let win;
    try {
      win = iframe.contentWindow;
    } catch {
      return;
    }
    if (!win) return;

    const onScroll = () => {
      refreshPinnedBox();
      const last = lastPointerRef.current;
      if (last) scheduleHover(last.x, last.y);
    };

    win.addEventListener("scroll", onScroll, true);
    const onResize = () => {
      refreshPinnedBox();
      const last = lastPointerRef.current;
      if (last) scheduleHover(last.x, last.y);
    };
    win.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      win.removeEventListener("scroll", onScroll, true);
      win.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [active, iframeRef, scheduleHover, refreshPinnedBox]);

  const lastPointerRef = useRef(null);

  const handlePointerMove = (e) => {
    if (!active) return;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    scheduleHover(e.clientX, e.clientY);
  };

  const handlePointerLeave = () => {
    lastPointerRef.current = null;
    setHoverBox(null);
    setHoverTag("");
  };

  const handleClick = (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const iframe = iframeRef?.current;
    if (!iframe || !canAccessIframeDocument(iframe)) return;

    const { x: ox, y: oy } = clientPointToIframeViewport(
      e.clientX,
      e.clientY,
      iframe,
    );
    let doc;
    let win;
    try {
      doc = iframe.contentDocument;
      win = iframe.contentWindow;
    } catch {
      return;
    }
    if (!doc || !win) return;

    let el = doc.elementFromPoint(ox, oy);
    while (el && el.nodeType !== 1) el = el.parentElement;
    if (!el) return;
    el = refinePickTarget(el);
    const top = el.tagName?.toUpperCase();
    if (top === "HTML" || top === "BODY") return;
    const serialized = serializePickedElement(el, win);
    if (serialized) onPinnedChange?.(serialized);
  };

  if (!active) return null;

  return (
    <div
      ref={overlayRef}
      role="presentation"
      className="pointer-events-auto absolute inset-0 z-[1000005] cursor-crosshair"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      {pinnedBox ? (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-emerald-400/90 bg-emerald-400/10 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]"
          style={{
            left: pinnedBox.left,
            top: pinnedBox.top,
            width: Math.max(pinnedBox.width, 4),
            height: Math.max(pinnedBox.height, 4),
          }}
        />
      ) : null}
      {hoverBox && (
        <>
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-violet-500 bg-violet-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]"
            style={{
              left: hoverBox.left,
              top: hoverBox.top,
              width: Math.max(hoverBox.width, 4),
              height: Math.max(hoverBox.height, 4),
            }}
          />
          {hoverTag ? (
            <div
              className="pointer-events-none absolute rounded-md border border-white/20 bg-linear-to-r from-violet-600/95 to-indigo-600/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-lg"
              style={{
                left: hoverBox.left,
                top: Math.max(0, hoverBox.top - 24),
              }}
            >
              {hoverTag}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
