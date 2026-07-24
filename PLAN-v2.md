# VetFlow — Plan v2 (approved 2026-07-24)

## Vision
v2 turns VetFlow from "booking + reminders" into a fuller demo showcase that tells a clinic "this runs your whole front desk." It adds a QR walk-in intake that kills the paper logbook, automated post-visit review requests that grow the clinic's Google rating, a tokenized owner pet card, deeper dashboard analytics, and lightweight invoicing/records so the money side is visible — all still single-clinic-per-deployment. No multi-tenant, no payment gateway; this version is about breadth of pitch, not infrastructure.

## Core features (v2)
- QR walk-in intake — front-desk QR → mobile intake form → walk-in record + captured phone
- Post-visit review requests — auto SMS/email after a completed visit, rating gate (4-5 star to Google, 1-3 to private form)
- Owner pet card — tokenized no-login mobile pet passport (profile, vaccine history, due, past visits)
- Analytics deepening — no-show trend, busiest slots/services, reminder->confirm conversion, vaccine-campaign recovery
- Invoicing & records — itemized invoice/receipt per visit, manual paid/unpaid, printable receipt, revenue + outstanding on dashboard

## Deferred (not v2) — still in V2.md backlog
- Real payments / deposits (PayMongo, GCash/Maya) — deferred; v2 ships invoicing/records instead, no gateway
- Viber + Messenger channels — needs per-clinic Meta/Viber business onboarding
- Multi-clinic SaaS admin — dropped from roadmap for now; this is a demo showcase, one deploy per clinic

## Stack
No change from v1: Node 20 + Express on Vercel, Turso (libSQL), n8n cron trigger, Semaphore + Resend behind notify(), OpenRouter. New tables added (walk_ins, reviews, invoices, invoice_items) via the existing schema/seed flow. No new external services in v2.

## Phases
### Phase 7: QR walk-in intake
- Scope: printable QR per clinic pointing at a mobile intake form (owner name, pet name/species/breed, reason, phone); submission writes an owner + walk-in appointment record; "walk-ins today" queue on the dashboard.
- Done when: scanning the QR opens the profile-branded form, submitting creates a real walk-in appointment with a captured phone number, and it appears in the dashboard queue. Clinic-scoped (carries clinic_id).

### Phase 8: Post-visit review requests
- Scope: when an appointment is marked complete, queue a review message X hours later via notify(); rating gate — 4-5 stars route to the clinic's Google review URL (from profile), 1-3 stars route to a private feedback form stored in DB.
- Done when: completing an appointment queues exactly one review message (DRY_RUN logs it), the gate routes high vs low ratings correctly, and low-rating feedback is saved and shown to staff. Idempotent — re-running the cron does not double-send.

### Phase 9: Owner pet card
- Scope: tokenized, no-login mobile pet card per pet — profile, full vaccine history with dates, what's due next, past visits; reuses the tokenized-link pattern from v1 reminders.
- Done when: a valid per-pet token opens a correct read-only card, an invalid/expired token is rejected, and all text comes from the clinic profile. No pet-owner accounts.

### Phase 10: Analytics deepening
- Scope: dashboard metrics — no-show rate over time, busiest slots/services, reminder->confirmation conversion, vaccine-campaign recovery rate; computed from existing appointment/reminder data.
- Done when: each metric renders from real seeded data and every figure is verified against a manual/SQL count in a test. No metric is hardcoded or faked.

### Phase 11: Invoicing & records
- Scope: generate an itemized invoice per appointment from the service catalog (services rendered + ₱ amounts from the profile), manual mark paid/unpaid, printable/tokenized receipt (reuse link pattern), and revenue + outstanding totals on the dashboard. No payment gateway, no real charges.
- Done when: completing an appointment can generate an itemized invoice with correct totals, paid/unpaid toggles and persists, a printable receipt renders correctly, and dashboard revenue/outstanding reconcile with the invoice records in a test.

## Risks / open decisions
- Every v2 feature must be built clinic_id-scoped from day one, so a future multi-tenant version (if ever) layers on without reworking feature internals — even though multi-clinic is dropped for now.
- Review requests reuse the reminder cron — keep the same due-and-unsent/idempotent discipline; never double-send.
- Invoicing must never imply a real charge in the demo — label it clearly as a record, not a transaction.
- New tokenized links (pet card, receipt) need the same unguessable, single-purpose token rules as v1.

## Changes from v1
- Added: QR walk-in intake, post-visit review requests, owner pet card, deepened analytics, invoicing/records (phases 7-11).
- Deferred: real payments/deposits (PayMongo) — v2 ships invoicing/records instead.
- Dropped from roadmap: multi-clinic SaaS admin (demo showcase stays single-clinic-per-deployment); Viber/Messenger remain in the V2.md backlog.
- No fixes carried in — DV reports v1 tested clean, all phases audited-pass.
