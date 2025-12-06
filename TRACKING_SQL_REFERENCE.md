# Complete SQL Reference for Instagram Tracking System

This document contains all SQL operations used in the tracking system from `src-backup`.

## Table Schema

### 1. Profiles Table (`ig_profiles`)
```sql
CREATE TABLE IF NOT EXISTS ig_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_id TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  profile_picture TEXT,
  user_id UUID,
  poll_interval_minutes INTEGER DEFAULT 60,
  last_snapshot_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_tracking_id ON ig_profiles(tracking_id);
```

### 2. Profile Snapshots Table (`ig_profile_snapshots`)
```sql
CREATE TABLE IF NOT EXISTS ig_profile_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES ig_profiles(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  followers INTEGER,
  following INTEGER,
  media_count INTEGER,
  clips_count INTEGER,
  biography TEXT,
  avatar_url TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_profile_captured 
  ON ig_profile_snapshots(profile_id, captured_at DESC);
```

### 3. Profile Deltas Table (`ig_profile_deltas`)
```sql
CREATE TABLE IF NOT EXISTS ig_profile_deltas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES ig_profiles(id) ON DELETE CASCADE,
  base_snapshot_id UUID REFERENCES ig_profile_snapshots(id) ON DELETE SET NULL,
  compare_snapshot_id UUID REFERENCES ig_profile_snapshots(id) ON DELETE SET NULL,
  followers_diff INTEGER,
  following_diff INTEGER,
  media_diff INTEGER,
  clips_diff INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deltas_profile_created 
  ON ig_profile_deltas(profile_id, created_at DESC);
```

### 4. Daily Metrics Table (`ig_profile_daily_metrics`)
```sql
CREATE TABLE IF NOT EXISTS ig_profile_daily_metrics (
  profile_id UUID REFERENCES ig_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  followers_open INTEGER,
  followers_close INTEGER,
  followers_delta INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, date)
);
```

### 5. Reels Table (`ig_profile_reels`)
```sql
CREATE TABLE IF NOT EXISTS ig_profile_reels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES ig_profiles(id) ON DELETE CASCADE,
  shortcode TEXT NOT NULL,
  caption TEXT,
  taken_at TIMESTAMPTZ,
  is_video BOOLEAN,
  video_url TEXT,
  r2_video_url TEXT,
  duration FLOAT,
  average_watch_time FLOAT,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  display_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, shortcode)
);

CREATE INDEX IF NOT EXISTS idx_reels_profile_taken 
  ON ig_profile_reels(profile_id, taken_at DESC);
```

### 6. Reel Metrics Table (`ig_reel_metrics`)
```sql
CREATE TABLE IF NOT EXISTS ig_reel_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reel_id UUID REFERENCES ig_profile_reels(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reel_metrics_reel_captured 
  ON ig_reel_metrics(reel_id, captured_at DESC);
```

---

## SQL Operations by Function

### Profile Operations

#### Check if profile exists by username
```sql
SELECT * 
FROM ig_profiles 
WHERE username = $1 
LIMIT 1;
```

#### Check if profile exists by tracking_id
```sql
SELECT * 
FROM ig_profiles 
WHERE tracking_id = $1 
LIMIT 1;
```

#### Check if profile exists by username and user_id
```sql
SELECT * 
FROM ig_profiles 
WHERE username = $1 
  AND user_id = $2 
LIMIT 1;
```

#### Insert new profile
```sql
INSERT INTO ig_profiles (
  username, 
  full_name, 
  avatar_url, 
  profile_picture, 
  tracking_id, 
  user_id, 
  last_snapshot_id,
  updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, NOW()
) 
RETURNING *;
```

#### Update profile by ID
```sql
UPDATE ig_profiles 
SET 
  username = $1,
  full_name = $2,
  avatar_url = $3,
  profile_picture = $4,
  tracking_id = $5,
  user_id = $6,
  last_snapshot_id = $7,
  updated_at = NOW()
WHERE id = $8
RETURNING *;
```

#### Update profile by tracking_id
```sql
UPDATE ig_profiles 
SET 
  username = $1,
  full_name = $2,
  avatar_url = $3,
  profile_picture = $4,
  updated_at = NOW()
WHERE tracking_id = $5
RETURNING *;
```

