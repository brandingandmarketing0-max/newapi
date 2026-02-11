# Update Daily Metrics Edge Function

This Supabase Edge Function updates daily metrics for all Instagram profiles by calculating the daily growth from snapshots.

## Setup

1. **Deploy the function to Supabase:**
   ```bash
   supabase functions deploy update-daily-metrics
   ```

2. **Set environment variables in Supabase Dashboard:**
   - Go to Project Settings → Edge Functions → Environment Variables
   - The function uses the default Supabase environment variables (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

## Schedule with Supabase Cron

Add this to your Supabase SQL Editor to run daily at 11:59 PM:

```sql
-- Schedule daily metrics update to run at 11:59 PM every day
SELECT cron.schedule(
  'update-daily-metrics',
  '59 23 * * *', -- 11:59 PM daily
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/update-daily-metrics',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

Or use Supabase Dashboard:
1. Go to Database → Cron Jobs
2. Create new cron job
3. Schedule: `59 23 * * *` (11:59 PM daily)
4. SQL:
```sql
SELECT
  net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/update-daily-metrics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
```

## Manual Trigger

You can also call it manually via HTTP:

```bash
curl -X POST \
  'https://YOUR_PROJECT_REF.supabase.co/functions/v1/update-daily-metrics' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json'
```

## What it does

1. Gets all profiles from `ig_profiles`
2. For each profile:
   - Finds the first snapshot of today (opening followers count)
   - Finds the last snapshot of today (closing followers count)
   - Calculates daily delta (close - open)
   - Creates or updates the daily metrics row for today

## Response

```json
{
  "date": "2025-01-16",
  "profiles": 12,
  "created": 5,
  "updated": 7,
  "errors": 0,
  "total": 12
}
```




















