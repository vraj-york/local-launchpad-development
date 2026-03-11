import React, { useState, useRef } from 'react';
import { captureWithDisplayMedia, canvasToDataURL } from '../services/screenshot.service';

// Minimum time to show the "Capturing Screenshot..." screen after we have the image (so it's never in the shot)
const MIN_CAPTURE_SCREEN_MS = 800;

const ScreenshotCapture = ({ onCapture, onBack, captureTarget }) => {
  // 'selecting' = waiting for user to pick window/screen (no spinner - avoid capturing our own loader)
  // 'processing' = we have the stream/canvas, show brief loader then go to annotate
  const [phase, setPhase] = useState('selecting');
  const [error, setError] = useState(null);
  const processingStartRef = useRef(null);

  React.useEffect(() => {
    let cancelled = false;

    const runCapture = async () => {
      try {
        // Get stream first while UI shows "Select window/screen" (no spinner).
        // If user selects this tab, the tab does NOT show the spinner yet, so it won't be in the shot.
        const canvas = await captureWithDisplayMedia();
        if (cancelled) return;

        // Screenshot is done. Now show loader briefly so user sees feedback, then hand off.
        processingStartRef.current = Date.now();
        setPhase('processing');

        const elapsed = Date.now() - processingStartRef.current;
        const remaining = Math.max(0, MIN_CAPTURE_SCREEN_MS - elapsed);
        await new Promise((r) => setTimeout(r, remaining));

        if (cancelled) return;
        const dataUrl = canvasToDataURL(canvas);
        onCapture(canvas, dataUrl);
      } catch (err) {
        if (!cancelled) {
          console.error('Screenshot capture failed:', err);
          setError(err?.message || 'Capture failed');
          setPhase('selecting');
        }
      }
    };

    runCapture();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="feedback-widget-capture feedback-widget-capture-loading">
        <div className="feedback-widget-capture-loading-content">
          <p className="feedback-widget-capture-title" style={{ color: '#b91c1c' }}>
            {error}
          </p>
          <p className="feedback-widget-capture-subtitle">
            Make sure you select a window or screen when the dialog appears.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'selecting') {
    return (
      <div className="feedback-widget-capture feedback-widget-capture-loading">
        <div className="feedback-widget-capture-loading-content">
          <h3 className="feedback-widget-capture-title">Select window or screen</h3>
          <p className="feedback-widget-capture-subtitle">
            A dialog will appear — choose the window or screen you want to capture. Do not select this dialog.
          </p>
        </div>
      </div>
    );
  }

  // phase === 'processing': screenshot already taken, show brief "Capturing..." then we transition to annotate
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
