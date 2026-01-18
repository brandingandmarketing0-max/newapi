-- ============================================================================
-- Twitter/X Tracking Database Schema
-- ============================================================================
-- This migration adds tables for tracking Twitter/X profiles and tweets
-- Similar structure to Instagram tracking but adapted for Twitter data
-- ============================================================================

-- ============================================================================
-- 1. TWITTER PROFILES TABLE (twitter_profiles)
-- ============================================================================
-- Stores Twitter/X profile information and tracking metadata
CREATE TABLE IF NOT EXISTS twitter_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_id TEXT UNIQUE,
  username TEXT NOT NULL,
  screen_name TEXT,
  full_name TEXT,
  avatar_url TEXT,
  profile_banner_url TEXT,
  user_id TEXT, -- Twitter user ID (rest_id)
  followers_count INTEGER,
  following_count INTEGER,
  tweets_count INTEGER,
  verified BOOLEAN DEFAULT false,
  description TEXT,
  location TEXT,
  user_id_uuid UUID, -- Link to user who is tracking this profile
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Twitter profiles
CREATE INDEX IF NOT EXISTS idx_twitter_profiles_tracking_id ON twitter_profiles(tracking_id);
CREATE INDEX IF NOT EXISTS idx_twitter_profiles_username ON twitter_profiles(username);
CREATE INDEX IF NOT EXISTS idx_twitter_profiles_user_id ON twitter_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_twitter_profiles_user_id_uuid ON twitter_profiles(user_id_uuid);

-- ============================================================================
-- 2. TWITTER TWEETS TABLE (twitter_tweets)
-- ============================================================================
-- Stores individual tweets/posts - one row per tweet
-- All fields extracted from Twitter API JSON response
CREATE TABLE IF NOT EXISTS twitter_tweets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES twitter_profiles(id) ON DELETE CASCADE,
  tweet_id TEXT NOT NULL, -- Twitter tweet ID (rest_id)
  conversation_id TEXT, -- For replies/threads
  text TEXT,
  full_text TEXT,
  created_at TIMESTAMPTZ,
  -- Engagement metrics
  like_count INTEGER DEFAULT 0,
  retweet_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  quote_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  -- Tweet type flags
  is_reply BOOLEAN DEFAULT false,
  is_retweet BOOLEAN DEFAULT false,
  is_quote BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  favorited BOOLEAN DEFAULT false,
  bookmarked BOOLEAN DEFAULT false,
  retweeted BOOLEAN DEFAULT false,
  -- Relationships
  in_reply_to_tweet_id TEXT,
  in_reply_to_user_id TEXT,
  in_reply_to_username TEXT,
  quoted_tweet_id TEXT,
  retweeted_tweet_id TEXT,
  -- Tweet metadata
  source TEXT, -- e.g., "Twitter for iPhone"
  lang TEXT,
  display_text_range INTEGER[], -- [start, end] indices
  -- Entities (stored as JSONB for flexibility)
  entities JSONB, -- hashtags, urls, user_mentions, media, symbols, timestamps
  extended_entities JSONB, -- Extended media entities
  -- Media information
  has_media BOOLEAN DEFAULT false,
  media_count INTEGER DEFAULT 0,
  media_types TEXT[], -- ['photo', 'video', 'animated_gif']
  media_urls TEXT[], -- Array of media URLs
  -- Edit control
  is_edit_eligible BOOLEAN DEFAULT false,
  editable_until_msecs BIGINT,
  edits_remaining INTEGER,
  edit_tweet_ids TEXT[],
  -- Views
  views_state TEXT, -- "EnabledWithCount", "Enabled", etc.
  -- Note tweet (long-form content)
  is_note_tweet BOOLEAN DEFAULT false,
  note_tweet_text TEXT,
  -- Raw data
  raw_json JSONB, -- Store full tweet data for reference
  created_at_db TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, tweet_id)
);

