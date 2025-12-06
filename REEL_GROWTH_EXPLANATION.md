# How Reel Growth is Calculated

## Quick Answer

**Growth is NOT stored in the database** - it's calculated on-the-fly by comparing:
- **Current values** from `ig_profile_reels` table
- **Previous values** from `ig_reel_metrics` table

---

## The Calculation Process

### Step 1: Get Current Values
**Table:** `ig_profile_reels`
**Columns:**
- `view_count` - Current view count (e.g., 57,659,532)
- `like_count` - Current like count (e.g., 2,104,461)
- `comment_count` - Current comment count (e.g., 14,368)

```sql
SELECT view_count, like_count, comment_count
FROM ig_profile_reels
WHERE profile_id = $1 AND shortcode = $2;
```

### Step 2: Get Previous Values
**Table:** `ig_reel_metrics`
**Columns:**
- `view_count` - Previous view count snapshot
- `like_count` - Previous like count snapshot
- `comment_count` - Previous comment count snapshot
- `captured_at` - When this snapshot was taken

```sql
SELECT view_count, like_count, comment_count, captured_at
FROM ig_reel_metrics
WHERE reel_id = $1
ORDER BY captured_at DESC
LIMIT 2;
```

The code uses `metrics[1]` (the second most recent snapshot) as the "previous" value to compare against.

### Step 3: Calculate Growth
```javascript
viewGrowth = currViews - prevViews;      // e.g., 57,659,532 - 57,517,015 = +142,517
likeGrowth = currLikes - prevLikes;      // e.g., 2,104,461 - 2,098,633 = +5,828
commentGrowth = currComments - prevComments; // e.g., 14,368 - 14,337 = +31
```

---

## Where Data is Stored

### 1. Current Metrics (Always Up-to-Date)
**Table:** `ig_profile_reels`
```sql
CREATE TABLE ig_profile_reels (
  id UUID PRIMARY KEY,
  profile_id UUID,
  shortcode TEXT,
  view_count INTEGER,      -- ← Current views (57,659,532)
  like_count INTEGER,      -- ← Current likes (2,104,461)
  comment_count INTEGER,    -- ← Current comments (14,368)
  ...
);
```

### 2. Historical Snapshots (For Growth Calculation)
**Table:** `ig_reel_metrics`
```sql
CREATE TABLE ig_reel_metrics (
  id UUID PRIMARY KEY,
  reel_id UUID REFERENCES ig_profile_reels(id),
  captured_at TIMESTAMPTZ,  -- When this snapshot was taken
  view_count INTEGER,        -- ← Snapshot of views at this time
  like_count INTEGER,        -- ← Snapshot of likes at this time
  comment_count INTEGER,     -- ← Snapshot of comments at this time
  created_at TIMESTAMPTZ
);
```

**Important:** Every time a profile is refreshed, a new snapshot is saved to `ig_reel_metrics`:
```sql
INSERT INTO ig_reel_metrics (reel_id, view_count, like_count, comment_count)
VALUES ($1, $2, $3, $4);
```

---

## Code Location

### Where Growth is Calculated
**File:** `src-backup/routes/profiles.js`
**Function:** `GET /profiles/:username/reels` (lines 598-806)

```javascript
// Get metric snapshots for THIS specific reel
const { data: metrics } = await supabase
  .from("ig_reel_metrics")
  .select("*")
  .eq("reel_id", reel.id)
  .order("captured_at", { ascending: false })
  .limit(2);

// Current values from the reel record
const currViews = reel.view_count || 0;
const currLikes = reel.like_count || 0;
const currComments = reel.comment_count || 0;

// Previous values from metrics snapshot
if (metrics.length >= 2) {
  previous = metrics[1]; // Use second most recent
  const prevViews = previous.view_count || 0;
  const prevLikes = previous.like_count || 0;
  const prevComments = previous.comment_count || 0;
  
  // Calculate growth
  viewGrowth = currViews - prevViews;
  likeGrowth = currLikes - prevLikes;
  commentGrowth = currComments - prevComments;
}
```

