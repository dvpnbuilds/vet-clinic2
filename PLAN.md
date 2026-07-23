# VetFlow — Plan (approved 2026-07-23)

## Vision
A standalone booking-and-automation product for manual PH vet clinics. Pet owners hit a website funnel and book REAL calendar slots (vet hours, capacity, no double-booking). An AI receptionist answers FAQs and books in-chat against the same slots. Automated SMS + email reminders confirm appointments, chase no-shows, and pull lapsed vaccines back in — all Taglish-capable. A staff dashboard shows today's calendar, pending confirmations, vaccines due, and a ₱-recovered metric that quantifies the money the system earned back. One deployment per clinic in v1; multi-tenant SaaS is deferred.

## Core features (v1)
- Website booking funnel: landing → service picker → real slot calendar → confirmed → thank-you (mobile-first)
- Real scheduling engine: slots generated from vet hours, per-service duration, capacity, conflict prevention, staff calendar (day/week), block-off times
- Automated reminders (SMS + email): confirm + 24h/2h reminders, vaccine-due campaigns, Taglish templates
- No-show reducer: tokenized confirm/reschedule link in every reminder; unconfirmed flagged on dashboard
- AI receptionist chat: FAQs + in-chat booking against the real slot API
- Staff dashboard: today's calendar, pending confirmations, vaccines due, ₱-recovered metric
- Clinic profile config: branding, services, hours, language, currency per clinic

## Deferred (not v1) — see V2.md for full detail
- QR walk-in intake — kills the paper logbook; adds onboarding surface
- Post-visit review requests — Google review funnel with rating gate
- Owner pet card / vaccine history — tokenized mobile pet passport
- Extra channels: Viber + Messenger — needs per-clinic Meta/Viber business setup
- Payments / booking deposits — GCash/Maya via PayMongo to further cut no-shows
- Multi-clinic SaaS admin — tenant model, signup, billing, admin console
- Analytics deepening — no-show trend, busiest slots, reminder→confirm conversion

## Stack
- Node.js 20 + Express as Vercel serverless functions — proven, fastest path, "deployed on Vercel" pitch
- Turso (libSQL) — free, no pausing, SQLite-compatible so queries stay portable
- n8n Schedule node on DV's VPS → POST /api/cron/reminders — always-on, punctual, already owned; trigger only, logic stays in the app (GitHub Actions is the drop-in fallback)
- Semaphore (SMS) + Resend (email) behind one notify() module — channels swappable
- OpenRouter for AI — cheapest model that handles Taglish; swappable in one line
- Vanilla JS frontend, no build step

## Phases
### Phase 1: Foundation
- Scope: Express app + Vercel config, Turso client, schema (clinics, services, vets, vet_hours, slots, appointments, owners, pets, reminders), clinic profiles, seed script with PH demo data, DEMO_PASSCODE middleware + per-IP rate limit.
- Done when: `npm run seed` populates Turso; server boots on Vercel dev; a health route returns the active clinic profile; passcode middleware blocks unauthenticated requests; schema covers every v1 entity.

### Phase 2: Scheduling engine
- Scope: slot generation from vet_hours + per-service duration + capacity; booking API with conflict/double-booking prevention; block-off times; staff calendar read API (day/week).
- Done when: automated tests prove no double-booking under concurrent requests, slots respect vet hours/capacity, block-offs remove slots, and booking a slot marks it unavailable.

### Phase 3: Booking funnel
- Scope: public pages landing → service → calendar → confirm → thank-you, mobile-first, driven entirely by clinic profile; writes real appointments via the phase-2 API.
- Done when: an owner can complete a booking end-to-end on mobile viewport, the appointment appears in the DB and staff calendar, and all clinic text comes from the profile (no hardcoded strings).

### Phase 4: Reminder automation
- Scope: notify() module (Semaphore + Resend + DRY_RUN), /api/cron/reminders route (due-and-unsent logic), 24h/2h + vaccine-due campaigns, tokenized confirm/reschedule links, no-show flags, Taglish templates, n8n schedule doc.
- Done when: hitting /api/cron/reminders sends exactly the due-and-unsent reminders (DRY_RUN logs them), re-hitting it sends nothing (idempotent), confirm/reschedule links update appointment status without login, and unconfirmed appointments show as flagged.

### Phase 5: AI receptionist
- Scope: Messenger-style chat UI + chat API through /ai/openrouter.js; FAQ answers from profile; booking tool-call that reserves real slots via the phase-2 API; Taglish handling.
- Done when: the bot answers profile FAQs, completes a booking through chat that lands a real appointment, refuses to double-book, and handles a Taglish message correctly in a test.

### Phase 6: Dashboard + polish
- Scope: staff dashboard (today's calendar, pending confirmations, vaccines due, ₱-recovered metric), demo passcode UX, seed polish, both clinic profiles verified (PH Taglish + Western English with no Taglish leak).
- Done when: dashboard renders live data for the seeded clinic, ₱-recovered metric computes from reminder/appointment data, and switching profiles changes all branding/language with no leakage.

## Risks / open decisions
- Slot logic is the hard part — phase 2 must have real concurrency/double-booking tests, not happy-path only.
- SMS costs money even in demos — DRY_RUN must default ON; never send from tests.
- n8n on the VPS is a single point of failure — keep the cron route standalone so GitHub Actions can replace the trigger in minutes.
- Vercel serverless is stateless — no in-memory scheduling or session state; everything persists to Turso.
- Tokenized links have no auth — tokens must be unguessable and single-purpose (confirm vs reschedule).
