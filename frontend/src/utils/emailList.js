const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isLikelyEmail(value) {
  if (typeof value !== "string") return false;
  return EMAIL_RE.test(value.trim());
}

/**
 * @param {string} value
 * @param {string} label - field label for error messages
 * @returns {string|null} error message or null if ok / empty
 */
export function validateOptionalCommaSeparatedEmails(value, label) {
  if (value == null || String(value).trim() === "") return null;
  const parts = String(value)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!EMAIL_RE.test(p)) return `${label}: invalid email "${p}"`;
  }
  return null;
}

const HUB_EMAIL_KEYS = [
  "email",
  "clientEmail",
  "ownerEmail",
  "managerEmail",
  "assignedUserEmail",
  "contactEmail",
  "leadEmail",
];

function pushEmailCandidate(out, v) {
  if (typeof v !== "string") return;
  const t = v.trim();
  if (t.includes("@")) out.push(t);
}

/**
 * @param {Record<string, unknown>} p - hub project row from external list API
 * @returns {string[]}
 */
export function collectEmailsFromHubProject(p) {
  if (!p || typeof p !== "object") return [];
  const out = [];
  for (const k of HUB_EMAIL_KEYS) {
    pushEmailCandidate(out, p[k]);
  }
  for (const key of ["lead", "product_manager", "product_strategist"]) {
    const obj = p[key];
    if (obj && typeof obj === "object" && "email" in obj) {
      pushEmailCandidate(out, obj.email);
    }
  }
  const allocs = p.allocations;
  if (Array.isArray(allocs)) {
    for (const a of allocs) {
      if (!a || typeof a !== "object") continue;
      const emp = a.employee;
      if (emp && typeof emp === "object" && "email" in emp) {
        pushEmailCandidate(out, emp.email);
      }
      if ("employee_id" in a) {
        pushEmailCandidate(out, a.employee_id);
      }
    }
  }
  return out;
}

/**
 * Unique sorted emails for one hub project (Form hub shape).
 * @param {Record<string, unknown>|null|undefined} p
 * @returns {string[]}
 */
export function uniqueEmailsForHubProject(p) {
  const raw = collectEmailsFromHubProject(p);
  const seen = new Map();
  for (const e of raw) {
    const k = e.toLowerCase();
    if (!seen.has(k)) seen.set(k, e);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {unknown[]} projects
 * @returns {string[]} unique emails for datalist suggestions
 */
export function uniqueEmailsFromHubProjects(projects) {
  const first = new Map();
  for (const p of projects || []) {
    for (const e of collectEmailsFromHubProject(p)) {
      const k = e.toLowerCase();
      if (!first.has(k)) first.set(k, e);
    }
  }
  return [...first.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string|null|undefined} raw - stored DB / API value
 * @returns {string[]}
 */
export function storageStringToEmailsArray(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  const parts = String(raw)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * @param {string[]} emails
 * @returns {string} comma-separated for storage / API
 */
export function emailsArrayToStorageString(emails) {
  if (!emails?.length) return "";
  const seen = new Set();
  const out = [];
  for (const e of emails) {
    const t = String(e).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(", ");
}
