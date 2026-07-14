import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single source of truth for the version shown in the dashboard: read it from
// package.json at build time so the Login screen always reflects the actual
// release (bumped via `npm version`), instead of a hard-coded literal that
// silently drifts. APP_VERSION env still overrides if explicitly provided.
const { version: pkgVersion } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  version: string;
};

/** Prefer 127.0.0.1 over localhost on Windows to avoid dual-stack ECONNREFUSED noise. */
const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:2785';

/**
 * Shared proxy options for /api, /mcp, and socket.io during local `npm run dev`.
 * When the API is still compiling, answer with a short JSON 503 instead of crashing
 * the proxy socket and flooding the Vite console with AggregateError stacks.
 */
function apiProxy(extra: ProxyOptions = {}): ProxyOptions {
  let lastWarnAt = 0;
  return {
    target: API_PROXY_TARGET,
    changeOrigin: true,
    secure: false,
    ...extra,
    configure(proxy) {
      proxy.on('error', (err, _req, res) => {
        const now = Date.now();
        // At most one warn line every 5s while the API boots.
        if (now - lastWarnAt > 5_000) {
          lastWarnAt = now;
          console.warn(
            `[vite] API proxy: ${err.message || 'connection failed'} (is Nest still starting on ${API_PROXY_TARGET}?)`,
          );
        }
        // `res` can be a raw Socket for WS upgrades — only write HTTP responses for IncomingMessage.
        if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              statusCode: 503,
              error: 'Service Unavailable',
              message: 'API is still starting. Wait for Nest to finish boot, then refresh.',
            }),
          );
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  appType: 'spa', // Enable SPA fallback for client-side routing
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkgVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 2886,
    proxy: {
      '/api': apiProxy(),
      // MCP agent transport (POST /mcp) lives on the API process — proxy it in dev so the
      // dashboard's dynamic MCP URL (window.location.origin/mcp) works on :2886.
      '/mcp': apiProxy(),
      // Proxy the WebSocket (socket.io) transport so the dashboard's real-time
      // chats/sessions streams work against the dev backend.
      '/socket.io': apiProxy({ ws: true }),
    },
  },
});
