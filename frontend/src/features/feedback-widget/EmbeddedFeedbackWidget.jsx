import { useMemo } from "react";
import FeedbackWidget from "./FeedbackWidget";
import config from "@/config";

export default function EmbeddedFeedbackWidget({
  projectId,
  captureTarget = null,
  onSuccess,
  onError,
}) {
  const widgetConfig = useMemo(
    () => ({
      projectId: String(projectId),
      apiUrl: config.API_URL,
      captureTarget,
      onSuccess,
      onError,
    }),
    [projectId, captureTarget, onSuccess, onError],
  );

  if (!projectId) {
    return null;
  }

  return <FeedbackWidget config={widgetConfig} />;
}
