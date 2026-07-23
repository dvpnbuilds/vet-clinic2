# n8n reminder trigger

Create an n8n workflow with a Schedule Trigger (every 5–15 minutes) followed by an HTTP Request node.

- Method: POST
- URL: https://YOUR_APP_DOMAIN/api/cron/reminders
- Header: x-cron-secret with your CRON_SECRET value
- Response: JSON

The application decides what is due. The schedule is deliberately a window, not a stopwatch: each request creates missing reminder records, claims only due-and-unsent reminders, and safely retries abandoned claims on a later run.

Set DRY_RUN=true while demoing. Change it to false only after configuring SEMAPHORE_API_KEY, RESEND_API_KEY, and RESEND_FROM_EMAIL.
