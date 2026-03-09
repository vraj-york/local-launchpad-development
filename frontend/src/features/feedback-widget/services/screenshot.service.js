// Screenshot Service - Capture page screenshots (html2canvas-pro supports oklch/modern CSS colors)
import html2canvas from 'html2canvas-pro';

// Shared options for better fidelity. foreignObjectRendering uses the browser's native
// renderer so colors, gradients, and text match the live page (avoids oklch/gradient quirks).
const getBaseOptions = (useForeignObject = true) => ({
  allowTaint: true,
  useCORS: true,
  scale: window.devicePixelRatio || 1,
  foreignObjectRendering: useForeignObject,
  logging: false,
});

async function captureWithHtml2Canvas(element, options) {
  try {
    return await html2canvas(element, { ...getBaseOptions(true), ...options });
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('ForeignObject') || msg.includes('foreign') || msg.includes('security')) {
      try {
        return await html2canvas(element, { ...getBaseOptions(false), ...options });
      } catch (fallbackErr) {
        console.warn('[feedback-widget] ForeignObject fallback capture failed:', fallbackErr?.message);
        throw fallbackErr;
      }
    }
    throw err;
  }
}

async function captureIframeViewport(iframe) {
  const iframeWindow = iframe.contentWindow;
  const iframeDoc = iframe.contentDocument;
  const iframeRoot = iframeDoc?.documentElement;

  if (!iframeWindow || !iframeDoc || !iframeRoot) {
    throw new Error("Iframe document not available");
  }

  // Capture the current visible viewport of the iframe (respecting scroll).
  // scrollX/scrollY tell html2canvas which scroll position to use when rendering,
  // so the visible part is at the top-left; we then crop at (0,0) with viewport size.
  const viewportW = Math.max(1, Math.floor(iframe.clientWidth || iframeWindow.innerWidth));
  const viewportH = Math.max(1, Math.floor(iframe.clientHeight || iframeWindow.innerHeight));

  return captureWithHtml2Canvas(iframeRoot, {
    width: viewportW,
    height: viewportH,
    windowWidth: iframeWindow.innerWidth,
    windowHeight: iframeWindow.innerHeight,
    x: 0,
    y: 0,
    scrollX: iframeWindow.scrollX ?? iframeWindow.pageXOffset ?? 0,
    scrollY: iframeWindow.scrollY ?? iframeWindow.pageYOffset ?? 0,
  });
}

export const captureFullPage = async () => {
  try {
    const widgetButton = document.querySelector('.feedback-widget-button');
    const widgetOverlay = document.querySelector('.feedback-widget-overlay');
    if (widgetButton) widgetButton.style.display = 'none';
    if (widgetOverlay) widgetOverlay.style.display = 'none';

    const canvas = await captureWithHtml2Canvas(document.body, {
      scrollY: -window.scrollY,
      scrollX: -window.scrollX,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });

    if (widgetButton) widgetButton.style.display = 'flex';
    if (widgetOverlay) widgetOverlay.style.display = 'flex';
    return canvas;
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw new Error('Failed to capture screenshot');
  }
};

export const captureViewport = async () => {
  try {
    const widgetButton = document.querySelector('.feedback-widget-button');
    const widgetOverlay = document.querySelector('.feedback-widget-overlay');
    if (widgetButton) widgetButton.style.display = 'none';
    if (widgetOverlay) widgetOverlay.style.display = 'none';

    const w = window.innerWidth;
    const h = window.innerHeight;
    const canvas = await captureWithHtml2Canvas(document.body, {
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      scrollY: -window.scrollY,
      scrollX: -window.scrollX,
    });

    if (widgetButton) widgetButton.style.display = 'flex';
    if (widgetOverlay) widgetOverlay.style.display = 'flex';
    return canvas;
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw new Error('Failed to capture screenshot');
  }
};

export const captureTargetArea = async (target) => {
  // No target or explicit 'viewport' → capture the whole visible screen
  if (target == null || target === "viewport") {
    return captureViewport();
  }

  const widgetButton = document.querySelector(".feedback-widget-button");
  const widgetOverlay = document.querySelector(".feedback-widget-overlay");
  try {
    if (widgetButton) widgetButton.style.display = "none";
    if (widgetOverlay) widgetOverlay.style.display = "none";

    const targetElement =
      typeof target === "string"
        ? document.querySelector(target)
        : target instanceof HTMLElement
          ? target
          : null;

    // If target is iframe, capture iframe viewport directly.
    let iframe =
      targetElement instanceof HTMLIFrameElement ? targetElement : null;
    if (iframe) {
      return await captureIframeViewport(iframe);
    }

    const elementToCapture = targetElement || document.body;
    const rect = elementToCapture.getBoundingClientRect();

    // Capture the parent area first (header, controls, layout).
    const baseCanvas = await captureWithHtml2Canvas(elementToCapture, {
      width: Math.max(1, Math.floor(rect.width)) || window.innerWidth,
      height: Math.max(1, Math.floor(rect.height)) || window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scrollY: -window.scrollY,
      scrollX: -window.scrollX,
    });

    // If area contains an iframe, composite visible iframe viewport over base canvas.
    iframe = elementToCapture.querySelector("iframe");
    if (iframe) {
      try {
        const iframeCanvas = await captureIframeViewport(iframe);
        const ctx = baseCanvas.getContext("2d");
        if (ctx) {
          const targetRect = elementToCapture.getBoundingClientRect();
          const iframeRect = iframe.getBoundingClientRect();
          const dx = iframeRect.left - targetRect.left;
          const dy = iframeRect.top - targetRect.top;
          ctx.drawImage(
            iframeCanvas,
            0,
            0,
            iframeCanvas.width,
            iframeCanvas.height,
            dx,
            dy,
            iframeRect.width,
            iframeRect.height,
          );
        }
      } catch (iframeError) {
        console.warn(
          "[feedback-widget] Iframe capture failed, using base capture only:",
          iframeError?.message,
        );
      }
    }

    return baseCanvas;
  } catch (error) {
    console.error("Screenshot capture failed:", error);
    throw new Error("Failed to capture screenshot");
  } finally {
    if (widgetButton) widgetButton.style.display = "flex";
    if (widgetOverlay) widgetOverlay.style.display = "flex";
  }
};

export const canvasToBlob = (canvas) => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, 'image/png');
  });
};

export const canvasToDataURL = (canvas) => {
  return canvas.toDataURL('image/png');
};

export const blobToFile = (blob, filename = 'screenshot.png') => {
  return new File([blob], filename, { type: 'image/png' });
};
