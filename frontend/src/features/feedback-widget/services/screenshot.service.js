// Screenshot Service - html2canvas-pro for target/iframe capture; getDisplayMedia for viewport when no target
import html2canvas from 'html2canvas-pro';

const LOG = '[feedback-capture]';
const console = { log: () => {}, warn: () => {}, error: () => {} };

function iframeDiagnostics(iframe) {
  const info = {
    tagName: iframe?.tagName,
    id: iframe?.id || '(none)',
    src: iframe?.src || '(none)',
    clientWidth: iframe?.clientWidth,
    clientHeight: iframe?.clientHeight,
    sandbox: iframe?.sandbox?.toString() || '(none)',
    allow: iframe?.allow || '(none)',
    parentOrigin: window.location.origin,
    iframeSrcOrigin: '(unknown)',
    sameOrigin: false,
  };

  try {
    const url = new URL(iframe?.src, window.location.href);
    info.iframeSrcOrigin = url.origin;
    info.sameOrigin = url.origin === window.location.origin;
  } catch (e) {
    info.iframeSrcOrigin = `(parse error: ${e.message})`;
  }

  return info;
}

/**
 * Capture screen/window/tab using the native getDisplayMedia API.
 * User chooses what to share (screen, window, or browser tab).
 * @returns {Promise<HTMLCanvasElement>}
 */
export const captureWithDisplayMedia = async () => {
  console.log(`${LOG} captureWithDisplayMedia — Step 1/5: checking browser support`);
  console.log(`${LOG} captureWithDisplayMedia — navigator.mediaDevices exists:`, !!navigator.mediaDevices);
  console.log(`${LOG} captureWithDisplayMedia — getDisplayMedia exists:`, !!navigator.mediaDevices?.getDisplayMedia);

  if (!navigator.mediaDevices?.getDisplayMedia) {
    console.error(`${LOG} captureWithDisplayMedia — ABORT: getDisplayMedia not supported`);
    throw new Error(
      'Screen capture is not supported in this browser. Use HTTPS and a modern browser (Chrome, Firefox, Edge, Safari).'
    );
  }

  console.log(`${LOG} captureWithDisplayMedia — Step 2/5: requesting user to pick screen/window/tab`);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    console.log(`${LOG} captureWithDisplayMedia — Step 2/5: stream acquired`, {
      tracks: stream.getTracks().length,
      trackLabels: stream.getTracks().map((t) => t.label),
    });
  } catch (err) {
    console.error(`${LOG} captureWithDisplayMedia — Step 2/5: user denied or error`, err?.name, err?.message);
    throw err;
  }

  try {
    console.log(`${LOG} captureWithDisplayMedia — Step 3/5: creating <video> element from stream`);
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        console.log(`${LOG} captureWithDisplayMedia — Step 3/5: metadata loaded`, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
        });
        video.play().then(resolve).catch(reject);
      };
      video.onerror = (e) => {
        console.error(`${LOG} captureWithDisplayMedia — Step 3/5: video element error`, e);
        reject(new Error('Video failed to load'));
      };
    });

    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;
    console.log(`${LOG} captureWithDisplayMedia — Step 4/5: drawing video frame to canvas`, { width, height });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    const isBlank = !ctx.getImageData(0, 0, 1, 1).data.some((v, i) => i < 3 && v > 0);
    console.log(`${LOG} captureWithDisplayMedia — Step 5/5: done`, { width, height, isBlank });
    if (isBlank) {
      console.warn(`${LOG} captureWithDisplayMedia — WARNING: canvas appears blank (all-black first pixel)`);
    }

    return canvas;
  } finally {
    console.log(`${LOG} captureWithDisplayMedia — cleanup: stopping all stream tracks`);
    stream.getTracks().forEach((t) => t.stop());
  }
};

/**
 * Inline all <img> in the cloned document to data URIs so html2canvas doesn't re-fetch (avoids CORS/404). When imageBaseUrl is set (iframe capture), resolve relative src against it so fetches hit iframe origin. After inlining, show the img and hide Radix-style avatar fallbacks so the screenshot shows the photo, not the fallback text.
 */