-- Indexes for tweets
CREATE INDEX IF NOT EXISTS idx_tweets_profile_id ON twitter_tweets(profile_id);
CREATE INDEX IF NOT EXISTS idx_tweets_tweet_id ON twitter_tweets(tweet_id);
CREATE INDEX IF NOT EXISTS idx_tweets_conversation_id ON twitter_tweets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON twitter_tweets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweets_profile_created ON twitter_tweets(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweets_in_reply_to ON twitter_tweets(in_reply_to_tweet_id);
CREATE INDEX IF NOT EXISTS idx_tweets_is_pinned ON twitter_tweets(is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_tweets_has_media ON twitter_tweets(has_media) WHERE has_media = true;
CREATE INDEX IF NOT EXISTS idx_tweets_is_retweet ON twitter_tweets(is_retweet) WHERE is_retweet = true;
CREATE INDEX IF NOT EXISTS idx_tweets_is_quote ON twitter_tweets(is_quote) WHERE is_quote = true;
CREATE INDEX IF NOT EXISTS idx_tweets_quoted_tweet_id ON twitter_tweets(quoted_tweet_id) WHERE quoted_tweet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tweets_retweeted_tweet_id ON twitter_tweets(retweeted_tweet_id) WHERE retweeted_tweet_id IS NOT NULL;

-- ============================================================================
-- 3. TWITTER TWEET METRICS TABLE (twitter_tweet_metrics)
-- ============================================================================
-- Stores historical metrics for each tweet (tracks growth over time)
-- One row per tweet per day (or per capture)
CREATE TABLE IF NOT EXISTS twitter_tweet_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tweet_id UUID REFERENCES twitter_tweets(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  like_count INTEGER DEFAULT 0,
  retweet_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  quote_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  -- Delta columns (growth since last capture)
  like_delta INTEGER DEFAULT 0,
  retweet_delta INTEGER DEFAULT 0,
  reply_delta INTEGER DEFAULT 0,
  quote_delta INTEGER DEFAULT 0,
  view_delta INTEGER DEFAULT 0,
  bookmark_delta INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for tweet metrics
CREATE INDEX IF NOT EXISTS idx_tweet_metrics_tweet_captured 
  ON twitter_tweet_metrics(tweet_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweet_metrics_tweet_id ON twitter_tweet_metrics(tweet_id);
CREATE INDEX IF NOT EXISTS idx_tweet_metrics_captured_at ON twitter_tweet_metrics(captured_at DESC);

-- ============================================================================
-- 4. TWITTER REPLIES TABLE (twitter_replies)
-- ============================================================================
-- Stores replies/comments on tweets
CREATE TABLE IF NOT EXISTS twitter_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tweet_id UUID REFERENCES twitter_tweets(id) ON DELETE CASCADE,
  reply_tweet_id TEXT NOT NULL, -- Twitter tweet ID of the reply
  reply_username TEXT,
  reply_user_id TEXT,
  reply_text TEXT,
  reply_created_at TIMESTAMPTZ,
  reply_like_count INTEGER DEFAULT 0,
  reply_retweet_count INTEGER DEFAULT 0,
  reply_reply_count INTEGER DEFAULT 0,
  raw_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tweet_id, reply_tweet_id)
);

-- Indexes for replies
CREATE INDEX IF NOT EXISTS idx_replies_tweet_id ON twitter_replies(tweet_id);
CREATE INDEX IF NOT EXISTS idx_replies_reply_tweet_id ON twitter_replies(reply_tweet_id);
CREATE INDEX IF NOT EXISTS idx_replies_reply_created_at ON twitter_replies(reply_created_at DESC);

-- ============================================================================
-- 5. TWITTER PROFILE SNAPSHOTS TABLE (twitter_profile_snapshots)
-- ============================================================================
-- Stores historical snapshots of profile metrics
CREATE TABLE IF NOT EXISTS twitter_profile_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES twitter_profiles(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  followers_count INTEGER,
  following_count INTEGER,
  tweets_count INTEGER,
  raw_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for snapshots
CREATE INDEX IF NOT EXISTS idx_twitter_snapshots_profile_captured 
  ON twitter_profile_snapshots(profile_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_twitter_snapshots_profile_id ON twitter_profile_snapshots(profile_id);

-- ============================================================================
-- 6. TWITTER DAILY METRICS TABLE (twitter_profile_daily_metrics)
-- ============================================================================
-- Stores daily aggregated metrics for each profile
CREATE TABLE IF NOT EXISTS twitter_profile_daily_metrics (
  profile_id UUID REFERENCES twitter_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  followers_open INTEGER,
  followers_close INTEGER,
  followers_delta INTEGER,
  tweets_count_open INTEGER,
  tweets_count_close INTEGER,
  tweets_count_delta INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, date)
);

-- Indexes for daily metrics
CREATE INDEX IF NOT EXISTS idx_twitter_daily_metrics_profile_date 
  ON twitter_profile_daily_metrics(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_twitter_daily_metrics_date ON twitter_profile_daily_metrics(date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger to auto-update updated_at on twitter_profiles
DROP TRIGGER IF EXISTS update_twitter_profiles_updated_at ON twitter_profiles;
CREATE TRIGGER update_twitter_profiles_updated_at
  BEFORE UPDATE ON twitter_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to auto-update updated_at on twitter_tweets
DROP TRIGGER IF EXISTS update_twitter_tweets_updated_at ON twitter_tweets;
CREATE TRIGGER update_twitter_tweets_updated_at
  BEFORE UPDATE ON twitter_tweets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE twitter_profiles IS 'Twitter/X profile information and tracking metadata';
COMMENT ON TABLE twitter_tweets IS 'Individual tweets/posts - one row per tweet. Contains all tweet data including entities, media, edit control, etc.';
COMMENT ON TABLE twitter_tweet_metrics IS 'Historical metrics for each tweet (tracks growth over time)';
COMMENT ON TABLE twitter_replies IS 'Replies/comments on tweets';
COMMENT ON TABLE twitter_profile_snapshots IS 'Historical snapshots of profile metrics';
COMMENT ON TABLE twitter_profile_daily_metrics IS 'Daily aggregated metrics for each profile';

COMMENT ON COLUMN twitter_tweets.entities IS 'JSONB containing hashtags, urls, user_mentions, media, symbols, timestamps';
COMMENT ON COLUMN twitter_tweets.extended_entities IS 'JSONB containing extended media entities with full details';
COMMENT ON COLUMN twitter_tweets.display_text_range IS 'Array [start, end] indicating text range in full_text';
COMMENT ON COLUMN twitter_tweets.media_types IS 'Array of media types: photo, video, animated_gif';
COMMENT ON COLUMN twitter_tweets.media_urls IS 'Array of media URLs';
COMMENT ON COLUMN twitter_tweets.edit_tweet_ids IS 'Array of tweet IDs in edit chain';
COMMENT ON COLUMN twitter_tweets.note_tweet_text IS 'Long-form content text for note tweets';

COMMENT ON COLUMN twitter_tweet_metrics.like_delta IS 'Growth in likes since last capture';
COMMENT ON COLUMN twitter_tweet_metrics.retweet_delta IS 'Growth in retweets since last capture';
COMMENT ON COLUMN twitter_tweet_metrics.reply_delta IS 'Growth in replies since last capture';
COMMENT ON COLUMN twitter_tweet_metrics.view_delta IS 'Growth in views since last capture';

-- ============================================================================
-- VERIFICATION QUERIES (Run these after setup to verify)
-- ============================================================================

-- Check all tables were created
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
--   AND table_name LIKE 'twitter_%'
-- ORDER BY table_name;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. All timestamps use TIMESTAMPTZ (timezone-aware) for consistency
-- 2. Foreign keys use ON DELETE CASCADE to automatically clean up related data
-- 3. username is NOT unique to allow multiple users tracking the same profile
-- 4. tracking_id IS unique - each tracking instance has a unique ID
-- 5. (profile_id, tweet_id) is unique in tweets - one tweet per profile
-- 6. (profile_id, date) is unique in daily_metrics - one entry per day per profile
-- 7. Each tweet gets its own row in twitter_tweets table
-- 8. Metrics are tracked daily in twitter_tweet_metrics for analytics growth
-- 9. Replies are stored separately in twitter_replies table
-- ============================================================================

