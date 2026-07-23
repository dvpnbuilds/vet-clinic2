# Rules
1. One phase at a time. Never start phase N+1 until phase N is audited-pass in PROGRESS.md.
2. Update PROGRESS.md at the end of every session (status + notes).
3. No new dependencies without noting them in the decision log.
4. PLAN.md is immutable after approval; scope changes go through DV and get logged in PROGRESS.md.
5. Write tests for each phase's completion criteria before marking it built — especially the phase-2 double-booking tests.
6. All AI calls go through /ai/openrouter.js. All prompts live in /ai/prompts.js. No OpenRouter fetches anywhere else.
7. All SMS/email go through notify() in /notify/index.js. Never call Semaphore or Resend directly elsewhere.
8. All DB access goes through /db/client.js. No stray libSQL clients.
9. Keep Turso queries portable SQLite — no libSQL-only features that block a swap back to file-SQLite.
10. Clinic-specific text/branding/services/hours/language ALWAYS come from the clinic profile. Hardcoded clinic strings are a bug.
11. The Western profile must never leak Taglish particles; the PH profile must handle Taglish naturally.
12. DRY_RUN defaults ON. Tests never send real SMS/email. Never hardcode API keys — env only.
13. The cron route must be idempotent: due-and-unsent only, safe to call repeatedly. Never depend on exact firing time.
14. Tokenized owner links (confirm/reschedule) are unguessable and single-purpose. No pet-owner accounts in v1.
15. Never crash the demo mid-pitch — routes return {error} JSON with a proper status, never throw uncaught.
16. Vercel is stateless: no in-memory scheduling, sessions, or slot caches. Persist everything to Turso.
