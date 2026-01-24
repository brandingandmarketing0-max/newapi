# Daily Metrics Database Setup

## Required Database Changes

To enable daily growth tracking for all metrics (followers, following, media, clips), you need to run a migration to add new columns to the `ig_profile_daily_metrics` table.

### Migration SQL

Run this SQL in your Supabase SQL Editor:

```sql
-- Add columns for following, media, and clips tracking in daily metrics
ALTER TABLE ig_profile_daily_metrics 
  ADD COLUMN IF NOT EXISTS following_open INTEGER,
  ADD COLUMN IF NOT EXISTS following_close INTEGER,
  ADD COLUMN IF NOT EXISTS following_delta INTEGER,
  ADD COLUMN IF NOT EXISTS media_open INTEGER,
  ADD COLUMN IF NOT EXISTS media_close INTEGER,
  ADD COLUMN IF NOT EXISTS media_delta INTEGER,
  ADD COLUMN IF NOT EXISTS posts_delta INTEGER, -- Alias for media_delta (for backwards compatibility)
  ADD COLUMN IF NOT EXISTS clips_open INTEGER,
  ADD COLUMN IF NOT EXISTS clips_close INTEGER,
  ADD COLUMN IF NOT EXISTS clips_delta INTEGER;

-- Add comments to explain the columns
COMMENT ON COLUMN ig_profile_daily_metrics.following_open IS 'Following count at start of day';
COMMENT ON COLUMN ig_profile_daily_metrics.following_close IS 'Following count at end of day';
COMMENT ON COLUMN ig_profile_daily_metrics.following_delta IS 'Change in following count for this day';
COMMENT ON COLUMN ig_profile_daily_metrics.media_open IS 'Media count at start of day';
COMMENT ON COLUMN ig_profile_daily_metrics.media_close IS 'Media count at end of day';
COMMENT ON COLUMN ig_profile_daily_metrics.media_delta IS 'Change in media count for this day';
COMMENT ON COLUMN ig_profile_daily_metrics.posts_delta IS 'Alias for media_delta (same value)';
COMMENT ON COLUMN ig_profile_daily_metrics.clips_open IS 'Clips count at start of day';
COMMENT ON COLUMN ig_profile_daily_metrics.clips_close IS 'Clips count at end of day';
COMMENT ON COLUMN ig_profile_daily_metrics.clips_delta IS 'Change in clips count for this day';
```

### Steps to Apply

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Paste the migration SQL above
4. Click **Run** to execute
5. Verify the columns were added (check Table Editor → `ig_profile_daily_metrics`)

### What This Enables

After running this migration, the daily metrics system will:
- ✅ Track **followers** growth daily (already working)
- ✅ Track **following** growth daily (NEW)
- ✅ Track **media/posts** growth daily (NEW)
- ✅ Track **clips** growth daily (NEW)
- ✅ Store open/close values for all metrics
- ✅ Calculate daily deltas for all metrics

### Testing

After applying the migration:

1. **Restart your API server** (to load the updated service)
2. **Call the manual update endpoint** to backfill today's data:
   ```bash
   curl -X POST http://localhost:3001/daily-metrics/update
   ```
3. **Check your dashboard** - the graph should now show data

### Automatic Updates

The daily metrics will be automatically updated:
- **During profile tracking** - When you manually refresh a profile
- **Via cron job** - Runs daily at 2:15 AM IST and updates all profiles
- **Via manual endpoint** - `POST /daily-metrics/update` can be called anytime

### Current Table Structure

After migration, `ig_profile_daily_metrics` will have:

| Column | Type | Description |
|--------|------|-------------|
| profile_id | UUID | Profile reference |
| date | DATE | Date (YYYY-MM-DD) |
| followers_open | INTEGER | Followers at start of day |
| followers_close | INTEGER | Followers at end of day |
| followers_delta | INTEGER | Daily followers growth |
| following_open | INTEGER | Following at start of day |
| following_close | INTEGER | Following at end of day |
| following_delta | INTEGER | Daily following change |
| media_open | INTEGER | Media count at start of day |
| media_close | INTEGER | Media count at end of day |
| media_delta | INTEGER | Daily media growth |
| posts_delta | INTEGER | Alias for media_delta |
| clips_open | INTEGER | Clips count at start of day |
| clips_close | INTEGER | Clips count at end of day |
| clips_delta | INTEGER | Daily clips growth |
| created_at | TIMESTAMPTZ | Row creation timestamp |

**Primary Key:** `(profile_id, date)` - one row per profile per day














