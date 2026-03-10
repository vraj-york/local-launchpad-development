import React, { useState, useRef } from 'react';
import { captureWithDisplayMedia, canvasToDataURL } from '../services/screenshot.service';

// Minimum time to show the "Capturing Screenshot..." screen so it's visible every time
const MIN_CAPTURE_SCREEN_MS = 1200;

const ScreenshotCapture = ({ onCapture, onBack, captureTarget }) => {
  const [capturing, setCapturing] = useState(true);
  const mountedAtRef = useRef(Date.now());

  // Auto-capture on mount; always show loading screen first, then capture
  React.useEffect(() => {
    let cancelled = false;

    const runCapture = async () => {
      setCapturing(true);
      mountedAtRef.current = Date.now();

      try {
        const canvas = await captureWithDisplayMedia();
        if (cancelled) return;

        const elapsed = Date.now() - mountedAtRef.current;
        const remaining = Math.max(0, MIN_CAPTURE_SCREEN_MS - elapsed);
        await new Promise((r) => setTimeout(r, remaining));

        if (cancelled) return;
        const dataUrl = canvasToDataURL(canvas);
        onCapture(canvas, dataUrl);
      } catch (err) {
        if (!cancelled) {
          console.error('Screenshot capture failed:', err);
          setCapturing(false);
        }
      }
    };

    runCapture();
    return () => {
      cancelled = true;
    };
  }, []);

  // Always show the "Capturing Screenshot..." screen (like the reference image) until we transition to annotate
  return (
    <div className="feedback-widget-capture feedback-widget-capture-loading">
      <div className="feedback-widget-capture-loading-content">
        <div className="feedback-widget-spinner feedback-widget-capture-spinner" />
        <h3 className="feedback-widget-capture-title">Capturing Screenshot...</h3>
        <p className="feedback-widget-capture-subtitle">
          Please wait while we capture your screen
        </p>
      </div>
    </div>
  );
};

export default ScreenshotCapture;