#### Update profile's last_snapshot_id
```sql
UPDATE ig_profiles 
SET last_snapshot_id = $1 
WHERE id = $2;
```

#### Upsert profile (on conflict username)
```sql
INSERT INTO ig_profiles (
  username, 
  full_name, 
  avatar_url, 
  profile_picture, 
  tracking_id, 
  user_id
) VALUES (
  $1, $2, $3, $4, $5, $6
)
ON CONFLICT (username) 
DO UPDATE SET
  full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url,
  profile_picture = EXCLUDED.profile_picture,
  tracking_id = EXCLUDED.tracking_id,
  user_id = EXCLUDED.user_id,
  updated_at = NOW()
RETURNING *;
```

#### Get all profiles
```sql
SELECT * 
FROM ig_profiles 
ORDER BY created_at DESC;
```

#### Get profile by username
```sql
SELECT * 
FROM ig_profiles 
WHERE username = $1;
```

#### Get profile by tracking_id
```sql
SELECT * 
FROM ig_profiles 
WHERE tracking_id = $1;
```

#### Delete profile by tracking_id and user_id
```sql
DELETE FROM ig_profiles 
WHERE tracking_id = $1 
  AND user_id = $2
RETURNING *;
```

---

### Snapshot Operations

#### Get latest snapshots for profile (last 2)
```sql
SELECT * 
FROM ig_profile_snapshots 
WHERE profile_id = $1 
ORDER BY captured_at DESC 
LIMIT 2;
```

#### Get latest snapshot for profile
```sql
SELECT * 
FROM ig_profile_snapshots 
WHERE profile_id = $1 
ORDER BY captured_at DESC 
LIMIT 1;
```

#### Get snapshots from tracking session start
```sql
SELECT * 
FROM ig_profile_snapshots 
WHERE profile_id = $1 
  AND captured_at >= $2
ORDER BY captured_at DESC;
```

#### Insert new snapshot
```sql
INSERT INTO ig_profile_snapshots (
  profile_id,
  followers,
  following,
  media_count,
  clips_count,
  biography,
  avatar_url,
  raw_json
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;
```

#### Get first snapshot (baseline)
```sql
SELECT * 
FROM ig_profile_snapshots 
WHERE profile_id = $1 
ORDER BY captured_at ASC 
LIMIT 1;
```

#### Get latest snapshot for analytics
```sql
SELECT followers, captured_at 
FROM ig_profile_snapshots 
WHERE profile_id = $1 
ORDER BY captured_at DESC 
LIMIT 1;
```

---

### Delta Operations

#### Get latest delta for profile
```sql
SELECT * 
FROM ig_profile_deltas 
WHERE profile_id = $1 
ORDER BY created_at DESC 
LIMIT 1;
```

#### Get deltas from tracking session start
```sql
SELECT * 
FROM ig_profile_deltas 
WHERE profile_id = $1 
  AND created_at >= $2
ORDER BY created_at DESC 
LIMIT 1;
```

#### Insert new delta
```sql
INSERT INTO ig_profile_deltas (
  profile_id,
  base_snapshot_id,
  compare_snapshot_id,
  followers_diff,
  following_diff,
  media_diff,
  clips_diff
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;
```

---

### Daily Metrics Operations

#### Get daily metrics for specific date
```sql
SELECT * 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
  AND date = $2
LIMIT 1;
```

#### Get daily metrics from tracking session start
```sql
SELECT * 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
  AND date >= $2
ORDER BY date DESC;
```

#### Get most recent daily metrics
```sql
SELECT * 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
ORDER BY date DESC 
LIMIT 1;
```

#### Get yesterday's daily metrics
```sql
SELECT followers_close 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
  AND date = $2
LIMIT 1;
```

#### Get daily metrics for date range
```sql
SELECT * 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
  AND date >= $2 
  AND date <= $3
ORDER BY date ASC;
```

#### Get daily metrics for last N days
```sql
SELECT * 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
  AND date >= $2
ORDER BY date ASC;
```

#### Insert new daily metrics
```sql
INSERT INTO ig_profile_daily_metrics (
  profile_id,
  date,
  followers_open,
  followers_close,
  followers_delta
) VALUES (
  $1, $2, $3, $4, $5
)
RETURNING *;
```

