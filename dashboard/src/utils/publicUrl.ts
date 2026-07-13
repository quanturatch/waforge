/**
 * Resolve public absolute origins for links shown in the dashboard (MCP, docs, etc.).
 *
 * - Production single-host: dashboard + API share `window.location.origin`.
 * - Split deploy: set `VITE_API_URL` to the API origin at build time.
 * - Local Vite dev: origin is :2886; `/api` and `/mcp` are proxied to the API (:2785).
 */

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Absolute origin of the API (no trailing slash). Falls back to the browser origin. */
export function getApiOrigin(): string {
  if (API_ORIGIN) return API_ORIGIN;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}

/**
 * Absolute MCP Streamable-HTTP URL for this deployment.
 * Always recomputed from the current origin / VITE_API_URL (never hard-coded).
 */
export function getMcpUrl(): string {
  const origin = getApiOrigin();
  return origin ? `${origin}/mcp` : '/mcp';
}
