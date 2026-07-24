# Progress

Current phase: 6 (P1/P2 remediation built; independent re-audit required)

Final audit: 2026-07-24 — NO-GO. The independent source audit found P1 issues in staff authorization, dashboard stored XSS, and reminder delivery recovery, plus P2 validation, rate-limit, and profile-isolation issues. The P1/P2 remediation is now implemented locally and 30 automated tests pass, but a fresh independent audit is required before release.

P1 remediation: 2026-07-24 — Staff-only APIs now require a distinct STAFF_PASSCODE; dashboard records render with text nodes; and reminder delivery attempts are persisted before provider calls so ambiguous outcomes are held for reconciliation rather than resent automatically.

P2 remediation: 2026-07-24 — Booking, slot, calendar, and block-off inputs are validated server-side with safe 400 responses; rate limits prefer Vercel's verified client-IP header and never select a forwarded-chain entry; and seed fixtures are profile-owned and excluded from public profile responses. Local verification: npm test (30 passing), JavaScript syntax checks, git diff --check, and npm audit --omit=dev --audit-level=high.

Phase 1 delivery: built on 2026-07-23; audit deferred by user instruction until all planned phases are complete. Local verification: npm test (3 passing) and npm run seed against a temporary libSQL database.

Phase 2 delivery: built on 2026-07-23; audit deferred by user instruction until all planned phases are complete. Implemented service-specific, time-zone-aware slots from persisted vet hours and capacity; durable 10-minute reservation slices and write transactions for double-book prevention; block-offs; and protected slot, booking, block-off, and day/week calendar APIs. Local verification: npm test (6 passing), including concurrent booking attempts.

Phase 3 delivery: built on 2026-07-23; audit deferred by user instruction until all planned phases are complete. Added a mobile-first, clinic-profile-driven funnel with demo-code entry, services, live slots, owner/pet details, conflict recovery, and a thank-you state. It writes through the Phase 2 booking API. Local verification: node syntax checks and npm test (7 passing), including HTTP booking-to-calendar flow. Browser visual QA is deferred to deployment because the available browser surface blocks this local URL.

Phase 4 delivery: built on 2026-07-23; audit deferred by user instruction until all planned phases are complete. Added a DRY_RUN-default notification module for Semaphore and Resend, durable due-and-unsent reminder processing with atomic claims and retry recovery, Taglish/English profile templates, vaccine and no-show campaigns, public single-purpose confirm/reschedule links, an unconfirmed appointment read API, and n8n trigger documentation. Local verification: npm test (12 passing), including repeated cron calls and HTTP cron authorization.

Phase 5 delivery: built on 2026-07-23; audit deferred by user instruction until all planned phases are complete. Added the single OpenRouter gateway, profile-grounded prompts and FAQs, controlled slot lookup/booking tools that use the Phase 2 engine, and a mobile Messenger-style chat UI. Local verification: npm test (15 passing), covering Taglish, FAQ prompt grounding, a real chat booking, and duplicate-booking refusal.

Phase 6 delivery: built on 2026-07-23; audit deferred by user instruction until all planned phases are complete. Added a profile-driven staff dashboard with today’s calendar, unconfirmed visits, vaccines due, and reminder-attributed recovered revenue. Demo-code entry is provided for the dashboard alongside the existing public surfaces. Local verification: npm test (18 passing), including dashboard data, recovered revenue, and Western English no-Taglish checks.

## Phase 1: Foundation — pending
Notes: 2026-07-23 — Initial setup in progress: Node/Express, Turso client/schema/seed, PH and Western profiles, demo access guard, rate limiting, and protected health route. Added Express and @libsql/client; installation and verification remain.
Audit: 2026-07-23 — FAIL. Local seed, schema coverage, authenticated health route, profiles, and two access tests pass. Before Phase 1 can be marked built: replace the instance-local rate-limit Map with durable/shared protection suitable for Vercel; validate Vercel routing with vercel dev; add automated coverage for rate limiting and seed/schema output.

