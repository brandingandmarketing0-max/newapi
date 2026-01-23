# Twitter/X Tracking System

This document explains how to use the Twitter/X tracking system to save tweets, track analytics growth, and fetch replies.

## Overview

The Twitter tracking system:
- Saves each tweet/post in separate rows in the database
- Tracks analytics growth daily (likes, retweets, replies, views, etc.)
- Fetches and stores replies/comments on tweets
- Runs daily cron jobs to update all tracked profiles

## Database Schema

The system uses the following tables:

1. **twitter_profiles** - Twitter profile information
2. **twitter_tweets** - Individual tweets (one row per tweet)
3. **twitter_tweet_metrics** - Historical metrics for each tweet (tracks growth)
4. **twitter_replies** - Replies/comments on tweets
5. **twitter_profile_snapshots** - Historical profile metrics
6. **twitter_profile_daily_metrics** - Daily aggregated metrics

See `supabase/migrations/create_twitter_tables.sql` for the complete schema.

## Setup

### 1. Run Database Migration

Execute the SQL migration in your Supabase SQL Editor:

```sql
-- Run: supabase/migrations/create_twitter_tables.sql
```

### 2. Scrape Twitter Data

First, scrape Twitter data using the `x-tracker-playwright` script:

```bash
cd x-tracker-playwright
node index.js <username>
# Example: node index.js elonmusk
```

This will save the scraped data to `x-tracker-playwright/data/<username>_<timestamp>.json`

### 3. Track a Profile

Use the API to track a Twitter profile:

```bash
POST /twitter/profiles
Content-Type: application/json

{
  "username": "elonmusk",
  "tracking_id": "optional-tracking-id",
  "user_id": "optional-user-uuid"
}
```

This will:
- Parse the scraped JSON data
- Save the profile to the database
- Save all tweets (one row per tweet)
- Create initial metrics snapshots

## API Endpoints

### Profiles

- `GET /twitter/profiles` - Get all tracked profiles
- `GET /twitter/profiles/tracking/:tracking_id` - Get profile by tracking ID
- `POST /twitter/profiles` - Track a new profile
- `POST /twitter/profiles/:username/refresh` - Refresh/update a profile
- `DELETE /twitter/profiles/tracking/:tracking_id` - Delete a tracked profile

### Tweets

- `GET /twitter/profiles/:username/tweets` - Get tweets for a profile
- `GET /twitter/tweets/:tweet_id` - Get a specific tweet
- `GET /twitter/tweets/:tweet_id/metrics` - Get metrics history for a tweet
- `GET /twitter/tweets/:tweet_id/replies` - Get replies for a tweet
- `POST /twitter/tweets/:tweet_id/fetch-replies` - Manually fetch replies
- `POST /twitter/profiles/:username/fetch-replies` - Fetch replies for all tweets

## Daily Cron Job

The system runs a daily cron job at **3:00 AM IST** to:

1. Re-scrape all tracked Twitter profiles
2. Update tweet metrics (likes, retweets, replies, views, etc.)
3. Calculate deltas (growth since last capture)
4. Fetch replies for tweets
5. Calculate daily aggregated metrics

### Cron Schedule

Default: `0 3 * * *` (3:00 AM IST daily)

Configure via environment variable:
```bash
TWITTER_CRON_SCHEDULE="0 3 * * *"
```

## How It Works

### 1. Saving Tweets

Each tweet is saved as a separate row in `twitter_tweets`:

```javascript
{
  tweet_id: "2007812723439235464",
  profile_id: "<uuid>",
  text: "Tweet content...",
  like_count: 159070,
  retweet_count: 38506,
  reply_count: 9785,
  view_count: 28888248,
  created_at: "2026-01-04T09:25:52Z",
  // ... more fields
}
```

### 2. Tracking Analytics Growth

Metrics are saved daily in `twitter_tweet_metrics`:

```javascript
{
  tweet_id: "<uuid>",
  captured_at: "2026-01-06T03:00:00Z",
  like_count: 160000,
  like_delta: 930,  // Growth since last capture
  retweet_count: 39000,
  retweet_delta: 494,
  // ... more metrics
}
```

### 3. Fetching Replies

Replies are stored in `twitter_replies`:

```javascript
{
  tweet_id: "<uuid>",
  reply_tweet_id: "2008426950302285936",
  reply_username: "someuser",
  reply_text: "Reply content...",
  reply_like_count: 10,
  // ... more fields
}
```

## Example Usage

### Track a Profile

```bash
curl -X POST http://localhost:3001/twitter/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "username": "elonmusk",
    "tracking_id": "track-123"
  }'
```

### Get Tweets

```bash
curl http://localhost:3001/twitter/profiles/elonmusk/tweets?limit=50
```

### Get Tweet Metrics

```bash
curl http://localhost:3001/twitter/tweets/2007812723439235464/metrics
```

### Get Replies

```bash
curl http://localhost:3001/twitter/tweets/2007812723439235464/replies
```

## Data Flow

1. **Scrape** → Use `x-tracker-playwright` to scrape Twitter data
2. **Parse** → `services/twitter.js` parses the JSON data
3. **Save** → Tweets saved to `twitter_tweets` (one row per tweet)
4. **Track** → Daily cron updates metrics in `twitter_tweet_metrics`
5. **Replies** → Replies fetched and saved to `twitter_replies`

## Notes

- Each tweet gets its own row in the database
- Metrics are tracked daily with delta calculations
- Replies are fetched separately and linked to parent tweets
- The system requires scraped JSON data from `x-tracker-playwright`
- Daily cron runs at 3:00 AM IST (configurable)

## Troubleshooting

### No scraped data found

Make sure you've run the `x-tracker-playwright` script first:
```bash
cd x-tracker-playwright
node index.js <username>
```

### Tweets not updating

Check that the cron job is running:
```bash
GET /cron/schedule
```

### Replies not fetching

Replies require integration with the playwright script. Currently, it's a placeholder that needs to be implemented.

## Future Improvements

- [ ] Integrate reply fetching with playwright script
- [ ] Add real-time Twitter API integration (if available)
- [ ] Add webhook support for real-time updates
- [ ] Add batch processing for large profiles
- [ ] Add rate limiting for Twitter API calls



















