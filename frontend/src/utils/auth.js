/**
 * Decode JWT payload without verification (only to read exp).
 * Returns null if token is invalid/not a JWT.
 */
export const getTokenPayload = (token) => {
    if (!token || typeof token !== 'string') return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1];
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(
            atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(json);
    } catch {
        return null;
    }
};

/** Default buffer: treat as expired this many seconds before exp. */
const DEFAULT_EXPIRY_BUFFER = 60;

/**
 * Check if JWT is expired (or will expire in the next 60 seconds).
 * Returns true if token is missing, invalid, or expired.
 */
export const isTokenExpired = (token) => {
    const payload = getTokenPayload(token);
    if (!payload) return false;
    if (typeof payload.exp !== 'number') return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp <= nowSeconds + DEFAULT_EXPIRY_BUFFER;
};

/**
 * Check if JWT will expire within the given buffer (seconds).
 * Use for proactive refresh (e.g. refresh when exp is in 5 minutes).
 */
export const isTokenExpiringSoon = (token, bufferSeconds = 5 * 60) => {
    const payload = getTokenPayload(token);
    if (!payload || typeof payload.exp !== 'number') return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp <= nowSeconds + bufferSeconds;
};
