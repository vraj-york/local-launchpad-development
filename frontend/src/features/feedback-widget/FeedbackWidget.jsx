import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import Lottie from "lottie-react";
import Modal from "./components/Modal";
import AnnotationEditor from "./components/AnnotationEditor";
import { collectMetadata } from "./services/metadata.service";
import {
  isPlausibleClientLinkEmail,
  setClientLinkVerifiedEmail,
} from "@/lib/clientLinkVerifiedEmail";
import { submitFeedback } from "./services/api.service";
import {
  blobToFile,
  captureWithDisplayMedia,
  captureTargetArea,
  canvasToDataURL,
} from "./services/screenshot.service";
import successAnimation from "@/assets/success.json";
import errorAnimation from "@/assets/error.json";
import { cn } from "@/lib/utils";

const lottieRenderer = { preserveAspectRatio: "xMidYMid meet" };

/** True when API returned a non-empty jiraError (feedback saved but Jira step failed). */
function responseIncludesJiraFailure(res) {
  if (!res || typeof res !== "object") return false;
  const e = res.jiraError;
  if (e === undefined || e === null) return false;
  return String(e).trim().length > 0;
}

const STEPS = {
  CAPTURE: "capture",
  ANNOTATE: "annotate",
  SUBMITTING: "submitting",
  SUCCESS: "success",
};

