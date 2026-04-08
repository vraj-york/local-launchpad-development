/**
 * Single browser email identity for client-link flows: release lock, future
 * issue/feedback verification, and AI chat.
 */
export const CLIENT_LINK_VERIFIED_EMAIL_KEY = "client_link_verified_email";

/**
 * Lightweight client-side check for lock, chat, and issue forms.
 * The API still validates with validator.isEmail.
 */
export function isPlausibleClientLinkEmail(raw) {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function getClientLinkVerifiedEmail() {
  try {
    const next = localStorage.getItem(CLIENT_LINK_VERIFIED_EMAIL_KEY);
    if (typeof next === "string" && next.trim()) {
      return next.trim().toLowerCase();
    }
  } catch {
    /* storage unavailable */
  }
  return "";
}

export function setClientLinkVerifiedEmail(email) {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!e) return;
  try {
    localStorage.setItem(CLIENT_LINK_VERIFIED_EMAIL_KEY, e);
  } catch {
    /* storage unavailable */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("client-link-identity-updated"));
    }
  } catch {
    /* ignore */
  }
}