async function inlineImages(clonedDoc, imageBaseUrl) {
  const imgs = clonedDoc.querySelectorAll("img");
  await Promise.all(
    Array.from(imgs).map(async (img) => {
      const rawSrc = img.getAttribute("src") || img.src;
      if (!rawSrc || rawSrc.startsWith("data:")) return;
      // When capturing an iframe, clone is in parent context so img.src resolves to parent; resolve relative src with iframe base so fetches hit /iframe-preview/<port>/...
      const urlToFetch =
        imageBaseUrl && !rawSrc.startsWith("http")
          ? new URL(rawSrc, imageBaseUrl).href
          : (img.src || rawSrc);
      try {
        const res = await fetch(urlToFetch, { mode: "cors", credentials: "same-origin" });
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result);
          r.readAsDataURL(blob);
        });
        img.src = dataUrl;
        // Ensure inlined image is visible and paints on top of any fallback (e.g. Radix Avatar shows initial when img fails)
        img.style.setProperty("opacity", "1");
        img.style.setProperty("visibility", "visible");
        img.style.setProperty("display", "block");
        img.style.setProperty("position", "relative");
        img.style.setProperty("z-index", "1");
        const avatarRoot = img.closest("[data-slot='avatar']");
        if (avatarRoot) {
          const fallback = avatarRoot.querySelector("[data-slot='avatar-fallback']");
          if (fallback) fallback.style.setProperty("display", "none");
        }
        // Iframe apps may use different markup; hide sibling that looks like avatar fallback (short text or single name in span/div, inside avatar-like container)
        const parent = img.parentElement;
        if (parent) {
          const parentClass = (parent.className || "") + (parent.getAttribute("class") || "");
          const looksLikeAvatar = /rounded-full|avatar|size-8|size-10|w-8|w-10|h-8|h-10/.test(parentClass);
          for (const s of parent.children) {
            if (s === img) continue;
            const text = (s.textContent || "").trim();
            const oneWord = /^[a-zA-Z]+$/.test(text) && text.length >= 1 && text.length <= 20;
            if ((s.tagName === "SPAN" || s.tagName === "DIV") && (text.length <= 2 || (looksLikeAvatar && oneWord))) {
              s.style.setProperty("display", "none");
              break;
            }
          }
        }
      } catch {
        // leave original src; html2canvas will render a blank box
      }
    }),
  );
}

const getBaseOptions = (useForeignObject = true, imageBaseUrl = undefined) => ({
  allowTaint: true,
  useCORS: true,
  scale: window.devicePixelRatio || 1,
  foreignObjectRendering: useForeignObject,
  logging: false,
  // Return Promise so html2canvas waits for images to be inlined before rendering (fixes profile/avatar images missing in screenshot)
  onclone: (_doc, el) => inlineImages(el.ownerDocument ?? _doc, imageBaseUrl),
});

async function captureWithHtml2Canvas(element, options) {
  const elInfo = {
    tagName: element?.tagName,
    id: element?.id || '(none)',
    className: typeof element?.className === 'string' ? element.className.slice(0, 80) : '(none)',
    offsetWidth: element?.offsetWidth,
    offsetHeight: element?.offsetHeight,
    isConnected: element?.isConnected,
  };
  console.log(`${LOG} html2canvas — Step 1/3: starting capture`, elInfo);

  const imageBaseUrl = options?.imageBaseUrl;
  const mergedOpts = { ...getBaseOptions(true, imageBaseUrl), ...options };
  console.log(`${LOG} html2canvas — Step 1/3: merged options`, {
    width: mergedOpts.width,
    height: mergedOpts.height,
    windowWidth: mergedOpts.windowWidth,
    windowHeight: mergedOpts.windowHeight,
    scale: mergedOpts.scale,
    foreignObjectRendering: mergedOpts.foreignObjectRendering,
    allowTaint: mergedOpts.allowTaint,
    useCORS: mergedOpts.useCORS,
    imageBaseUrl: mergedOpts.imageBaseUrl != null ? '(set)' : '(none)',
  });

  try {
    console.log(`${LOG} html2canvas — Step 2/3: invoking html2canvas-pro (foreignObject=true)`);
    const canvas = await html2canvas(element, mergedOpts);
    console.log(`${LOG} html2canvas — Step 3/3: success`, { canvasWidth: canvas.width, canvasHeight: canvas.height });
    return canvas;
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`${LOG} html2canvas — Step 2/3: FAILED with foreignObject`, { error: msg, stack: err?.stack?.split('\n').slice(0, 3).join(' | ') });

    if (msg.includes('ForeignObject') || msg.includes('foreign') || msg.includes('security')) {
      console.warn(`${LOG} html2canvas — Step 2/3: retrying WITHOUT foreignObjectRendering`);
      try {
        const fallbackOpts = { ...getBaseOptions(false, imageBaseUrl), ...options };
        const canvas = await html2canvas(element, fallbackOpts);
        console.log(`${LOG} html2canvas — Step 3/3: fallback success`, { canvasWidth: canvas.width, canvasHeight: canvas.height });
        return canvas;
      } catch (fallbackErr) {
        console.error(`${LOG} html2canvas — Step 3/3: fallback ALSO failed`, {
          error: fallbackErr?.message,
          stack: fallbackErr?.stack?.split('\n').slice(0, 3).join(' | '),
        });
        throw fallbackErr;
      }
    }
    throw err;
  }
}