#### Update daily metrics for today
```sql
UPDATE ig_profile_daily_metrics 
SET 
  followers_close = $1,
  followers_delta = $2
WHERE profile_id = $3 
  AND date = $4;
```

#### Get available dates with daily metrics
```sql
SELECT date, followers_delta 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
ORDER BY date DESC;
```

#### Get follower growth in last 30 days
```sql
SELECT followers_delta, date 
FROM ig_profile_daily_metrics 
WHERE profile_id = $1 
  AND date >= $2
ORDER BY date ASC;
```

---

### Reel Operations

#### Get reels for profile (paginated)
```sql
SELECT * 
FROM ig_profile_reels 
WHERE profile_id = $1 
  AND is_video = true
ORDER BY taken_at DESC 
LIMIT $2 OFFSET $3;
```

#### Get all reels for profile
```sql
SELECT * 
FROM ig_profile_reels 
WHERE profile_id = $1 
ORDER BY taken_at DESC;
```

#### Get reel by shortcode
```sql
SELECT * 
FROM ig_profile_reels 
WHERE profile_id = $1 
  AND shortcode = $2
LIMIT 1;
```

#### Get reels for analytics
```sql
SELECT view_count, taken_at 
FROM ig_profile_reels 
WHERE profile_id = $1;
```

#### Get reels posted in last 30 days
```sql
SELECT * 
FROM ig_profile_reels 
WHERE profile_id = $1 
  AND taken_at >= $2;
```

#### Upsert reel (on conflict profile_id, shortcode)
```sql
INSERT INTO ig_profile_reels (
  profile_id,
  shortcode,
  caption,
  taken_at,
  is_video,
  video_url,
  duration,
  average_watch_time,
  view_count,
  like_count,
  comment_count,
  display_url
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
)
ON CONFLICT (profile_id, shortcode) 
DO UPDATE SET
  caption = EXCLUDED.caption,
  taken_at = EXCLUDED.taken_at,
  is_video = EXCLUDED.is_video,
  video_url = EXCLUDED.video_url,
  duration = EXCLUDED.duration,
  average_watch_time = EXCLUDED.average_watch_time,
  view_count = EXCLUDED.view_count,
  like_count = EXCLUDED.like_count,
  comment_count = EXCLUDED.comment_count,
  display_url = EXCLUDED.display_url
RETURNING *;
```

#### Update reel R2 URL
```sql
UPDATE ig_profile_reels 
SET r2_video_url = $1 
WHERE profile_id = $2 
  AND shortcode = $3;
```

#### Get reel IDs for profile
```sql
SELECT id 
FROM ig_profile_reels 
WHERE profile_id = $1;
```

---

### Reel Metrics Operations

#### Get latest metrics for reel (last 2)
```sql
SELECT * 
FROM ig_reel_metrics 
WHERE reel_id = $1 
ORDER BY captured_at DESC 
LIMIT 2;
```

#### Get metrics from tracking session start
```sql
SELECT * 
FROM ig_reel_metrics 
WHERE reel_id = $1 
  AND captured_at >= $2
ORDER BY captured_at DESC 
LIMIT 2;
```

#### Get all metrics for reel
```sql
SELECT * 
FROM ig_reel_metrics 
WHERE reel_id = $1 
ORDER BY captured_at ASC;
```

#### Get metrics for multiple reels in date range
```sql
SELECT * 
FROM ig_reel_metrics 
WHERE reel_id = ANY($1::uuid[]) 
  AND captured_at >= $2
ORDER BY captured_at ASC;
```

#### Insert new reel metrics snapshot
```sql
INSERT INTO ig_reel_metrics (
  reel_id,
  view_count,
  like_count,
  comment_count
) VALUES (
  $1, $2, $3, $4
)
RETURNING *;
```

---

### Complex Queries (Analytics & Aggregations)

#### Get profile with latest snapshot and delta
```sql
SELECT 
  p.*,
  s.* as snapshot,
  d.* as delta
FROM ig_profiles p
LEFT JOIN LATERAL (
  SELECT * 
  FROM ig_profile_snapshots 
  WHERE profile_id = p.id 
  ORDER BY captured_at DESC 
  LIMIT 1
) s ON true
LEFT JOIN LATERAL (
  SELECT * 
  FROM ig_profile_deltas 
  WHERE profile_id = p.id 
  ORDER BY created_at DESC 
  LIMIT 1
) d ON true
ORDER BY p.created_at DESC;
```

