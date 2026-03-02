import { useEffect, useRef } from 'react';
import config from '@/config';

const WIDGET_SCRIPT_ID = 'feedback-widget-script';
const WIDGET_SCRIPT_MARKER = 'feedback-widget.min.js';

/**
 * Loads the feedback widget script from the backend and initializes it with the given projectId.
 * When the component unmounts (e.g. user leaves the project details page), the widget is destroyed.
 * Use this on pages where you want the "Report Issue" / marker.io-style feedback button (e.g. ProjectDetails).
 */
export function FeedbackWidgetLoader({ projectId, apiUrl = config.API_URL }) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!projectId) return;

    const baseUrl = (apiUrl || config.API_URL || '').replace(/\/$/, '');
    const scriptUrl = `${baseUrl}/static/${WIDGET_SCRIPT_MARKER}`;

    const initWidget = () => {
      if (typeof window.FeedbackWidget === 'undefined') return;
      if (initializedRef.current) return;
      window.FeedbackWidget.init({
        projectId: String(projectId),
        apiUrl: baseUrl,
      });
      initializedRef.current = true;
    };

    const destroyWidget = () => {
      if (typeof window.FeedbackWidget !== 'undefined' && window.FeedbackWidget.destroy) {
        window.FeedbackWidget.destroy();
      }
      initializedRef.current = false;
    };

    // Script already in page (e.g. from a previous visit to this page)
    const existingScript = document.getElementById(WIDGET_SCRIPT_ID) || document.querySelector(`script[src*="${WIDGET_SCRIPT_MARKER}"]`);
    if (existingScript) {
      initWidget();
      return () => destroyWidget();
    }

    const script = document.createElement('script');
    script.id = WIDGET_SCRIPT_ID;
    script.src = scriptUrl;
    script.async = true;
    script.onload = initWidget;
    script.onerror = () => {
      console.warn('[FeedbackWidgetLoader] Failed to load feedback widget script from', scriptUrl);
    };
    document.head.appendChild(script);

    return () => {
      destroyWidget();
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [projectId, apiUrl]);

  return null;
}

export default FeedbackWidgetLoader;