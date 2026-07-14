/**
 * Wait until the Nest API health endpoint answers before starting the Vite dashboard.
 * Avoids noisy `http proxy error: ECONNREFUSED` while `nest start --watch` is still compiling.
 *
 * Env:
 *   WAIT_API_URL          default http://127.0.0.1:2785/api/health
 *   WAIT_API_TIMEOUT_MS   default 180000 (3 min)
 *   WAIT_API_INTERVAL_MS  default 500
 */
import http from 'node:http';
import https from 'node:https';

const url = process.env.WAIT_API_URL || 'http://127.0.0.1:2785/api/health';
const timeoutMs = Number(process.env.WAIT_API_TIMEOUT_MS || 180_000);
const intervalMs = Number(process.env.WAIT_API_INTERVAL_MS || 500);
const start = Date.now();

function probe(target) {
  return new Promise(resolve => {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      resolve(false);
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        timeout: 2_000,
      },
      res => {
        res.resume();
        // Any HTTP response means the port is up (health may be 200).
        resolve(typeof res.statusCode === 'number' && res.statusCode > 0);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

process.stdout.write(`[wait-for-api] waiting for ${url} …\n`);

while (Date.now() - start < timeoutMs) {
  // eslint-disable-next-line no-await-in-loop
  const ok = await probe(url);
  if (ok) {
    process.stdout.write(`[wait-for-api] API is up after ${Date.now() - start}ms\n`);
    process.exit(0);
  }
  // eslint-disable-next-line no-await-in-loop
  await new Promise(r => setTimeout(r, intervalMs));
}

console.error(`[wait-for-api] timed out after ${timeoutMs}ms waiting for ${url}`);
process.exit(1);
