const TOKEN_KEY = 'authToken';

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

/**
 * Check if JWT is expired (or will expire in the next 60 seconds).
 * Returns true if token is missing, invalid, or expired.
 */
export const isTokenExpired = (token) => {
    const payload = getTokenPayload(token);
    // Hub/opaque tokens are not app JWTs — do not treat as expired here (backend may still 401)
    if (!payload) return false;
    if (typeof payload.exp !== 'number') return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const bufferSeconds = 60;
    return payload.exp <= nowSeconds + bufferSeconds;
};

export const setToken = (token) => {
    localStorage.setItem(TOKEN_KEY, token);
};

export const getToken = () => {
    return localStorage.getItem(TOKEN_KEY);
};

export const removeToken = () => {
    localStorage.removeItem(TOKEN_KEY);
};

export const isLoggedIn = () => {
    return !!getToken();
};
