import React, { useState, useRef } from 'react';
import { captureWithDisplayMedia, captureTargetArea, canvasToDataURL } from '../services/screenshot.service';

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
        const captureMethod = captureTarget ? 'captureTargetArea' : 'captureWithDisplayMedia';
        console.log("[feedback-capture] ScreenshotCapture — Step 1/6: starting", {
          captureMethod,
          captureTarget: captureTarget ?? "(none)",
          currentUrl: window.location.href,
          phase: 'selecting',
        });

        console.log("[feedback-capture] ScreenshotCapture — Step 2/6: calling", captureMethod);
        const t0 = performance.now();
        const canvas = captureTarget
          ? await captureTargetArea(captureTarget)
          : await captureWithDisplayMedia();
        const elapsed = Math.round(performance.now() - t0);

        if (cancelled) {
          console.warn("[feedback-capture] ScreenshotCapture — Step 2/6: cancelled after capture returned");
          return;
        }
        console.log("[feedback-capture] ScreenshotCapture — Step 3/6: canvas received", {
          width: canvas?.width,
          height: canvas?.height,
          captureTimeMs: elapsed,
        });

        processingStartRef.current = Date.now();
        setPhase('processing');
        console.log("[feedback-capture] ScreenshotCapture — Step 4/6: phase → processing, showing brief loader");

        const elapsedSinceProcessing = Date.now() - processingStartRef.current;
        const remaining = Math.max(0, MIN_CAPTURE_SCREEN_MS - elapsedSinceProcessing);
        console.log("[feedback-capture] ScreenshotCapture — Step 4/6: waiting", { remainingMs: remaining });
        await new Promise((r) => setTimeout(r, remaining));

        if (cancelled) {
          console.warn("[feedback-capture] ScreenshotCapture — Step 5/6: cancelled after processing delay");
          return;
        }

        console.log("[feedback-capture] ScreenshotCapture — Step 5/6: converting canvas to dataUrl");
        const dataUrl = canvasToDataURL(canvas);
        console.log("[feedback-capture] ScreenshotCapture — Step 5/6: dataUrl ready", {
          dataUrlLength: dataUrl?.length,
        });

        console.log("[feedback-capture] ScreenshotCapture — Step 6/6: calling onCapture callback");
        onCapture(canvas, dataUrl);
      } catch (err) {
        if (!cancelled) {
          console.error("[feedback-capture] ScreenshotCapture — FAILED", {
            error: err?.message,
            name: err?.name,
            stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
          });
          setError(err?.message || 'Capture failed');
          setPhase('selecting');
        }
      }
    };

    runCapture();
    return () => {
      console.log("[feedback-capture] ScreenshotCapture — effect cleanup: cancelled=true");
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
    const useTarget = Boolean(captureTarget);
    return (
      <div className="feedback-widget-capture feedback-widget-capture-loading">
        <div className="feedback-widget-capture-loading-content">
          {useTarget && <div className="feedback-widget-spinner feedback-widget-capture-spinner" />}
          <h3 className="feedback-widget-capture-title">
            {useTarget ? 'Capturing screenshot...' : 'Select window or screen'}
          </h3>
          <p className="feedback-widget-capture-subtitle">
            {useTarget
              ? 'Please wait while we capture your screen'
              : 'A dialog will appear — choose the window or screen you want to capture. Do not select this dialog.'}
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