#### Calculate total reel views
```sql
SELECT SUM(view_count) as total_views 
FROM ig_profile_reels 
WHERE profile_id = $1;
```

#### Calculate follower growth from first to latest snapshot
```sql
SELECT 
  (latest.followers - first.followers) as total_growth
FROM (
  SELECT followers 
  FROM ig_profile_snapshots 
  WHERE profile_id = $1 
  ORDER BY captured_at DESC 
  LIMIT 1
) latest,
(
  SELECT followers 
  FROM ig_profile_snapshots 
  WHERE profile_id = $1 
  ORDER BY captured_at ASC 
  LIMIT 1
) first;
```

#### Get daily growth breakdown with reel metrics
```sql
SELECT 
  dm.date,
  dm.followers_delta,
  COALESCE(SUM(rm.view_count), 0) as total_reel_views,
  COALESCE(SUM(rm.like_count), 0) as total_reel_likes,
  COALESCE(SUM(rm.comment_count), 0) as total_reel_comments
FROM ig_profile_daily_metrics dm
LEFT JOIN ig_profile_reels r ON r.profile_id = dm.profile_id
LEFT JOIN ig_reel_metrics rm ON rm.reel_id = r.id 
  AND DATE(rm.captured_at) = dm.date
WHERE dm.profile_id = $1 
  AND dm.date >= $2
GROUP BY dm.date, dm.followers_delta
ORDER BY dm.date ASC;
```

#### Calculate viewer-to-follower ratio
```sql
SELECT 
  CASE 
    WHEN s.followers > 0 
    THEN (SELECT SUM(view_count) FROM ig_profile_reels WHERE profile_id = $1)::FLOAT / s.followers
    ELSE 0
  END as viewer_to_follower_ratio
FROM (
  SELECT followers 
  FROM ig_profile_snapshots 
  WHERE profile_id = $1 
  ORDER BY captured_at DESC 
  LIMIT 1
) s;
```

#### Calculate reel conversion rate (followers per 1K views)
```sql
SELECT 
  CASE 
    WHEN total_views > 0 AND followers_gained > 0
    THEN (followers_gained::FLOAT / total_views) * 1000
    ELSE 0
  END as conversion_rate_per_1k
FROM (
  SELECT 
    (SELECT SUM(view_count) FROM ig_profile_reels WHERE profile_id = $1) as total_views,
    (
      SELECT (latest.followers - first.followers)
      FROM (
        SELECT followers FROM ig_profile_snapshots 
        WHERE profile_id = $1 ORDER BY captured_at DESC LIMIT 1
      ) latest,
      (
        SELECT followers FROM ig_profile_snapshots 
        WHERE profile_id = $1 ORDER BY captured_at ASC LIMIT 1
      ) first
    ) as followers_gained
) calc;
```

---

### Cron Job Queries

#### Get all usernames for daily tracking
```sql
SELECT username 
FROM ig_profiles;
```

---

## Notes

1. **Parameter Placeholders**: All `$1`, `$2`, etc. are PostgreSQL parameter placeholders. Replace with actual values when executing.

2. **Timestamps**: All timestamp operations use `TIMESTAMPTZ` (timestamp with timezone) for consistency.

3. **Cascading Deletes**: All foreign key relationships use `ON DELETE CASCADE` to automatically clean up related data.

4. **Indexes**: Indexes are created on frequently queried columns for performance:
   - `tracking_id` on profiles
   - `profile_id, captured_at` on snapshots
   - `profile_id, created_at` on deltas
   - `profile_id, taken_at` on reels
   - `reel_id, captured_at` on reel metrics

5. **Unique Constraints**: 
   - `username` is unique in `ig_profiles`
   - `tracking_id` is unique in `ig_profiles`
   - `(profile_id, shortcode)` is unique in `ig_profile_reels`
   - `(profile_id, date)` is unique in `ig_profile_daily_metrics`

6. **User-Specific Tracking**: When `user_id` is provided, the system supports multiple users tracking the same username with different `tracking_id` values.