async function captureIframeViewport(iframe) {
  console.log(`${LOG} captureIframeViewport — Step 1/6: diagnosing iframe`);
  const diag = iframeDiagnostics(iframe);
  console.log(`${LOG} captureIframeViewport — Step 1/6: iframe diagnostics`, diag);

  if (!diag.sameOrigin) {
    console.warn(`${LOG} captureIframeViewport — WARNING: iframe is CROSS-ORIGIN`);
    console.warn(`${LOG}   parent origin = ${diag.parentOrigin}`);
    console.warn(`${LOG}   iframe origin  = ${diag.iframeSrcOrigin}`);
    console.warn(`${LOG}   Cross-origin iframes block contentDocument access. html2canvas cannot capture them.`);
  }

  console.log(`${LOG} captureIframeViewport — Step 2/6: accessing contentWindow`);
  const iframeWindow = iframe.contentWindow;
  console.log(`${LOG} captureIframeViewport — Step 2/6: contentWindow =`, iframeWindow ? '(exists)' : 'null');

  console.log(`${LOG} captureIframeViewport — Step 3/6: accessing contentDocument`);
  let iframeDoc = null;
  try {
    iframeDoc = iframe.contentDocument;
    console.log(`${LOG} captureIframeViewport — Step 3/6: contentDocument =`, iframeDoc ? '(exists)' : 'null');
  } catch (secErr) {
    console.error(`${LOG} captureIframeViewport — Step 3/6: contentDocument ACCESS BLOCKED by browser`, {
      error: secErr?.name,
      message: secErr?.message,
    });
  }

  console.log(`${LOG} captureIframeViewport — Step 4/6: accessing documentElement`);
  let iframeRoot = null;
  try {
    iframeRoot = iframeDoc?.documentElement;
    console.log(`${LOG} captureIframeViewport — Step 4/6: documentElement =`, iframeRoot ? `<${iframeRoot.tagName}>` : 'null');
  } catch (secErr) {
    console.error(`${LOG} captureIframeViewport — Step 4/6: documentElement ACCESS BLOCKED`, {
      error: secErr?.name,
      message: secErr?.message,
    });
  }

  if (!iframeWindow || !iframeDoc || !iframeRoot) {
    console.error(`${LOG} captureIframeViewport — ABORT: cannot access iframe document`, {
      hasWindow: !!iframeWindow,
      hasDoc: !!iframeDoc,
      hasRoot: !!iframeRoot,
      isSameOrigin: diag.sameOrigin,
      iframeSrc: diag.src,
      parentOrigin: diag.parentOrigin,
      iframeSrcOrigin: diag.iframeSrcOrigin,
      suggestion: diag.sameOrigin
        ? 'Iframe is same-origin but document is not available — check if iframe has loaded.'
        : 'Iframe is cross-origin. Proxy the content through same-origin or use getDisplayMedia fallback.',
    });
    throw new Error(
      `Iframe document not available (cross-origin: ${!diag.sameOrigin}, src: ${diag.src})`
    );
  }

  console.log(`${LOG} captureIframeViewport — Step 5/6: computing viewport and document dimensions`);
  const viewportW = Math.max(1, Math.floor(iframe.clientWidth || iframeWindow.innerWidth));
  const viewportH = Math.max(1, Math.floor(iframe.clientHeight || iframeWindow.innerHeight));
  const scrollX = iframeWindow.scrollX ?? iframeWindow.pageXOffset ?? 0;
  const scrollY = iframeWindow.scrollY ?? iframeWindow.pageYOffset ?? 0;
  // Full document size so we capture everything, then crop to visible viewport
  const docScrollWidth = Math.max(iframeRoot.scrollWidth, iframeWindow.innerWidth, viewportW);
  const docScrollHeight = Math.max(iframeRoot.scrollHeight, iframeWindow.innerHeight, viewportH);
  console.log(`${LOG} captureIframeViewport — Step 5/6: viewport`, { viewportW, viewportH, scrollX, scrollY, docScrollWidth, docScrollHeight });

  console.log(`${LOG} captureIframeViewport — Step 6/6: running html2canvas on full iframe document, then cropping to visible viewport`);
  // Resolve iframe images relative to iframe's origin so inlined fetches hit /iframe-preview/<port>/... not parent origin
  const imageBaseUrl = iframeDoc.baseURI || (iframeWindow.location.origin + (iframeWindow.location.pathname || "/"));
  const scale = window.devicePixelRatio || 1;
  // Capture full document (no scroll offset) so we get the entire page
  const fullCanvas = await captureWithHtml2Canvas(iframeRoot, {
    imageBaseUrl,
    width: docScrollWidth,
    height: docScrollHeight,
    windowWidth: docScrollWidth,
    windowHeight: docScrollHeight,
    scrollX: 0,
    scrollY: 0,
  });
  // Crop to the currently visible viewport: (scrollX, scrollY) with size (viewportW, viewportH)
  const srcX = Math.min(scrollX * scale, Math.max(0, fullCanvas.width - viewportW * scale));
  const srcY = Math.min(scrollY * scale, Math.max(0, fullCanvas.height - viewportH * scale));
  const srcW = Math.min(viewportW * scale, fullCanvas.width - srcX);
  const srcH = Math.min(viewportH * scale, fullCanvas.height - srcY);
  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = viewportW * scale;
  croppedCanvas.height = viewportH * scale;
  const ctx = croppedCanvas.getContext("2d");
  ctx.drawImage(fullCanvas, srcX, srcY, srcW, srcH, 0, 0, croppedCanvas.width, croppedCanvas.height);
  console.log(`${LOG} captureIframeViewport — Step 6/6: done`, { canvasWidth: croppedCanvas.width, canvasHeight: croppedCanvas.height });
  return croppedCanvas;
}

