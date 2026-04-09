export default class ApiError extends Error {
    /**
     * @param {number} statusCode
     * @param {string} message
     * @param {string | null} [code] — optional machine-readable key for clients (e.g. CHAT_AGENT_BUSY)
     */
    constructor(statusCode, message, code = null) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}