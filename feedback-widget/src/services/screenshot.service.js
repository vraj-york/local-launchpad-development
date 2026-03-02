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
