export function maskSecretValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "**";
  const suffix = trimmed.slice(-4);
  return `${"*".repeat(Math.max(2, trimmed.length - 4))}${suffix}`;
}

export function isMaskedSecretValue(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^\*{2,}[A-Za-z0-9._-]{0,4}$/.test(trimmed);
}

export function maskProjectSecrets(project) {
  if (!project || typeof project !== "object") return project;
  return {
    ...project,
    githubToken: maskSecretValue(project.githubToken),
    jiraApiToken: maskSecretValue(project.jiraApiToken),
  };
}
