# VetFlow

Booking-and-automation product for manual PH vet clinics: a website funnel where pet owners book real calendar slots, an AI receptionist that answers FAQs and books in-chat, and automated SMS/email reminders that cut no-shows and recover lapsed vaccines — with a dashboard ₱-recovered metric that shows the clinic what the system earned back.

## Stack
- Node.js 20+, Express (deployed as Vercel serverless functions)
- Turso (libSQL, SQLite-compatible) for data — accessed via @libsql/client
- Vanilla JS single-page frontend (no framework, no build step) served from /public
- Cron trigger: self-hosted n8n Schedule node → HTTP POST to /api/cron/reminders (fallback: GitHub Actions)
- SMS via Semaphore, email via Resend — both behind one notify() module
- AI via OpenRouter chat completions; model set by OPENROUTER_MODEL env var
- Deploy target: Vercel (Hobby tier)

## Commands
- `dev`: npm run dev (node --watch server.js)
- `start`: npm start
- `seed`: npm run seed (rebuilds Turso demo data)
- `test`: npm test

## Conventions
- ES modules ("type": "module")
- Layout: server.js, /api (Vercel routes), /routes, /db (schema.sql, seed.js, client.js, profiles/), /ai (openrouter.js, prompts.js), /notify (index.js, semaphore.js, email.js), /public (index.html funnel landing, chat.html, dashboard.html, thankyou.html + matching JS, styles.css)
- All AI calls go through /ai/openrouter.js — never fetch OpenRouter elsewhere
- All SMS/email go through /notify/index.js notify() — never call Semaphore/Resend directly elsewhere
- All prompts live in /ai/prompts.js
- All DB access goes through /db/client.js — no raw libSQL clients scattered around
- Errors: return {error} JSON with proper status; never crash the demo mid-pitch
- Clinic-specific text, branding, services, hours, language come from the active clinic profile — hardcoded clinic strings anywhere are a bug

## Workflow
- Read PLAN.md for scope and phases; PROGRESS.md for current state; RULES.md before writing code.
- Work strictly one phase at a time. After finishing a phase, run the audit-phase skill.

## Key context
- This is a SALES DEMO first, real product second. Keep it always demo-able — never leave main broken.
- Scheduling is REAL: vet hours → generated slots, capacity, conflict prevention. This is the hard part; phase 2 needs real double-booking tests.
- Reminders are "windows not stopwatches": the cron route sends whatever is due-and-unsent, so a late or missed n8n tick self-heals on the next run. Never depend on exact firing time.
- SMS costs real money. Ship a DRY_RUN mode (env flag) that logs instead of sends; default ON in demo.
- Reschedule/confirm links are tokenized URLs — pet owners have NO accounts in v1. Keep it that way.
- AI must handle Taglish naturally (mixed Tagalog/English). Test Taglish early.
- Turso free tier does not pause and is SQLite-compatible — keep queries portable so a swap back to file-SQLite is trivial.
- Public demo protected by DEMO_PASSCODE middleware + per-IP rate limit so API credits/SMS don't get drained.
- Seed data is PH-flavored: Aspin/Puspin pets, Filipino owner names, real PH vaccine schedules (5-in-1, anti-rabies, kennel cough), ₱ currency.