export const captureFullPage = async () => {
  console.log(`${LOG} captureFullPage — Step 1/4: start`);

  const widgetButton = document.querySelector('[data-feedback-widget-button]');
  const widgetOverlay = document.querySelector('[data-feedback-widget-overlay]');
  console.log(`${LOG} captureFullPage — Step 1/4: hiding widget UI`, {
    hasButton: !!widgetButton,
    hasOverlay: !!widgetOverlay,
  });
  if (widgetButton) widgetButton.style.display = 'none';
  if (widgetOverlay) widgetOverlay.style.display = 'none';

  try {
    const docEl = document.documentElement;
    const scrollWidth = docEl.scrollWidth;
    const scrollHeight = docEl.scrollHeight;
    console.log(`${LOG} captureFullPage — Step 2/4: page dimensions`, {
      scrollWidth,
      scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });

    console.log(`${LOG} captureFullPage — Step 3/4: running html2canvas on <body>`);
    const canvas = await captureWithHtml2Canvas(document.body, {
      scrollY: -window.scrollY,
      scrollX: -window.scrollX,
      windowWidth: scrollWidth,
      windowHeight: scrollHeight,
      width: scrollWidth,
      height: scrollHeight,
    });

    console.log(`${LOG} captureFullPage — Step 4/4: done`, { canvasWidth: canvas.width, canvasHeight: canvas.height });
    return canvas;
  } catch (error) {
    console.error(`${LOG} captureFullPage — FAILED`, { error: error?.message, stack: error?.stack?.split('\n').slice(0, 3).join(' | ') });
    throw new Error('Failed to capture screenshot');
  } finally {
    console.log(`${LOG} captureFullPage — cleanup: restoring widget UI`);
    if (widgetButton) widgetButton.style.display = 'flex';
    if (widgetOverlay) widgetOverlay.style.display = 'flex';
  }
};

