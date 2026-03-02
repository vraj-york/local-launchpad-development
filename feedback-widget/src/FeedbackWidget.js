import React, { useState, useRef } from "react";
import Modal from "./components/Modal";
import ScreenshotCapture from "./components/ScreenshotCapture";
import AnnotationEditor from "./components/AnnotationEditor";
import { collectMetadata } from "./services/metadata.service";
import { submitFeedback } from "./services/api.service";
import { blobToFile } from "./services/screenshot.service";
import "./styles/widget.css";

const STEPS = {
  CAPTURE: "capture",
  ANNOTATE: "annotate",
  SUBMITTING: "submitting",
  SUCCESS: "success",
};

const FeedbackWidget = ({ config }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(STEPS.CAPTURE);
  const [screenshotCanvas, setScreenshotCanvas] = useState(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState(null);
  const [annotatedBlob, setAnnotatedBlob] = useState(null);
  const [annotatedDataUrl, setAnnotatedDataUrl] = useState(null);
  const [metadata] = useState(collectMetadata());
  const [result, setResult] = useState(null);
  const [submittedDescription, setSubmittedDescription] = useState(null);
  const [error, setError] = useState(null);
  // Ref set synchronously on success so overlay/ESC don't close before state updates
  const successRef = useRef(false);

  const openWidget = () => {
    setIsOpen(true);
    setStep(STEPS.CAPTURE);
    setError(null);
  };

  const closeWidget = () => {
    setIsOpen(false);
    successRef.current = false;
    // Reset state after animation
    setTimeout(() => {
      setStep(STEPS.CAPTURE);
      setScreenshotCanvas(null);
      setScreenshotDataUrl(null);
      setAnnotatedBlob(null);
      setAnnotatedDataUrl(null);
      setResult(null);
      setSubmittedDescription(null);
      setError(null);
    }, 300);
  };

  const handleScreenshotCapture = (canvas, dataUrl) => {
    setScreenshotCanvas(canvas);
    setScreenshotDataUrl(dataUrl);
    setStep(STEPS.ANNOTATE);
  };

  const handleAnnotationSave = (blob, dataUrl, description) => {
    setAnnotatedBlob(blob);
    setAnnotatedDataUrl(dataUrl);
    handleSubmit(description, blob);
  };

  const handleSubmit = async (description, blobToSubmit) => {
    setStep(STEPS.SUBMITTING);
    setError(null);

    try {
      const screenshotFile = blobToFile(blobToSubmit, "screenshot.png");

      const data = {
        description,
        metadata,
        screenshot: screenshotFile,
      };

      const response = await submitFeedback(
        config.apiUrl,
        config.projectId,
        data,
      );

      // Set ref immediately so overlay/ESC cannot close before React re-renders
      successRef.current = true;
      setResult(response);
      setSubmittedDescription(description);
      setStep(STEPS.SUCCESS);

      if (config.onSuccess) {
        config.onSuccess(response);
      }
    } catch (err) {
      setError(err.message);
      setStep(STEPS.ANNOTATE);

      if (config.onError) {
        config.onError(err);
      }
    }
  };

  const handleBack = () => {
    if (step === STEPS.ANNOTATE) {
      setStep(STEPS.CAPTURE);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        className="feedback-widget-button"
        onClick={openWidget}
        title="Report an issue or provide feedback"
        aria-label="Report Issue"
      >
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
        <span className="feedback-widget-button-text">Report Issue</span>
      </button>

      {/* Modal */}
      <Modal
        isOpen={isOpen}
        onClose={closeWidget}
        allowOverlayClose={() => !successRef.current && step !== STEPS.SUCCESS}
      >
        {/* Header */}
        <div className="feedback-widget-header">
          <h2>Send Feedback</h2>
          <button
            className="feedback-widget-close"
            onClick={closeWidget}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="feedback-widget-body">
          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: "12px",
                background: "#fee2e2",
                color: "#991b1b",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "14px",
              }}
            >
              ❌ {error}
            </div>
          )}

          {/* Step Content */}
          {step === STEPS.CAPTURE && (
            <ScreenshotCapture
              onCapture={handleScreenshotCapture}
              onBack={handleBack}
            />
          )}

          {step === STEPS.ANNOTATE && (
            <AnnotationEditor
              screenshot={screenshotDataUrl}
              metadata={metadata}
              onSave={handleAnnotationSave}
              onBack={handleBack}
            />
          )}

          {step === STEPS.SUBMITTING && (
            <div className="feedback-widget-loading">
              <div className="feedback-widget-spinner" />
              <h3
                style={{
                  margin: "0 0 8px",
                  color: "#111827",
                  fontFamily: "system-ui",
                }}
              >
                Submitting Feedback...
              </h3>
              <p
                style={{
                  margin: 0,
                  color: "#6b7280",
                  fontSize: "14px",
                  fontFamily: "system-ui",
                }}
              >
                Please wait while we process your feedback
              </p>
            </div>
          )}

          {step === STEPS.SUCCESS && result && (
            <div className="feedback-widget-success">
              <div className="feedback-widget-success-icon">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
              <h3>Feedback Submitted!</h3>

              <div className="feedback-widget-success-preview">
                {annotatedDataUrl && (
                  <div className="feedback-widget-success-screenshot">
                    <label className="feedback-widget-success-label">
                      screenshot
                    </label>
                    <img
                      src={annotatedDataUrl}
                      alt="Submitted screenshot"
                      className="feedback-widget-success-img"
                    />
                  </div>
                )}
                {submittedDescription && (
                  <div className="feedback-widget-success-description">
                    <label className="feedback-widget-success-label">
                      Description
                    </label>
                    <div className="feedback-widget-success-description-text">
                      {submittedDescription}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer - only show for success (Close button) */}
        {step === STEPS.SUCCESS && (
          <div className="feedback-widget-footer">
            <button
              className="feedback-widget-btn feedback-widget-btn-primary"
              onClick={closeWidget}
              style={{ marginLeft: "auto" }}
            >
              Close
            </button>
          </div>
        )}
      </Modal>
    </>
  );
};

export default FeedbackWidget;
