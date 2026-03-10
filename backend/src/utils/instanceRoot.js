import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Instance root: directory that contains frontend, backend, projects, and nginx-configs.
 * Set INSTANCE_ROOT on the server so projects folder is shared at instance level
 * (e.g. /home/ubuntu/zip-sync). If unset, falls back to process.cwd().
 */
export function getInstanceRoot() {
  const root = process.env.INSTANCE_ROOT;
  return root ? path.resolve(root) : path.resolve(process.cwd());
}

/** Backend root: the directory containing the backend app (backend/ in repo, /app in Docker). Always derived from this file's location so projects never end up under frontend. */
export function getBackendRoot() {
  return path.resolve(__dirname, "..", "..");
}

/** Resolved path to the projects directory: always backend/projects (or /app/projects in Docker). */
export function getProjectsDir() {
  return path.join(getBackendRoot(), "projects");
}

/** Resolved path to nginx-configs: backend/nginx-configs (or /app/nginx-configs in Docker). */
export function getNginxConfigsDir() {
  return path.join(getBackendRoot(), "nginx-configs");
}

/** Base domain for nginx server_name (subdomain per project). e.g. "localhost" or "example.com". */
export function getNginxBaseDomain() {
  return process.env.NGINX_BASE_DOMAIN || process.env.BASE_DOMAIN || "localhost";
}

/** Host nginx uses for proxy_pass to project ports. In Docker set to "backend"; otherwise "localhost". */
export function getNginxUpstreamHost() {
  return process.env.NGINX_UPSTREAM_HOST || "localhost";
}
