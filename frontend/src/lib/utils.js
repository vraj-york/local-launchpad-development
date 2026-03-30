import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** R1-style revisions as-is; legacy semver gets a `v` prefix (e.g. v1.0.0). */
export function formatProjectVersionLabel(versionStr) {
  if (versionStr == null || versionStr === "") return "";
  const s = String(versionStr);
  if (/^R\d+$/i.test(s)) return s;
  return `v${s}`;
}
