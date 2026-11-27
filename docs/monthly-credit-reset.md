# Monthly free-recipe reset

The site promises "3 receitas grátis por mês". Until now that was a script someone had to run by hand
(`scripts/reset-recipe-counts.js` in the web repo), last run on 2026-03-14, so most free accounts got their 3
recipes once and never again.

## What runs

Every day at 06:00 (America/Sao_Paulo), Cloud Scheduler calls `POST /jobs/reset-free-credits` on this service.
For every free account (`plan.planId == 1`) whose last reset was 30 or more days ago:

- `plan.recipeCount` becomes 3. If the account has more than 3 (the survey bonus), it keeps them.
- `plan.updatedAt` becomes now. It marks the last reset, so the next one comes 30 days later.
  (Signup and plan changes also set it. `plan.startedAt` is the fallback when it's missing.)

There's an hour of slack on the 30 days, so a daily run at the same time doesn't slip a day each month.

- **Paid plans** aren't touched. The Stripe `invoice.paid` webhook refills them each billing period.
- **A recipe made between the read and the write** makes Firestore refuse the write. The account is reset on
  the next run instead.
- **Running the job twice** is harmless: accounts reset the first time aren't due again.

Code: `src/credits/monthlyReset.ts` (the rules), `src/credits/firestoreCreditsStore.ts` (Firestore),
`src/jobs/jobs.route.ts` (the endpoint). Tests: `npm test`, and `npm run test:emulator` for the Firestore part.

## Who can call it

The service is public, because the web app calls it. The job route checks for a Google-signed OIDC token with:

- audience `https://server-my-recipe-app-315650529779.us-central1.run.app/jobs/reset-free-credits`
- email `credits-reset@recipe-app-1bbdc.iam.gserviceaccount.com`

Anything else gets 401 or 403. The service account needs no roles; Cloud Scheduler only uses it to sign the token.
The env vars `RESET_JOB_AUDIENCE` and `RESET_JOB_INVOKER` override both values.

## One-time setup

```bash
gcloud services enable cloudscheduler.googleapis.com --project recipe-app-1bbdc

gcloud iam service-accounts create credits-reset --project recipe-app-1bbdc \
  --display-name "Cloud Scheduler: monthly free-recipe reset"

gcloud scheduler jobs create http reset-free-credits --project recipe-app-1bbdc --location us-central1 \
  --schedule "0 6 * * *" --time-zone "America/Sao_Paulo" \
  --http-method POST --attempt-deadline 300s \
  --uri "https://server-my-recipe-app-315650529779.us-central1.run.app/jobs/reset-free-credits" \
  --oidc-service-account-email credits-reset@recipe-app-1bbdc.iam.gserviceaccount.com \
  --oidc-token-audience "https://server-my-recipe-app-315650529779.us-central1.run.app/jobs/reset-free-credits"
```

## Day to day

Dry run (counts, writes nothing): point the job at `...?dryRun=1`, run it, then point it back.

```bash
gcloud scheduler jobs update http reset-free-credits --project recipe-app-1bbdc --location us-central1 \
  --uri "https://server-my-recipe-app-315650529779.us-central1.run.app/jobs/reset-free-credits?dryRun=1"
gcloud scheduler jobs run reset-free-credits --project recipe-app-1bbdc --location us-central1
```

The same `?dryRun=1` works on a tagged revision's URL before it gets traffic. The audience stays the same.

Each run logs one line with its counts:

```bash
gcloud logging read --project recipe-app-1bbdc --freshness 2d \
  'resource.labels.service_name="server-my-recipe-app" AND textPayload:"[credits-reset]"' \
  --format 'value(timestamp,textPayload)'
```

- `due`: accounts reset this run.
- `raised`: accounts that had fewer than 3.
- `kept`: accounts that already had 3 or more; only their date moved.
- `changed`: accounts skipped because they changed during the run.
- `failed`: writes that errored. Those accounts are retried the next day.

Pause or resume:

```bash
gcloud scheduler jobs pause reset-free-credits --project recipe-app-1bbdc --location us-central1
gcloud scheduler jobs resume reset-free-credits --project recipe-app-1bbdc --location us-central1
```

Don't use the old `scripts/reset-recipe-counts.js` any more. It also reset paid plans, which `invoice.paid`
now handles, and it cut survey bonuses back to 3.
