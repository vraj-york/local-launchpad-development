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
  buildCompositeRecordingStream,
  captureDisplayMediaFrameAndKeepStream,
  captureFrameFromMediaStream,
  captureWithDisplayMedia,
  captureTargetArea,
  canvasToDataURL,
} from "./services/screenshot.service";
import {
  startChunkedScreenRecording,
} from "./services/screenRecording.service";
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

function discardActiveScreenRecording(ref, pendingRecordingPayloadRef) {
  if (ref.current) {
    try {
      ref.current.discard();
    } catch {
      /* ignore */
    }
    ref.current = null;
  }
  if (pendingRecordingPayloadRef) {
    pendingRecordingPayloadRef.current = null;
  }
}

const STEPS = {
  CAPTURE: "capture",
  ANNOTATE: "annotate",
  SUBMITTING: "submitting",
  SUCCESS: "success",
};

function formatRecordingDuration(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

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
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [screenRecordingOffered, setScreenRecordingOffered] = useState(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const [headerRecordStarting, setHeaderRecordStarting] = useState(false);
  const successRef = useRef(false);
  const screenRecordingRef = useRef(null);
  /** Set when user stops recording before submit (finalize uploads + /complete). */
  const pendingRecordingPayloadRef = useRef(null);
  const displayStreamRef = useRef(null);
  /** "header" = record started before modal; "form" = record started inside Send Feedback. */
  const recordingEntryRef = useRef("form");
  /** Mic / AudioContext cleanup after composite recording stream. */
  const recordingStreamReleaseRef = useRef(null);

  const runRecordingStreamRelease = useCallback(() => {
    try {
      const fn = recordingStreamReleaseRef.current;
      if (typeof fn === "function") {
        void Promise.resolve(fn()).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    recordingStreamReleaseRef.current = null;
  }, []);

  const openWidget = useCallback(() => {
    setCaptureError(null);
    setIsCapturing(true);
  }, []);

  useEffect(() => {
    config.onCapturingChange?.(isCapturing);
  }, [isCapturing, config.onCapturingChange]);

  const stopIdleDisplayCapture = useCallback(() => {
    discardActiveScreenRecording(
      screenRecordingRef,
      pendingRecordingPayloadRef,
    );
    setIsScreenRecording(false);
    runRecordingStreamRelease();
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    setScreenRecordingOffered(false);
  }, [runRecordingStreamRelease]);

  const handleEnableScreenRecording = useCallback(
    async (email, entry = "form") => {
      recordingEntryRef.current = entry;
      const norm = String(email || "")
        .trim()
        .toLowerCase();
      if (!norm || !isPlausibleClientLinkEmail(norm)) {
        throw new Error("Enter a valid stakeholder email to enable recording.");
      }

      const hadPriorDisplay = Boolean(displayStreamRef.current);
      let compositeCreated = false;

      try {
        const { stream: recStream, release } =
          await buildCompositeRecordingStream(
            hadPriorDisplay ? displayStreamRef.current : null,
          );
        compositeCreated = true;
        displayStreamRef.current = recStream;
        recordingStreamReleaseRef.current = release;

        // Session is created inside recording.start() after the stream exists so
        // cancelling the share dialog does not leave orphan DB rows.
        const controller = startChunkedScreenRecording({
          apiUrl: config.apiUrl,
          projectId: config.projectId,
          clientEmail: norm,
          stream: recStream,
        });
        await controller.start();
        pendingRecordingPayloadRef.current = null;
        screenRecordingRef.current = controller;
        setIsScreenRecording(true);
      } catch (err) {
        runRecordingStreamRelease();
        if (compositeCreated) {
          displayStreamRef.current = null;
        }
        throw err;
      }
    },
    [config.apiUrl, config.projectId, runRecordingStreamRelease],
  );

  const handleDisableScreenRecording = useCallback(async () => {
    const ctrl = screenRecordingRef.current;
    screenRecordingRef.current = null;
    setIsScreenRecording(false);

    if (ctrl) {
      try {
        const { sessionId, chunkCount } = await ctrl.stop();
        if (sessionId && chunkCount > 0) {
          pendingRecordingPayloadRef.current = { sessionId, chunkCount };
        } else {
          pendingRecordingPayloadRef.current = null;
        }
      } catch (recErr) {
        pendingRecordingPayloadRef.current = null;
        throw recErr instanceof Error
          ? recErr
          : new Error(
              String(recErr?.message || "") ||
                "Could not finalize screen recording. Try recording again or submit without video.",
            );
      }
    } else {
      pendingRecordingPayloadRef.current = null;
    }

    runRecordingStreamRelease();
    displayStreamRef.current = null;
  }, [runRecordingStreamRelease]);

  const discardRecordingOnly = useCallback(() => {
    discardActiveScreenRecording(
      screenRecordingRef,
      pendingRecordingPayloadRef,
    );
    setIsScreenRecording(false);
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    runRecordingStreamRelease();
    recordingEntryRef.current = "form";
  }, [runRecordingStreamRelease]);

  const finalizeHeaderRecordingAndOpenModal = useCallback(async () => {
    const stream = displayStreamRef.current;
    const ctrl = screenRecordingRef.current;
    if (!ctrl || !stream) {
      return;
    }
    let canvas;
    try {
      canvas = await captureFrameFromMediaStream(stream);
    } catch {
      canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
    }
    const dataUrl = canvasToDataURL(canvas);
    screenRecordingRef.current = null;
    setIsScreenRecording(false);
    try {
      const { sessionId, chunkCount } = await ctrl.stop();
      if (sessionId && chunkCount > 0) {
        pendingRecordingPayloadRef.current = { sessionId, chunkCount };
      } else {
        pendingRecordingPayloadRef.current = null;
      }
    } catch (recErr) {
      pendingRecordingPayloadRef.current = null;
      setCaptureError(
        recErr instanceof Error
          ? recErr.message
          : "Could not finalize screen recording.",
      );
      displayStreamRef.current = null;
      recordingEntryRef.current = "form";
      runRecordingStreamRelease();
      return;
    }
    displayStreamRef.current = null;
    recordingEntryRef.current = "form";
    runRecordingStreamRelease();
    setScreenshotCanvas(canvas);
    setScreenshotDataUrl(dataUrl);
    setScreenRecordingOffered(true);
    setStep(STEPS.ANNOTATE);
    setIsOpen(true);
  }, [runRecordingStreamRelease]);

  const startRecordFromHeader = useCallback(async () => {
    const projectRecordingAllowed = Boolean(
      config.projectId && config.screenRecording !== false,
    );
    if (!projectRecordingAllowed) {
      return;
    }
    let email = "";
    if (typeof config.getClientEmail === "function") {
      email = String(config.getClientEmail() || "")
        .trim()
        .toLowerCase();
    }
    if (!email || !isPlausibleClientLinkEmail(email)) {
      setCaptureError(
        "Verify your stakeholder email (e.g. in the chat sidebar) before recording, then try again.",
      );
      return;
    }
    setCaptureError(null);
    setHeaderRecordStarting(true);
    try {
      await handleEnableScreenRecording(email, "header");
    } catch (err) {
      recordingEntryRef.current = "form";
      setCaptureError(
        err?.message || "Could not start screen recording. Try again.",
      );
    } finally {
      setHeaderRecordStarting(false);
    }
  }, [
    config.projectId,
    config.screenRecording,
    config.getClientEmail,
    handleEnableScreenRecording,
  ]);

  useImperativeHandle(
    ref,
    () => ({ open: openWidget, openRecordFirst: startRecordFromHeader }),
    [openWidget, startRecordFromHeader],
  );

  useEffect(() => {
    config.onScreenRecordingChange?.(isScreenRecording);
  }, [isScreenRecording, config.onScreenRecordingChange]);

  useEffect(() => {
    if (!isScreenRecording) {
      setRecordingElapsedSec(0);
      return;
    }
    setRecordingElapsedSec(0);
    const id = setInterval(
      () => setRecordingElapsedSec((sec) => sec + 1),
      1000,
    );
    return () => clearInterval(id);
  }, [isScreenRecording]);

  const closeWidget = () => {
    stopIdleDisplayCapture();
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
      stopIdleDisplayCapture();
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
        const projectRecordingAllowed = Boolean(
          config.projectId && config.screenRecording !== false,
        );
        let canvas;
        if (config.captureTarget) {
          displayStreamRef.current = null;
          canvas = await captureTargetArea(config.captureTarget);
        } else if (projectRecordingAllowed) {
          const { canvas: c, stream } =
            await captureDisplayMediaFrameAndKeepStream();
          canvas = c;
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          displayStreamRef.current = stream;
        } else {
          displayStreamRef.current = null;
          canvas = await captureWithDisplayMedia();
        }

        if (cancelled) {
          return;
        }

        if (projectRecordingAllowed) {
          setScreenRecordingOffered(true);
        } else {
          setScreenRecordingOffered(false);
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

      let recordingPayload = {};
      if (screenRecordingRef.current) {
        try {
          const { sessionId, chunkCount } =
            await screenRecordingRef.current.stop();
          screenRecordingRef.current = null;
          setIsScreenRecording(false);
          runRecordingStreamRelease();
          displayStreamRef.current = null;
          if (sessionId && chunkCount > 0) {
            recordingPayload = {
              recordingSessionId: sessionId,
              recordingChunkCount: chunkCount,
            };
          } else if (sessionId && chunkCount === 0 && import.meta.env.DEV) {
            console.warn(
              "[feedback-widget] Recording produced no chunks (nothing reached S3). Check S3 bucket CORS for PUT from this origin and Network tab for failed presigned uploads.",
            );
          }
        } catch (recErr) {
          screenRecordingRef.current = null;
          setIsScreenRecording(false);
          runRecordingStreamRelease();
          throw new Error(
            recErr?.message || "Could not finalize screen recording.",
          );
        }
      } else if (pendingRecordingPayloadRef.current) {
        const p = pendingRecordingPayloadRef.current;
        if (p.sessionId && p.chunkCount > 0) {
          recordingPayload = {
            recordingSessionId: p.sessionId,
            recordingChunkCount: p.chunkCount,
          };
        }
      } else if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach((t) => t.stop());
        displayStreamRef.current = null;
      }

      const data = {
        description,
        metadata,
        screenshot: screenshotFile,
        issueType,
        ...(clientEmail ? { clientEmail } : {}),
        ...recordingPayload,
      };

      const response = await submitFeedback(
        config.apiUrl,
        config.projectId,
        data,
      );

      pendingRecordingPayloadRef.current = null;

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
  const projectRecordingAllowed = Boolean(
    config.projectId && config.screenRecording !== false,
  );

  return (
    <div
      className={cn("box-border [&_*]:box-border", anchorToPreview && "relative")}
      data-capturing={isCapturing ? "" : undefined}
    >
      {/* Record-first: timer + stop (opens Send Feedback) / cancel while modal is closed */}
      {isScreenRecording && !isOpen ? (
        <div
          className="fixed left-0 right-0 top-0 z-[2147483000] flex flex-wrap items-center justify-center gap-3 border-b border-slate-200 bg-slate-900 px-4 py-3 font-sans text-sm text-white shadow-[0_4px_24px_rgba(0,0,0,0.35)]"
          role="region"
          aria-label="Screen recording in progress"
        >
          <div className="flex items-center gap-2 font-mono text-base tabular-nums">
            <span
              className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"
              aria-hidden
            />
            <span aria-live="polite">
              {formatRecordingDuration(recordingElapsedSec)}
            </span>
          </div>
          <p className="w-full max-w-xl text-center text-xs text-slate-300">
            Mic + optional tab audio are included when you allow them in the
            browser prompts. After stop, mark up the screenshot and submit.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="rounded-lg border-0 bg-[#00b48a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#009a78]"
              onClick={() => finalizeHeaderRecordingAndOpenModal()}
            >
              Stop &amp; report issue
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/30 bg-transparent px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
              onClick={discardRecordingOnly}
            >
              Cancel recording
            </button>
          </div>
        </div>
      ) : null}

      {/* Floating actions — Report Issue + optional Record (record first, then modal with video) */}
      {!config.hideDefaultTrigger ? (
        <div
          className={cn(
            "flex flex-col gap-2",
            anchorToPreview
              ? "absolute bottom-5 right-5 z-20"
              : "fixed bottom-5 right-5 z-[999999]",
          )}
        >
          {isCapturing ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 font-sans text-sm font-medium text-slate-700 shadow-md">
              <div
                className="h-[18px] w-[18px] shrink-0 animate-[spin_0.8s_linear_infinite] rounded-full border-2 border-gray-100 border-t-[#00b48a]"
                aria-hidden
              />
              <span className="whitespace-nowrap">
                {config.captureTarget
                  ? "Capturing screenshot..."
                  : "Select window..."}
              </span>
            </div>
          ) : (
            <>
              <button
                type="button"
                data-feedback-widget-button
                className="inline-flex items-center justify-center gap-2 rounded-lg border-0 bg-[#dc2626] px-5 py-3 font-sans text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.3)] transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:bg-[#b91c1c] hover:shadow-[0_6px_20px_rgba(220,38,38,0.4)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 max-md:px-4 max-md:py-2.5 max-md:text-[13px] [&_svg]:h-5 [&_svg]:w-5 [&_svg]:fill-white max-md:[&_svg]:h-[18px] max-md:[&_svg]:w-[18px]"
                onClick={openWidget}
                disabled={isScreenRecording}
                title="Report an issue or provide feedback"
                aria-label="Report Issue"
              >
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
                <span className="whitespace-nowrap">Report Issue</span>
              </button>
              {projectRecordingAllowed ? (
                <button
                  type="button"
                  data-feedback-widget-record-button
                  className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-5 py-3 font-sans text-sm font-semibold text-slate-800 shadow-md transition-all hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 max-md:px-4 max-md:py-2.5 max-md:text-[13px]"
                  onClick={startRecordFromHeader}
                  disabled={
                    isScreenRecording || headerRecordStarting
                  }
                  title="Record your screen, then open Send Feedback with the video attached"
                  aria-label="Record screen for feedback"
                >
                  {headerRecordStarting ? (
                    <span className="m-0 h-[18px] w-[18px] shrink-0 animate-[spin_0.8s_linear_infinite] rounded-full border-2 border-slate-200 border-t-[#00b48a]" />
                  ) : (
                    <svg
                      className="h-5 w-5 shrink-0 text-red-600"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                  )}
                  <span className="whitespace-nowrap">Record screen</span>
                </button>
              ) : null}
            </>
          )}
        </div>
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
        {/* Header — recording timer + stop / cancel while capturing video */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 sm:px-6 sm:py-[5px]">
          <h2 className="m-0 min-w-0 flex-1 font-sans text-lg font-semibold text-gray-900">
            Send Feedback
          </h2>
          {isScreenRecording ? (
            <div
              className="flex items-center gap-2 font-mono text-sm tabular-nums text-gray-800"
              aria-live="polite"
            >
              <span
                className="inline-flex h-2 w-2 animate-pulse rounded-full bg-red-600"
                aria-hidden
              />
              {formatRecordingDuration(recordingElapsedSec)}
            </div>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {isScreenRecording ? (
              <>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border-0 bg-[#00b48a] px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-[#009a78] sm:text-sm"
                  onClick={() => {
                    void handleDisableScreenRecording().catch((e) => {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not finalize recording.",
                      );
                    });
                  }}
                >
                  Stop
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-1.5 font-sans text-xs font-medium text-gray-700 hover:bg-gray-50 sm:text-sm"
                  onClick={discardRecordingOnly}
                >
                  Cancel
                </button>
              </>
            ) : null}
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
            <>
              {isScreenRecording && (
                <div
                  className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 font-sans text-[13px] text-amber-950"
                  role="status"
                >
                  Recording{" "}
                  <span className="font-mono font-semibold tabular-nums">
                    {formatRecordingDuration(recordingElapsedSec)}
                  </span>
                  — screen, mic, and optional tab audio upload in the background.
                  Highlight the screenshot with the tools on the left. Use{" "}
                  <strong>Stop</strong> in the header when finished, then submit.
                </div>
              )}
              <AnnotationEditor
                screenshot={screenshotDataUrl}
                metadata={metadata}
                requiresReporterEmail={Boolean(config.projectId)}
                onSave={handleAnnotationSave}
                onBack={handleBack}
                screenRecordingOffered={screenRecordingOffered}
                screenRecordingActive={isScreenRecording}
                onEnableScreenRecording={handleEnableScreenRecording}
                onDisableScreenRecording={handleDisableScreenRecording}
              />
            </>
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
                <>
                  <p className="m-0 mb-6 font-sans text-sm text-gray-500">
                    Your feedback was received.
                  </p>
                  {result?.recordingStatus === "processing" && (
                    <p
                      className="m-0 mb-4 rounded-lg border border-sky-200 bg-sky-50 px-[14px] py-3 text-left font-sans text-sm text-sky-950"
                      role="status"
                    >
                      Screen recording is processing and will be attached to
                      the Jira issue shortly.
                    </p>
                  )}
                  {typeof result?.recordingError === "string" &&
                    result.recordingError.trim().length > 0 && (
                      <p
                        className="m-0 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-[14px] py-3 text-left font-sans text-sm text-amber-950"
                        role="alert"
                      >
                        {result.recordingError.trim()}
                      </p>
                    )}
                </>
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