export const captureViewport = async () => {
  console.log(`${LOG} captureViewport — Step 1/4: start`);

  const widgetButton = document.querySelector('[data-feedback-widget-button]');
  const widgetOverlay = document.querySelector('[data-feedback-widget-overlay]');
  console.log(`${LOG} captureViewport — Step 1/4: hiding widget UI`, {
    hasButton: !!widgetButton,
    hasOverlay: !!widgetOverlay,
  });
  if (widgetButton) widgetButton.style.display = 'none';
  if (widgetOverlay) widgetOverlay.style.display = 'none';

  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    console.log(`${LOG} captureViewport — Step 2/4: viewport dimensions`, {
      width: w,
      height: h,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
    });

    console.log(`${LOG} captureViewport — Step 3/4: running html2canvas on <body>`);
    const canvas = await captureWithHtml2Canvas(document.body, {
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      scrollY: -window.scrollY,
      scrollX: -window.scrollX,
    });

    console.log(`${LOG} captureViewport — Step 4/4: done`, { canvasWidth: canvas.width, canvasHeight: canvas.height });
    return canvas;
  } catch (error) {
    console.error(`${LOG} captureViewport — FAILED`, { error: error?.message, stack: error?.stack?.split('\n').slice(0, 3).join(' | ') });
    throw new Error('Failed to capture screenshot');
  } finally {
    console.log(`${LOG} captureViewport — cleanup: restoring widget UI`);
    if (widgetButton) widgetButton.style.display = 'flex';
    if (widgetOverlay) widgetOverlay.style.display = 'flex';
  }
};

