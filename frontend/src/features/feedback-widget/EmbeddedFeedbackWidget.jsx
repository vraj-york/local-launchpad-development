import { useMemo, forwardRef } from "react";
import FeedbackWidget from "./FeedbackWidget";
import config from "@/config";

const EmbeddedFeedbackWidget = forwardRef(function EmbeddedFeedbackWidget(
  {
    projectId,
    /** When set with projectId, issue submission sends this email for stakeholder checks (client link). */
    getClientEmail = null,
    captureTarget = null,
    /** When true, the Report Issue button is positioned in the bottom-right of its parent (e.g. preview panel), not the viewport. */
    anchorToPreview = false,
    /** When true, the default floating Report Issue control is not rendered (use ref `open()` from a custom trigger). */
    hideDefaultTrigger = false,
    onCapturingChange,
    /** Called when screen recording starts or stops (for disabling toolbar buttons, etc.). */
    onScreenRecordingChange,
    onSuccess,
    onError,
  },
  ref,
) {
  const widgetConfig = useMemo(
    () => ({
      projectId: String(projectId),
      getClientEmail,
      apiUrl: config.API_URL,
      captureTarget,
      anchorToPreview,
      hideDefaultTrigger,
      onCapturingChange,
      onScreenRecordingChange,
      onSuccess,
      onError,
    }),
    [
      projectId,
      getClientEmail,
      captureTarget,
      anchorToPreview,
      hideDefaultTrigger,
      onCapturingChange,
      onScreenRecordingChange,
      onSuccess,
      onError,
    ],
  );

  if (!projectId) {
    return null;
  }

  return <FeedbackWidget ref={ref} config={widgetConfig} />;
});

export default EmbeddedFeedbackWidget;
