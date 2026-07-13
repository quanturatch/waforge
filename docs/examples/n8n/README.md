# Quantura n8n templates

Import these workflows into [n8n](https://n8n.io) to automate WhatsApp via **Quantura**.

| File | Use case |
|------|----------|
| `01-ai-support-bot.json` | Support triage + human handoff |
| `02-lead-qualifier.json` | Score leads → CRM → follow-up |
| `03-appointment-booking.json` | Booking intent → availability API → confirm |

## Setup

1. Run Quantura and create a session (scan QR).
2. Create a webhook in the Quantura dashboard pointing at your n8n webhook URL, event `message.received`.
3. In n8n, set environment variables:
   - `QUANTURA_BASE_URL` — e.g. `https://api.yourdomain.com`
   - `QUANTURA_API_KEY` — admin or operator key
   - `CRM_WEBHOOK_URL` / `AVAILABILITY_API_URL` — for lead/booking templates
4. Import the JSON file (**Workflows → Import**).
5. Activate the workflow and send a test WhatsApp message.

## Tip: built-in AI

For zero-n8n auto replies, enable **Infrastructure → AI Auto-Reply** in the Quantura dashboard (OpenAI, Claude, Grok, or Gemini) instead of wiring an LLM node.
