import React, { useState } from 'react';

const ScreenshotCapture = ({ onCapture, onBack }) => {
  const [capturing, setCapturing] = useState(false);

  // Auto-capture on mount
  React.useEffect(() => {
    handleCapture();
  }, []);

  const handleCapture = async () => {
    setCapturing(true);

    try {
      // Import dynamically to avoid loading html2canvas until needed
      const { captureViewport, canvasToDataURL } = await import('../services/screenshot.service');
      const canvas = await captureViewport();
      const dataUrl = canvasToDataURL(canvas);
      onCapture(canvas, dataUrl);
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      setCapturing(false);
    }
  };

  return (
    <div className="feedback-widget-capture">
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div className="feedback-widget-spinner" style={{ margin: '0 auto 20px' }} />
        <h3 style={{ marginTop: 0, color: '#111827', fontFamily: 'system-ui' }}>
          Capturing Screenshot...
        </h3>
        <p style={{ color: '#6b7280', fontSize: '14px', fontFamily: 'system-ui' }}>
          Please wait while we capture your screen
        </p>
      </div>
    </div>
  );
};

export default ScreenshotCapture;
