// Screenshot Service - html2canvas-pro for target/iframe capture; getDisplayMedia for viewport when no target
import html2canvas from 'html2canvas-pro';

/**
 * Capture screen/window/tab using the native getDisplayMedia API.
 * User chooses what to share (screen, window, or browser tab).
 * @returns {Promise<HTMLCanvasElement>}
 */
export const captureWithDisplayMedia = async () => {
  console.log("[feedback-capture] Step 1: getDisplayMedia — checking support");
  if (!navigator.mediaDevices?.getDisplayMedia) {
    console.error("[feedback-capture] getDisplayMedia not supported");
    throw new Error(
      'Screen capture is not supported in this browser. Use HTTPS and a modern browser (Chrome, Firefox, Edge, Safari).'
    );
  }

  console.log("[feedback-capture] Step 2: getDisplayMedia — requesting stream");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
  });

  try {
    console.log("[feedback-capture] Step 3: getDisplayMedia — creating video from stream");
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = () => reject(new Error('Video failed to load'));
    });

    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;
    console.log("[feedback-capture] Step 4: getDisplayMedia — drawing to canvas", { width, height });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    console.log("[feedback-capture] Step 5: getDisplayMedia — done");
    return canvas;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
};

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
  console.log("[feedback-capture] html2canvas — starting", { tagName: element?.tagName, id: element?.id });
  try {
    const canvas = await html2canvas(element, { ...getBaseOptions(true), ...options });
    console.log("[feedback-capture] html2canvas — done", { width: canvas.width, height: canvas.height });
    return canvas;
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('ForeignObject') || msg.includes('foreign') || msg.includes('security')) {
      console.warn("[feedback-capture] html2canvas — ForeignObject failed, retrying without", msg);
      try {
        const canvas = await html2canvas(element, { ...getBaseOptions(false), ...options });
        console.log("[feedback-capture] html2canvas — fallback done", { width: canvas.width, height: canvas.height });
        return canvas;
      } catch (fallbackErr) {
        console.error("[feedback-capture] html2canvas — fallback failed", fallbackErr?.message);
        throw fallbackErr;
      }
    }
    console.error("[feedback-capture] html2canvas — error", err?.message);
    throw err;
  }
}

async function captureIframeViewport(iframe) {
  console.log("[feedback-capture] iframe — resolving contentWindow/contentDocument");
  const iframeWindow = iframe.contentWindow;
  const iframeDoc = iframe.contentDocument;
  const iframeRoot = iframeDoc?.documentElement;

  if (!iframeWindow || !iframeDoc || !iframeRoot) {
    console.error("[feedback-capture] iframe — document not available (cross-origin?)", {
      hasWindow: !!iframeWindow,
      hasDoc: !!iframeDoc,
      hasRoot: !!iframeRoot,
    });
    throw new Error("Iframe document not available");
  }

  const viewportW = Math.max(1, Math.floor(iframe.clientWidth || iframeWindow.innerWidth));
  const viewportH = Math.max(1, Math.floor(iframe.clientHeight || iframeWindow.innerHeight));
  console.log("[feedback-capture] iframe — capturing viewport", { viewportW, viewportH });

  const canvas = await captureWithHtml2Canvas(iframeRoot, {
    width: viewportW,
    height: viewportH,
    windowWidth: iframeWindow.innerWidth,
    windowHeight: iframeWindow.innerHeight,
    x: 0,
    y: 0,
    scrollX: iframeWindow.scrollX ?? iframeWindow.pageXOffset ?? 0,
    scrollY: iframeWindow.scrollY ?? iframeWindow.pageYOffset ?? 0,
  });
  console.log("[feedback-capture] iframe — capture done", { width: canvas.width, height: canvas.height });
  return canvas;
}

export const captureFullPage = async () => {
  try {
    console.log("[feedback-capture] captureFullPage — start");
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
    console.error("[feedback-capture] captureFullPage — failed", error);
    throw new Error('Failed to capture screenshot');
  }
};

export const captureViewport = async () => {
  try {
    console.log("[feedback-capture] captureViewport — start");
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
    console.log("[feedback-capture] captureViewport — done", { width: canvas.width, height: canvas.height });
    return canvas;
  } catch (error) {
    console.error("[feedback-capture] captureViewport — failed", error);
    throw new Error('Failed to capture screenshot');
  }
};

export const captureTargetArea = async (target) => {
  console.log("[feedback-capture] captureTargetArea — start", { target });

  if (target == null || target === "viewport") {
    console.log("[feedback-capture] captureTargetArea — no target, using captureViewport");
    return captureViewport();
  }

  const widgetButton = document.querySelector(".feedback-widget-button");
  const widgetOverlay = document.querySelector(".feedback-widget-overlay");
  try {
    console.log("[feedback-capture] captureTargetArea — Step 1: hiding widget UI");
    if (widgetButton) widgetButton.style.display = "none";
    if (widgetOverlay) widgetOverlay.style.display = "none";

    const targetElement =
      typeof target === "string"
        ? document.querySelector(target)
        : target instanceof HTMLElement
          ? target
          : null;

    console.log("[feedback-capture] captureTargetArea — Step 2: resolve target element", {
      target,
      found: !!targetElement,
      tagName: targetElement?.tagName,
      id: targetElement?.id,
    });

    if (!targetElement && target != null) {
      console.error("[feedback-capture] captureTargetArea — target not found", target);
      throw new Error(`Capture target not found: ${target}`);
    }

    // If target is iframe, capture iframe viewport directly.
    let iframe =
      targetElement instanceof HTMLIFrameElement ? targetElement : null;
    if (iframe) {
      console.log("[feedback-capture] captureTargetArea — target is iframe, capturing iframe only");
      return await captureIframeViewport(iframe);
    }

    const elementToCapture = targetElement || document.body;
    const rect = elementToCapture.getBoundingClientRect();
    console.log("[feedback-capture] captureTargetArea — Step 3: base capture (header + layout)", {
      width: rect.width,
      height: rect.height,
    });

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
      console.log("[feedback-capture] captureTargetArea — Step 4: compositing iframe viewport");
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
          console.log("[feedback-capture] captureTargetArea — Step 4 done: iframe drawn onto base");
        }
      } catch (iframeError) {
        console.warn(
          "[feedback-capture] captureTargetArea — Step 4 failed (using base only):",
          iframeError?.message,
        );
      }
    } else {
      console.log("[feedback-capture] captureTargetArea — Step 4: no iframe in target, skip");
    }

    console.log("[feedback-capture] captureTargetArea — Step 5: done", {
      width: baseCanvas.width,
      height: baseCanvas.height,
    });
    return baseCanvas;
  } catch (error) {
    console.error("[feedback-capture] captureTargetArea — error", error?.message, error);
    throw new Error("Failed to capture screenshot");
  } finally {
    console.log("[feedback-capture] captureTargetArea — restoring widget UI");
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
