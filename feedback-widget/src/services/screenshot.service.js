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
  // Helper to sync scroll position of an iframe onto the copied clone so it captures what is visible
  onclone: (clonedDoc) => {
    const originalIframes = document.querySelectorAll('iframe');
    const clonedIframes = clonedDoc.querySelectorAll('iframe');
    
    // Attempt to sync scroll position for each iframe
    originalIframes.forEach((orig, index) => {
      const clone = clonedIframes[index];
      if (!clone) return;
      try {
        if (orig.contentWindow && clone.contentWindow) {
          const scrollX = orig.contentWindow.scrollX || orig.contentDocument.documentElement.scrollLeft;
          const scrollY = orig.contentWindow.scrollY || orig.contentDocument.documentElement.scrollTop;
          
          if (scrollY > 0 || scrollX > 0) {
            // Transform the iframe content manually to simulate scroll inside html2canvas
            const cloneBody = clone.contentDocument.body;
            if (cloneBody) {
              cloneBody.style.transform = `translate(-${scrollX}px, -${scrollY}px)`;
              cloneBody.style.position = 'relative';
            }
          }
        }
      } catch (e) {
        // May fail due to CORS if iframe is cross-origin
        console.warn('[feedback-widget] Could not sync iframe scroll for capture:', e);
      }
    });
  }
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

export const captureFullPage = async () => {
  try {
    const widgetButton = document.querySelector('.feedback-widget-button');
    const widgetOverlay = document.querySelector('.feedback-widget-overlay');
    if (widgetButton) widgetButton.style.display = 'none';
    if (widgetOverlay) widgetOverlay.style.display = 'none';

    const canvas = await captureWithHtml2Canvas(document.body, {
      x: window.scrollX,
      y: window.scrollY,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
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
      x: window.scrollX,
      y: window.scrollY,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
    });

    if (widgetButton) widgetButton.style.display = 'flex';
    if (widgetOverlay) widgetOverlay.style.display = 'flex';
    return canvas;
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw new Error('Failed to capture screenshot');
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
