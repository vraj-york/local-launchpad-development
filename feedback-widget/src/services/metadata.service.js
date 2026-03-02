// Metadata Service - Collect browser and page information

export const collectMetadata = () => {
  const metadata = {
    // Browser information
    browser: detectBrowser(),
    userAgent: navigator.userAgent,
    
    // Screen information
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio || 1,
    
    // Page information
    pageUrl: window.location.href,
    pageTitle: document.title,
    
    // Timestamp
    timestamp: new Date().toISOString(),
    
    // Additional info
    language: navigator.language,
    platform: navigator.platform,
    cookiesEnabled: navigator.cookieEnabled,
    onlineStatus: navigator.onLine
  };

  return metadata;
};

const detectBrowser = () => {
  const userAgent = navigator.userAgent;
  let browser = 'Unknown';

  if (userAgent.indexOf('Firefox') > -1) {
    browser = 'Firefox';
  } else if (userAgent.indexOf('Opera') > -1 || userAgent.indexOf('OPR') > -1) {
    browser = 'Opera';
  } else if (userAgent.indexOf('Trident') > -1) {
    browser = 'Internet Explorer';
  } else if (userAgent.indexOf('Edge') > -1) {
    browser = 'Edge';
  } else if (userAgent.indexOf('Chrome') > -1) {
    browser = 'Chrome';
  } else if (userAgent.indexOf('Safari') > -1) {
    browser = 'Safari';
  }

  return browser;
};

export const formatMetadataForDisplay = (metadata) => {
  return [
    { label: 'Browser', value: metadata.browser },
    { label: 'Screen', value: metadata.screenResolution },
    { label: 'Viewport', value: metadata.viewportSize },
    { label: 'URL', value: metadata.pageUrl },
    { label: 'Time', value: new Date(metadata.timestamp).toLocaleString() }
  ];
};
