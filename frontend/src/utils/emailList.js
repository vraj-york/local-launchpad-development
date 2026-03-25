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
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const p of parts) {
    if (!re.test(p)) return `${label}: invalid email "${p}"`;
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

/**
 * @param {Record<string, unknown>} p - hub project row from external list API
 * @returns {string[]}
 */
export function collectEmailsFromHubProject(p) {
  if (!p || typeof p !== "object") return [];
  const out = [];
  for (const k of HUB_EMAIL_KEYS) {
    const v = p[k];
    if (typeof v === "string" && v.includes("@")) out.push(v.trim());
  }
  return out;
}

/**
 * @param {unknown[]} projects
 * @returns {string[]} unique emails for datalist suggestions
 */
export function uniqueEmailsFromHubProjects(projects) {
  const set = new Set();
  for (const p of projects || []) {
    for (const e of collectEmailsFromHubProject(p)) {
      set.add(e);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