## Phase 2: Scheduling engine — pending
Notes:
Audit:

## Phase 3: Booking funnel — pending
Notes:
Audit:

## Phase 4: Reminder automation — pending
Notes:
Audit:

## Phase 5: AI receptionist — pending
Notes:
Audit:

## Phase 6: Dashboard + polish — pending
Notes:
Audit:

## Decision log
- 2026-07-24: P2 remediation adds strict boundary validation, Vercel-safe IP selection, and profile-owned seed fixtures; public profile payloads exclude all server-only seed data.
- 2026-07-24: P1 remediation separates public DEMO_PASSCODE access from staff-only STAFF_PASSCODE access; it does not create pet-owner accounts or in-memory sessions.
- 2026-07-24: Reminder delivery is conservatively at-most-once after a provider call begins. Ambiguous provider/database outcomes are retained for reconciliation instead of retried automatically, preventing duplicate SMS/email charges.
- 2026-07-23: Final audit conditional pass after moving pre-access copy into clinic profiles and replacing Express-only request header calls with Vercel-safe helpers.
- 2026-07-23: Recovered revenue is an attribution metric: the sum of confirmed appointments with at least one sent appointment reminder, not a claim of payment collection.
- 2026-07-23: Phase 6 was built without an audit at user direction; audit is deferred until all planned phases are complete.
- 2026-07-23: AI tool calls are limited to find_slots and book_appointment, both implemented through the existing scheduling engine; the model never writes directly to the database.
- 2026-07-23: Phase 5 was built without an audit at user direction; audit is deferred until all planned phases are complete.
- 2026-07-23: Reminder records use durable dedupe keys plus short-lived processing claims so late or repeated cron ticks self-heal without duplicate delivery.
- 2026-07-23: Phase 4 was built without an audit at user direction; audit is deferred until all planned phases are complete.
- 2026-07-23: Added profile-owned booking copy for PH Taglish and Western English so public funnel language, branding, services, and labels are never hardcoded in the frontend.
- 2026-07-23: Phase 3 was built without an audit at user direction; audit is deferred until all planned phases are complete.
- 2026-07-23: Phase 2 uses durable 10-minute per-vet capacity reservations with a unique database constraint, allowing one booking transaction to win and rejecting concurrent overlap attempts safely.
- 2026-07-23: Phase 2 was built without an audit at user direction; audit is deferred until all planned phases are complete.
- 2026-07-23: User directed that phase audits occur after all phases, overriding the normal audit gate between phases.
- 2026-07-23: Rate limiting now uses a Turso-backed atomic counter rather than instance memory, so the public-demo protection works across Vercel instances.
- 2026-07-23: Phase 1 audit failed pending durable Vercel-safe rate limiting, Vercel dev validation, and broader foundation test coverage.
- 2026-07-23: Added Express 5 and @libsql/client as the Phase 1 runtime dependencies.
- 2026-07-23: Standalone product, not an evolution of the old vet-clinic-assistant demo.
- 2026-07-23: Deploy on Vercel (Hobby). Rules out file-SQLite + node-cron.
- 2026-07-23: Database = Turso (libSQL) — free, no pausing, SQLite-compatible. Chosen over Supabase to avoid Postgres migration and the 7-day pause.
- 2026-07-23: Cron = n8n Schedule node on DV's VPS, POST to /api/cron/reminders. Trigger only; reminder logic stays in the app. GitHub Actions is the fallback trigger.
- 2026-07-23: Reminders designed as "windows not stopwatches" — cron route sends due-and-unsent, so late/skipped ticks self-heal.
- 2026-07-23: v1 spice = vaccine reminders, no-show reducer, AI receptionist, ₱-recovered metric. QR intake, review requests, pet card moved to v2 (see V2.md).
- 2026-07-23: Channels for v1 = SMS (Semaphore) + email (Resend). Viber/Messenger deferred.