### Where Snapshots are Saved
**File:** `src-backup/services/tracking.js`
**Function:** `trackProfile()` (lines 605-627)

```javascript
// Store reel metrics history in DATABASE (track growth over time)
const { data: metricsData, error: metricsError } = await supabase
  .from("ig_reel_metrics")
  .insert({
    reel_id: savedReel.id,
    view_count: savedReel.view_count,
    like_count: savedReel.like_count,
    comment_count: savedReel.comment_count
  })
  .select()
  .single();
```

---

## Example: Your Reel

For a reel showing:
- **Views:** 57,659,532 with growth **+142,517**
- **Likes:** 2,104,461 with growth **+5,828**
- **Comments:** 14,368 with growth **+31**

### What's in the Database:

**`ig_profile_reels` table:**
```sql
SELECT view_count, like_count, comment_count
FROM ig_profile_reels
WHERE shortcode = 'your_reel_shortcode';
-- Returns: 57,659,532, 2,104,461, 14,368
```

**`ig_reel_metrics` table (last 2 snapshots):**
```sql
SELECT view_count, like_count, comment_count, captured_at
FROM ig_reel_metrics
WHERE reel_id = 'your_reel_id'
ORDER BY captured_at DESC
LIMIT 2;
```

**Most Recent Snapshot (metrics[0]):**
- view_count: 57,659,532
- like_count: 2,104,461
- comment_count: 14,368
- captured_at: 2025-01-02 10:00:00

**Previous Snapshot (metrics[1]) - Used for comparison:**
- view_count: 57,517,015  ← Previous value
- like_count: 2,098,633    ← Previous value
- comment_count: 14,337    ← Previous value
- captured_at: 2025-01-01 10:00:00

### Calculation:
```
viewGrowth = 57,659,532 - 57,517,015 = +142,517 ✅
likeGrowth = 2,104,461 - 2,098,633 = +5,828 ✅
commentGrowth = 14,368 - 14,337 = +31 ✅
```

---

## Key Points

1. **Growth is NOT stored** - it's calculated every time the API is called
2. **Current values** come from `ig_profile_reels.view_count/like_count/comment_count`
3. **Previous values** come from `ig_reel_metrics` table (second most recent snapshot)
4. **Snapshots are saved** every time `trackProfile()` runs (during refresh)
5. **You need at least 2 refreshes** to see growth (first refresh creates baseline, second shows growth)

---

## SQL Queries to Check Growth Manually

### See current values:
```sql
SELECT shortcode, view_count, like_count, comment_count
FROM ig_profile_reels
WHERE profile_id = 'your_profile_id'
ORDER BY taken_at DESC;
```

### See historical snapshots:
```sql
SELECT 
  r.shortcode,
  r.view_count as current_views,
  r.like_count as current_likes,
  r.comment_count as current_comments,
  m.view_count as previous_views,
  m.like_count as previous_likes,
  m.comment_count as previous_comments,
  (r.view_count - m.view_count) as view_growth,
  (r.like_count - m.like_count) as like_growth,
  (r.comment_count - m.comment_count) as comment_growth,
  m.captured_at
FROM ig_profile_reels r
JOIN LATERAL (
  SELECT view_count, like_count, comment_count, captured_at
  FROM ig_reel_metrics
  WHERE reel_id = r.id
  ORDER BY captured_at DESC
  OFFSET 1 LIMIT 1
) m ON true
WHERE r.profile_id = 'your_profile_id';
```

---

## Why This Design?

1. **Efficiency:** Growth changes constantly, so storing it would require constant updates
2. **Accuracy:** Always shows growth since last refresh (not stale data)
3. **Flexibility:** Can calculate growth for any time period by comparing different snapshots
4. **History:** All historical snapshots are preserved in `ig_reel_metrics` for analysis

