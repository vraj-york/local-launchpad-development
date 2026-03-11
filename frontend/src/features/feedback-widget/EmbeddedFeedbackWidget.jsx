import { useMemo, useEffect } from "react";
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

  useEffect(() => {
    console.log("[feedback-capture] EmbeddedFeedbackWidget — mounted", {
      projectId,
      captureTarget,
      apiUrl: config.API_URL,
      hasCaptureTarget: !!captureTarget,
    });
    if (captureTarget && typeof captureTarget === 'string') {
      const el = document.querySelector(captureTarget);
      console.log("[feedback-capture] EmbeddedFeedbackWidget — capture target check", {
        selector: captureTarget,
        found: !!el,
        tagName: el?.tagName,
        id: el?.id || '(none)',
        childCount: el?.childElementCount,
        hasIframe: !!el?.querySelector?.('iframe'),
      });
    }
  }, [projectId, captureTarget]);

  if (!projectId) {
    console.warn("[feedback-capture] EmbeddedFeedbackWidget — no projectId, not rendering");
    return null;
  }

  return <FeedbackWidget config={widgetConfig} />;
}
