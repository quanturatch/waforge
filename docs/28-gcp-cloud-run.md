# 28 — Deploy Quantura on Google Cloud Run

Quantura runs as a single container (API + optional bundled dashboard). Cloud Run is a good fit when you attach a persistent volume (or external Postgres) for SQLite/session data.

## Prerequisites

- `gcloud` CLI authenticated
- Artifact Registry repo
- Custom domain mapped in Cloud Run (or Cloud Load Balancing + managed cert)

## Build & push

```bash
export PROJECT_ID=your-gcp-project
export REGION=us-central1
export REPO=quantura
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/quantura:latest

gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION || true
gcloud builds submit --tag "$IMAGE"
```

## Deploy (SQLite + volume)

Cloud Run needs a mounted volume for `./data` (sessions, SQLite, media). Use **Cloud Storage FUSE** or **Filestore**, or switch to **Cloud SQL (Postgres)** for production.

```bash
gcloud run deploy quantura \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 2785 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "NODE_ENV=production,PORT=2785,DATABASE_TYPE=sqlite,STORAGE_TYPE=local,CORS_ORIGINS=https://app.yourdomain.com,ENABLE_SWAGGER=false,MCP_ENABLED=true,MCP_READONLY=true" \
  --set-secrets "API_MASTER_KEY=quantura-api-master:latest,AI_API_KEY=quantura-ai-key:latest"
```

### Recommended production env

| Variable | Value |
|----------|--------|
| `DATABASE_TYPE` | `postgres` + Cloud SQL |
| `CORS_ORIGINS` | Your dashboard origin(s) only |
| `MCP_ENABLED` | `true` if agents use `/mcp` |
| `AI_AUTO_REPLY_ENABLED` | `true` + `AI_PROVIDER` + `AI_API_KEY` |
| `ENGINE_TYPE` | `baileys` (lighter on Cloud Run) or `whatsapp-web.js` with more memory |
| `PUPPETEER_EXECUTABLE_PATH` | set if using Chromium in image |

## Custom domain

```bash
gcloud run domain-mappings create \
  --service quantura \
  --domain api.yourdomain.com \
  --region "$REGION"
```

Add the DNS records Cloud Run prints. For HTTPS on a global load balancer, use a managed SSL certificate.

## Split dashboard (optional)

Build the dashboard with:

```bash
cd dashboard
VITE_API_URL=https://api.yourdomain.com npm run build
```

Host `dashboard/dist` on Firebase Hosting / Cloud Storage + CDN, and set `CORS_ORIGINS` to that origin.

## Health checks

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready` (send `X-API-Key` if required by your setup)

## Notes

- WhatsApp engines need stable storage for session auth; ephemeral Cloud Run instances without a volume will force re-scan of QR.
- Prefer **Baileys** on Cloud Run to avoid Chromium memory limits unless you raise `--memory` to 4Gi+.
- Keep `AI_API_KEY` and API keys in **Secret Manager**, never in the image.
