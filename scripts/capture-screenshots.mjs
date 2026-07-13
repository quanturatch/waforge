/**
 * One-shot screenshot capture for README (Playwright).
 * Usage: node scripts/capture-screenshots.mjs
 * Requires: npx playwright (chromium) available.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'docs', 'screenshots');
const API_KEY = process.env.WAFORGE_API_KEY || 'dev-admin-key';
const DASH = process.env.WAFORGE_DASHBOARD_URL || 'http://localhost:2886';
const SWAGGER = process.env.WAFORGE_SWAGGER_URL || 'http://localhost:2785/api/docs';

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

async function shot(name, fn) {
  const path = join(outDir, name);
  console.log(`→ ${name}`);
  await fn();
  await page.waitForTimeout(800);
  await page.screenshot({ path, fullPage: false });
  console.log(`  saved ${path}`);
}

try {
  // 01 Login
  await shot('01-login.png', async () => {
    await page.goto(DASH, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('input#apiKey, input[type="password"], .login-container', {
      timeout: 30000,
    });
  });

  // Login with API key
  const keyInput = page.locator('#apiKey, input[type="password"]').first();
  await keyInput.fill(API_KEY);
  await page.locator('button.connect-btn, button[type="submit"]').first().click();
  await page.waitForTimeout(2000);
  // Wait for either dashboard content or navigation away from login
  try {
    await page.waitForFunction(
      () => !document.querySelector('.login-container') || location.pathname !== '/',
      { timeout: 20000 },
    );
  } catch {
    // may already be on dashboard route
  }
  await page.waitForTimeout(1500);

  // 02 Dashboard (home)
  await shot('02-dashboard.png', async () => {
    await page.goto(`${DASH}/`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    // try common dashboard routes
    const candidates = ['/', '/dashboard', '/home'];
    for (const c of candidates) {
      await page.goto(`${DASH}${c}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1000);
      if (!(await page.locator('.login-container').count())) break;
    }
    await page.waitForTimeout(1500);
  });

  // 03 Sessions
  await shot('03-sessions.png', async () => {
    const routes = ['/sessions', '/#/sessions'];
    for (const r of routes) {
      await page.goto(`${DASH}${r}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if ((await page.locator('text=Session').count()) > 0 || (await page.locator('text=session').count()) > 0) {
        break;
      }
    }
    await page.waitForTimeout(1000);
  });

  // 04 Swagger
  await shot('04-swagger.png', async () => {
    await page.goto(SWAGGER, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('.swagger-ui, #swagger-ui, .information-container', {
      timeout: 30000,
    }).catch(() => {});
    await page.waitForTimeout(1500);
  });

  await writeFile(
    join(outDir, 'README.md'),
    `# Screenshots

PNG assets for the root product README.

| File | Description |
|------|-------------|
| \`01-login.png\` | Dashboard login (API key) |
| \`02-dashboard.png\` | Main dashboard |
| \`03-sessions.png\` | Sessions page |
| \`04-swagger.png\` | Swagger UI at \`/api/docs\` |

Regenerate with a running stack (\`npm run dev\`):

\`\`\`bash
npx --yes playwright install chromium
node scripts/capture-screenshots.mjs
\`\`\`
`,
    'utf8',
  );

  console.log('Done.');
} catch (err) {
  console.error('Screenshot capture failed:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
