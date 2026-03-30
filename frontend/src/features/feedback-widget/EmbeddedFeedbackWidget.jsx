import { useMemo } from "react";
import FeedbackWidget from "./FeedbackWidget";
import config from "@/config";

export default function EmbeddedFeedbackWidget({
  projectId,
  captureTarget = null,
  /** When true, the Report Issue button is positioned in the bottom-right of its parent (e.g. preview panel), not the viewport. */
  anchorToPreview = false,
  onSuccess,
  onError,
}) {
  const widgetConfig = useMemo(
    () => ({
      projectId: String(projectId),
      apiUrl: config.API_URL,
      captureTarget,
      anchorToPreview,
      onSuccess,
      onError,
    }),
    [projectId, captureTarget, anchorToPreview, onSuccess, onError],
  );

  if (!projectId) {
    return null;
  }

  return <FeedbackWidget config={widgetConfig} />;
}
