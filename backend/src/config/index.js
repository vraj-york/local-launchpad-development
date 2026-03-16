/**
 * ============================================================
 * BACKEND CONFIGURATION
 * ============================================================
 * 
*/
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

/**
 * Host used for project build/live URLs (e.g. http://{host}:8001).
 * Prefer BASE_DOMAIN; otherwise derived from BASE_URL so EC2/deployment
 * only needs BASE_URL set (e.g. http://15.206.209.185:5000).
 */
function getBuildUrlHost() {
  if (process.env.BASE_DOMAIN) return process.env.BASE_DOMAIN;
  try {
    const u = new URL(BASE_URL);
    return u.hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

/** Protocol for project build/live URLs: https when BASE_URL is https, else http. */
function getBuildUrlProtocol() {
  return (BASE_URL || '').startsWith('https') ? 'https' : 'http';
}

const config = {
  // Base URL - used for generating build URLs and API responses
  BASE_URL,

  // Server port
  PORT: process.env.PORT || 5000,

  // Current environment (development/production)
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Helper to check if running in production
  isProduction: process.env.NODE_ENV === 'production',

  /** Host for project build URLs (EC2 IP or domain when BASE_URL/BASE_DOMAIN set). */
  getBuildUrlHost,
  /** Protocol for build URLs so live env uses https when BASE_URL is https. */
  getBuildUrlProtocol,
};

export default config;
