import React from 'react';
import { createRoot } from 'react-dom/client';
import FeedbackWidget from './FeedbackWidget';
import { validateConfig } from './services/api.service';

class FeedbackWidgetAPI {
  constructor() {
    this.config = null;
    this.container = null;
    this.root = null;
    this.isInitialized = false;
  }

  init(config) {
    try {
      // Validate configuration
      validateConfig(config);

      // Set defaults
      this.config = {
        projectId: config.projectId,
        apiUrl: config.apiUrl,
        position: config.position || 'bottom-right',
        theme: config.theme || 'light',
        onSuccess: config.onSuccess || null,
        onError: config.onError || null
      };

      // Create container if it doesn't exist
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'feedback-widget-root';
        this.container.style.position = 'fixed';
        this.container.style.zIndex = '999999';
        document.body.appendChild(this.container);
      }

      // Create React root and render
      if (!this.root) {
        this.root = createRoot(this.container);
      }

      this.root.render(
        React.createElement(FeedbackWidget, { config: this.config })
      );

      this.isInitialized = true;

      // Setup keyboard shortcut (Ctrl+Shift+F)
      this.setupKeyboardShortcut();

      console.log('✅ Feedback Widget initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Feedback Widget initialization failed:', error);
      if (this.config?.onError) {
        this.config.onError(error);
      }
      return false;
    }
  }

  setupKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+F or Cmd+Shift+F
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        const button = document.querySelector('.feedback-widget-button');
        if (button) {
          button.click();
        }
      }
    });
  }

  destroy() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    this.isInitialized = false;
    console.log('Feedback Widget destroyed');
  }

  isReady() {
    return this.isInitialized;
  }

  getConfig() {
    return this.config;
  }
}

// Create singleton instance
const feedbackWidgetInstance = new FeedbackWidgetAPI();

// Export for UMD
export default feedbackWidgetInstance;

// Also expose on window for script tag usage
if (typeof window !== 'undefined') {
  window.FeedbackWidget = feedbackWidgetInstance;
}
