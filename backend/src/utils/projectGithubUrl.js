import { parseGitRepoPath } from "../services/github.service.js";
import { projectRepoSlugFromDisplayName } from "./projectValidation.utils.js";

/**
 * Public web URL for a project's GitHub repo (metadata for diff summary, Jira, etc.).
 */
export function projectRepositoryWebUrl(project) {
  if (!project) return null;
  const parsed = parseGitRepoPath(project.gitRepoPath);
  if (parsed?.owner && parsed?.repo) {
    return `https://github.com/${parsed.owner}/${parsed.repo}`;
  }
  const user = project.githubUsername?.trim();
  const name = project.name;
  if (user && name) {
    const repo = projectRepoSlugFromDisplayName(name);
    return `https://github.com/${user}/${repo}`;
  }
  return null;
}