const FeedbackWidget = forwardRef(function FeedbackWidget({ config }, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(STEPS.CAPTURE);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState(null);
  const [screenshotCanvas, setScreenshotCanvas] = useState(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState(null);
  const [annotatedBlob, setAnnotatedBlob] = useState(null);
  const [annotatedDataUrl, setAnnotatedDataUrl] = useState(null);
  const [metadata] = useState(collectMetadata());
  const [result, setResult] = useState(null);
  const [submittedDescription, setSubmittedDescription] = useState(null);
  const [error, setError] = useState(null);
  const successRef = useRef(false);

  const openWidget = useCallback(() => {
    setCaptureError(null);
    setIsCapturing(true);
  }, []);

  useImperativeHandle(ref, () => ({ open: openWidget }), [openWidget]);

  useEffect(() => {
    config.onCapturingChange?.(isCapturing);
  }, [isCapturing, config.onCapturingChange]);

  const closeWidget = () => {
    setIsOpen(false);
    successRef.current = false;
    setTimeout(() => {
      setStep(STEPS.CAPTURE);
      setScreenshotCanvas(null);
      setScreenshotDataUrl(null);
      setAnnotatedBlob(null);
      setAnnotatedDataUrl(null);
      setResult(null);
      setSubmittedDescription(null);
      setError(null);
      setCaptureError(null);
    }, 300);
  };

  const handleBack = () => {
    if (step === STEPS.ANNOTATE) {
      setStep(STEPS.CAPTURE);
      setScreenshotCanvas(null);
      setScreenshotDataUrl(null);
      setIsOpen(false);
    }
  };

  // Run capture when user clicked Report Issue (modal not open yet — so it never appears in the shot)
  React.useEffect(() => {
    if (!isCapturing) return;
    let cancelled = false;

    const runCapture = async () => {
      try {
        const canvas = config.captureTarget
          ? await captureTargetArea(config.captureTarget)
          : await captureWithDisplayMedia();

        if (cancelled) {
          return;
        }

        const dataUrl = canvasToDataURL(canvas);
        if (cancelled) {
          return;
        }

        setScreenshotCanvas(canvas);
        setScreenshotDataUrl(dataUrl);
        setStep(STEPS.ANNOTATE);
        setIsOpen(true);
      } catch (err) {
        if (!cancelled) {
          setCaptureError(err?.message || "Capture failed");
        }
      } finally {
        if (!cancelled) {
          setIsCapturing(false);
        }
      }
    };

    runCapture();
    return () => {
      cancelled = true;
    };
  }, [isCapturing]);

  const handleAnnotationSave = (
    blob,
    dataUrl,
    description,
    issueType = "Bug",
    reporterEmail = "",
  ) => {
    setAnnotatedBlob(blob);
    setAnnotatedDataUrl(dataUrl);
    handleSubmit(description, blob, issueType, reporterEmail);
  };

  const handleSubmit = async (
    description,
    blobToSubmit,
    issueType = "Bug",
    reporterEmail = "",
  ) => {
    setStep(STEPS.SUBMITTING);
    setError(null);

    try {
      const screenshotFile = blobToFile(blobToSubmit, "screenshot.png");

      let clientEmail = String(reporterEmail || "").trim().toLowerCase();
      if (
        !clientEmail &&
        config.projectId &&
        typeof config.getClientEmail === "function"
      ) {
        clientEmail = String(config.getClientEmail() || "")
          .trim()
          .toLowerCase();
      }

      if (config.projectId) {
        if (!clientEmail || !isPlausibleClientLinkEmail(clientEmail)) {
          throw new Error(
            "Enter a valid email in the issue form before submitting.",
          );
        }
      }

      const data = {
        description,
        metadata,
        screenshot: screenshotFile,
        issueType,
        ...(clientEmail ? { clientEmail } : {}),
      };

      const response = await submitFeedback(
        config.apiUrl,
        config.projectId,
        data,
      );

      if (clientEmail && config.projectId) {
        setClientLinkVerifiedEmail(clientEmail);
      }

      // Set ref immediately so overlay/ESC cannot close before React re-renders
      successRef.current = true;
      setResult(response);
      setSubmittedDescription(description);
      setStep(STEPS.SUCCESS);

      const jiraFailed = responseIncludesJiraFailure(response);
      if (jiraFailed) {
        const msg =
          typeof response.jiraError === "string"
            ? response.jiraError.trim()
            : "Jira ticket could not be created";
        if (config.onError) {
          config.onError(new Error(msg));
        }
      } else if (config.onSuccess) {
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

  const anchorToPreview = Boolean(config.anchorToPreview);

  return (
    <div
      className={cn("box-border [&_*]:box-border", anchorToPreview && "relative")}
      data-capturing={isCapturing ? "" : undefined}
    >
      {/* Floating Button - shows spinner while capturing (modal not open yet) */}
      {!config.hideDefaultTrigger ? (
        <button
          type="button"
          data-feedback-widget-button
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border-0 bg-[#dc2626] px-5 py-3 font-sans text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.3)] transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:bg-[#b91c1c] hover:shadow-[0_6px_20px_rgba(220,38,38,0.4)] active:translate-y-0 disabled:cursor-wait disabled:opacity-90 max-md:bottom-4 max-md:right-4 max-md:px-4 max-md:py-2.5 max-md:text-[13px] [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-white max-md:[&_svg]:h-[18px] max-md:[&_svg]:w-[18px]",
            anchorToPreview
              ? "absolute bottom-5 right-5 z-20"
              : "fixed bottom-5 right-5 z-[999999]",
            isCapturing && "hidden",
          )}
          onClick={openWidget}
          disabled={isCapturing}
          title="Report an issue or provide feedback"
          aria-label="Report Issue"
        >
          {isCapturing ? (
            <>
              <div
                className="m-0 h-[18px] w-[18px] shrink-0 animate-[spin_0.8s_linear_infinite] rounded-full border-2 border-gray-100 border-t-[#00b48a]"
                aria-hidden
              />
              <span className="whitespace-nowrap">
                {config.captureTarget
                  ? "Capturing screenshot..."
                  : "Select window..."}
              </span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span className="whitespace-nowrap">Report Issue</span>
            </>
          )}
        </button>
      ) : null}

      {/* Capture error toast */}
      {captureError && !isCapturing && (
        <div
          className={cn(
            "flex max-w-[320px] items-center gap-3 rounded-lg bg-[#fef2f2] px-4 py-3 font-sans text-[13px] text-[#991b1b] shadow-[0_4px_12px_rgba(0,0,0,0.15)] max-md:bottom-16 max-md:right-4",
            anchorToPreview
              ? "absolute bottom-[72px] right-5 z-[21]"
              : "fixed bottom-[72px] right-5 z-[999998]",
          )}
          role="alert"
        >
          <span>{captureError}</span>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent px-1 text-lg leading-none text-[#991b1b] opacity-80 hover:opacity-100"
            onClick={() => setCaptureError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Modal — only open after screenshot is taken, so it never appears in the shot */}
      <Modal
        isOpen={isOpen}
        onClose={closeWidget}
        allowOverlayClose={() => !successRef.current && step !== STEPS.SUCCESS}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-[5px]">
          <h2 className="m-0 font-sans text-lg font-semibold text-gray-900">
            Send Feedback
          </h2>
          <button
            type="button"
            className="cursor-pointer rounded-md border-0 bg-transparent p-2 transition-colors hover:bg-gray-100"
            onClick={closeWidget}
            aria-label="Close"
          >
            <svg
              className="h-5 w-5 fill-gray-500"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Submit / validation error (annotate step) */}
          {error && step === STEPS.ANNOTATE && (
            <div className="mb-4 text-center">
              <div
                className="mx-auto mb-2.5 h-[120px] w-[120px] overflow-hidden"
                aria-hidden
              >
                <Lottie
                  key={error}
                  animationData={errorAnimation}
                  loop={false}
                  className="h-full w-full [&_svg]:!h-full [&_svg]:!w-full [&_svg]:max-h-full"
                  rendererSettings={lottieRenderer}
                />
              </div>
              <div
                className="rounded-lg bg-[#fee2e2] px-[14px] py-3 text-left font-sans text-sm text-[#991b1b]"
                role="alert"
              >
                {error}
              </div>
            </div>
          )}

          {/* Step Content — modal only shows after screenshot is taken */}
          {step === STEPS.ANNOTATE && (
            <AnnotationEditor
              screenshot={screenshotDataUrl}
              metadata={metadata}
              requiresReporterEmail={Boolean(config.projectId)}
              onSave={handleAnnotationSave}
              onBack={handleBack}
            />
          )}

          {step === STEPS.SUBMITTING && (
            <div className="px-5 py-10 text-center">
              <div
                className="mx-auto mb-5 h-12 w-12 shrink-0 animate-[spin_0.8s_linear_infinite] rounded-full border-4 border-gray-100 border-t-[#00b48a]"
                aria-hidden
              />
              <h3 className="m-0 mb-2 font-sans text-lg font-semibold text-gray-900">
                Submitting Feedback...
              </h3>
              <p className="m-0 font-sans text-sm text-gray-500">
                Please wait while we process your feedback
              </p>
            </div>
          )}

          {step === STEPS.SUCCESS && result && (
            <div className="max-w-full px-5 py-6 text-center">
              <div
                className="mx-auto mb-2 h-[168px] w-[168px] overflow-hidden"
                aria-hidden
              >
                <Lottie
                  key={
                    responseIncludesJiraFailure(result)
                      ? "outcome-err"
                      : "outcome-ok"
                  }
                  animationData={
                    responseIncludesJiraFailure(result)
                      ? errorAnimation
                      : successAnimation
                  }
                  loop={false}
                  className="h-full w-full [&_svg]:!h-full [&_svg]:!w-full [&_svg]:max-h-full"
                  rendererSettings={lottieRenderer}
                />
              </div>
              <h3
                className={cn(
                  "m-0 mb-2 font-sans text-[22px] font-semibold text-gray-900",
                  responseIncludesJiraFailure(result) && "text-[#b45309]",
                )}
              >
                {responseIncludesJiraFailure(result)
                  ? "Couldn't create Jira ticket"
                  : "Feedback Submitted!"}
              </h3>
              {responseIncludesJiraFailure(result) ? (
                <p
                  className="mb-2 rounded-lg border border-[#fcd34d] bg-[#fffbeb] px-[14px] py-3 text-left font-sans text-sm !text-[#92400e]"
                  role="alert"
                >
                  {typeof result.jiraError === "string"
                    ? result.jiraError.trim()
                    : "Something went wrong while creating the ticket."}
                </p>
              ) : (
                <p className="m-0 mb-6 font-sans text-sm text-gray-500">
                  Your feedback was received.
                </p>
              )}

              <div className="mt-5 flex flex-col gap-5 border-t border-gray-200 pt-5 text-left">
                {annotatedDataUrl && (
                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 px-4 py-3.5">
                    <label className="mb-2 block font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
                      screenshot
                    </label>
                    <img
                      src={annotatedDataUrl}
                      alt="Submitted screenshot"
                      className="mx-auto block max-h-[280px] max-w-full object-contain"
                    />
                  </div>
                )}
                {submittedDescription && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3.5">
                    <label className="mb-2 block font-sans text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Description
                    </label>
                    <div className="whitespace-pre-wrap break-words font-sans text-sm leading-normal text-gray-700">
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
          <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 max-md:flex-col">
            <button
              type="button"
              className="ml-auto cursor-pointer rounded-lg border-0 bg-[#00b48a] px-6 py-3 font-sans text-sm font-medium text-white transition-all duration-200 hover:bg-[#00b48a] max-md:ml-0 max-md:w-full"
              onClick={closeWidget}
            >
              Close
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
});

export default FeedbackWidget;