export const captureTargetArea = async (target) => {
  console.log(`${LOG} captureTargetArea — Step 1/7: start`, {
    target,
    targetType: typeof target,
    currentUrl: window.location.href,
    currentOrigin: window.location.origin,
  });

  if (target == null || target === "viewport") {
    console.log(`${LOG} captureTargetArea — Step 1/7: no target or "viewport", delegating to captureViewport`);
    return captureViewport();
  }

  const widgetButton = document.querySelector("[data-feedback-widget-button]");
  const widgetOverlay = document.querySelector("[data-feedback-widget-overlay]");

  try {
    console.log(`${LOG} captureTargetArea — Step 2/7: hiding widget UI`, {
      hasButton: !!widgetButton,
      hasOverlay: !!widgetOverlay,
    });
    if (widgetButton) widgetButton.style.display = "none";
    if (widgetOverlay) widgetOverlay.style.display = "none";

    console.log(`${LOG} captureTargetArea — Step 3/7: resolving target element`);
    const targetElement =
      typeof target === "string"
        ? document.querySelector(target)
        : target instanceof HTMLElement
          ? target
          : null;

    console.log(`${LOG} captureTargetArea — Step 3/7: target resolution`, {
      selector: typeof target === "string" ? target : '(HTMLElement)',
      found: !!targetElement,
      tagName: targetElement?.tagName,
      id: targetElement?.id || '(none)',
      className: typeof targetElement?.className === 'string' ? targetElement.className.slice(0, 80) : '(none)',
      childCount: targetElement?.childElementCount,
      offsetWidth: targetElement?.offsetWidth,
      offsetHeight: targetElement?.offsetHeight,
    });

    if (!targetElement && target != null) {
      console.error(`${LOG} captureTargetArea — ABORT: target element not found in DOM`, {
        selector: target,
        allIds: Array.from(document.querySelectorAll('[id]')).map((el) => el.id).slice(0, 20),
      });
      throw new Error(`Capture target not found: ${target}`);
    }

    // If target is iframe, capture iframe viewport directly.
    let iframe =
      targetElement instanceof HTMLIFrameElement ? targetElement : null;
    if (iframe) {
      console.log(`${LOG} captureTargetArea — Step 4/7: target IS an <iframe>, capturing directly`);
      const diag = iframeDiagnostics(iframe);
      console.log(`${LOG} captureTargetArea — Step 4/7: iframe diagnostics`, diag);
      return await captureIframeViewport(iframe);
    }

    console.log(`${LOG} captureTargetArea — Step 4/7: target is not an iframe, scanning for child iframes`);
    const childIframes = targetElement?.querySelectorAll('iframe') || [];
    console.log(`${LOG} captureTargetArea — Step 4/7: found ${childIframes.length} iframe(s) inside target`);
    childIframes.forEach((f, i) => {
      const diag = iframeDiagnostics(f);
      console.log(`${LOG} captureTargetArea — Step 4/7: child iframe[${i}] diagnostics`, diag);
    });

    const elementToCapture = targetElement || document.body;
    const rect = elementToCapture.getBoundingClientRect();
    console.log(`${LOG} captureTargetArea — Step 5/7: base capture (header + layout)`, {
      elementTag: elementToCapture.tagName,
      elementId: elementToCapture.id || '(none)',
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
    });

    const captureW = Math.max(1, Math.floor(rect.width)) || window.innerWidth;
    const captureH = Math.max(1, Math.floor(rect.height)) || window.innerHeight;
    console.log(`${LOG} captureTargetArea — Step 5/7: html2canvas dimensions`, {
      captureW,
      captureH,
      windowInnerWidth: window.innerWidth,
      windowInnerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });

    const baseCanvas = await captureWithHtml2Canvas(elementToCapture, {
      width: captureW,
      height: captureH,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scrollY: -window.scrollY,
      scrollX: -window.scrollX,
    });

    console.log(`${LOG} captureTargetArea — Step 5/7: base canvas ready`, {
      canvasWidth: baseCanvas.width,
      canvasHeight: baseCanvas.height,
    });

    // If area contains an iframe, composite visible iframe viewport over base canvas.
    iframe = elementToCapture.querySelector("iframe");
    if (iframe) {
      console.log(`${LOG} captureTargetArea — Step 6/7: compositing iframe viewport onto base canvas`);
      const diag = iframeDiagnostics(iframe);
      console.log(`${LOG} captureTargetArea — Step 6/7: iframe diagnostics`, diag);

      try {
        console.log(`${LOG} captureTargetArea — Step 6/7: calling captureIframeViewport`);
        const iframeCanvas = await captureIframeViewport(iframe);
        console.log(`${LOG} captureTargetArea — Step 6/7: iframe canvas ready`, {
          iframeCanvasWidth: iframeCanvas.width,
          iframeCanvasHeight: iframeCanvas.height,
        });

        const ctx = baseCanvas.getContext("2d");
        if (ctx) {
          const targetRect = elementToCapture.getBoundingClientRect();
          const iframeRect = iframe.getBoundingClientRect();
          const dx = iframeRect.left - targetRect.left;
          const dy = iframeRect.top - targetRect.top;
          console.log(`${LOG} captureTargetArea — Step 6/7: drawing iframe canvas at offset`, {
            dx,
            dy,
            iframeRectWidth: iframeRect.width,
            iframeRectHeight: iframeRect.height,
          });
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
          console.log(`${LOG} captureTargetArea — Step 6/7: iframe composited successfully`);
        } else {
          console.error(`${LOG} captureTargetArea — Step 6/7: could not get 2d context from base canvas`);
        }
      } catch (iframeError) {
        console.warn(`${LOG} captureTargetArea — Step 6/7: iframe capture FAILED (using base canvas only)`, {
          error: iframeError?.message,
          isSameOrigin: diag.sameOrigin,
          iframeSrc: diag.src,
        });
        console.warn(`${LOG} captureTargetArea — Step 6/7: suggestion — proxy iframe content or use getDisplayMedia`);
      }
    } else {
      console.log(`${LOG} captureTargetArea — Step 6/7: no iframe in target, skipping composite`);
    }

    console.log(`${LOG} captureTargetArea — Step 7/7: done`, {
      finalWidth: baseCanvas.width,
      finalHeight: baseCanvas.height,
    });
    return baseCanvas;
  } catch (error) {
    console.error(`${LOG} captureTargetArea — FAILED`, {
      error: error?.message,
      stack: error?.stack?.split('\n').slice(0, 5).join(' | '),
    });
    throw new Error("Failed to capture screenshot");
  } finally {
    console.log(`${LOG} captureTargetArea — cleanup: restoring widget UI`);
    if (widgetButton) widgetButton.style.display = "flex";
    if (widgetOverlay) widgetOverlay.style.display = "flex";
  }
};

export const canvasToBlob = (canvas) => {
  console.log(`${LOG} canvasToBlob — converting canvas to blob`, { width: canvas?.width, height: canvas?.height });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        console.log(`${LOG} canvasToBlob — done`, { blobSize: blob.size, blobType: blob.type });
        resolve(blob);
      } else {
        console.error(`${LOG} canvasToBlob — FAILED: toBlob returned null`);
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, 'image/png');
  });
};

export const canvasToDataURL = (canvas) => {
  console.log(`${LOG} canvasToDataURL — converting canvas`, { width: canvas?.width, height: canvas?.height });
  const dataUrl = canvas.toDataURL('image/png');
  console.log(`${LOG} canvasToDataURL — done`, { dataUrlLength: dataUrl?.length, startsWithPng: dataUrl?.startsWith('data:image/png') });
  return dataUrl;
};

export const blobToFile = (blob, filename = 'screenshot.png') => {
  console.log(`${LOG} blobToFile — creating File`, { blobSize: blob?.size, filename });
  const file = new File([blob], filename, { type: 'image/png' });
  console.log(`${LOG} blobToFile — done`, { fileName: file.name, fileSize: file.size });
  return file;
};
