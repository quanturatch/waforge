# Screenshots

PNG assets for the root product README.

| File | Description |
|------|-------------|
| `01-login.png` | Dashboard login (API key) |
| `02-dashboard.png` | Main dashboard |
| `03-sessions.png` | Sessions page |
| `04-swagger.png` | Swagger UI at `/api/docs` |

Regenerate with a running stack (`npm run dev`):

```bash
npx --yes playwright install chromium
node scripts/capture-screenshots.mjs
```
