-- ============================================================================
-- Complete Database Schema for Instagram Tracking System
-- ============================================================================
-- This file contains all tables, indexes, and constraints needed for the
-- Instagram tracking API (src-backup-railway) and next-client frontend.
--
-- To use this:
-- 1. Open your Supabase project
-- 2. Go to SQL Editor
-- 3. Paste this entire file
-- 4. Click "Run" to execute
-- ============================================================================

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. PROFILES TABLE (ig_profiles)
-- ============================================================================
-- Stores Instagram profile information and tracking metadata
-- Note: username is NOT unique to allow multiple users tracking the same profile
CREATE TABLE IF NOT EXISTS ig_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_id TEXT UNIQUE,
  username TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  profile_picture TEXT,
  user_id UUID,
  poll_interval_minutes INTEGER DEFAULT 60,
  last_snapshot_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_tracking_id ON ig_profiles(tracking_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON ig_profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON ig_profiles(user_id);

-- ============================================================================
-- 2. PROFILE SNAPSHOTS TABLE (ig_profile_snapshots)
-- ============================================================================
-- Stores historical snapshots of profile metrics (followers, following, etc.)
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

-- Indexes for snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_profile_captured 
  ON ig_profile_snapshots(profile_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_profile_id ON ig_profile_snapshots(profile_id);

-- ============================================================================
-- 3. PROFILE DELTAS TABLE (ig_profile_deltas)
-- ============================================================================
-- Stores calculated differences between snapshots
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

-- Indexes for deltas
CREATE INDEX IF NOT EXISTS idx_deltas_profile_created 
  ON ig_profile_deltas(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deltas_profile_id ON ig_profile_deltas(profile_id);

-- ============================================================================
-- 4. DAILY METRICS TABLE (ig_profile_daily_metrics)
-- ============================================================================
-- Stores daily aggregated metrics for each profile
CREATE TABLE IF NOT EXISTS ig_profile_daily_metrics (
  profile_id UUID REFERENCES ig_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  followers_open INTEGER,
  followers_close INTEGER,
  followers_delta INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (profile_id, date)
);

-- Indexes for daily metrics
CREATE INDEX IF NOT EXISTS idx_daily_metrics_profile_date 
  ON ig_profile_daily_metrics(profile_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON ig_profile_daily_metrics(date);

-- ============================================================================
-- 5. REELS TABLE (ig_profile_reels)
-- ============================================================================
-- Stores Instagram reels/videos for each profile
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
  -- Delta columns (added via migration)
  view_delta INTEGER DEFAULT 0,
  like_delta INTEGER DEFAULT 0,
  comment_delta INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id, shortcode)
);

-- Indexes for reels
CREATE INDEX IF NOT EXISTS idx_reels_profile_taken 
  ON ig_profile_reels(profile_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_profile_id ON ig_profile_reels(profile_id);
CREATE INDEX IF NOT EXISTS idx_reels_shortcode ON ig_profile_reels(shortcode);

-- Comments for reel delta columns
COMMENT ON COLUMN ig_profile_reels.view_delta IS 'Growth in views since last tracking (stored, not calculated on-the-fly)';
COMMENT ON COLUMN ig_profile_reels.like_delta IS 'Growth in likes since last tracking (stored, not calculated on-the-fly)';
COMMENT ON COLUMN ig_profile_reels.comment_delta IS 'Growth in comments since last tracking (stored, not calculated on-the-fly)';

-- ============================================================================
-- 6. REEL METRICS TABLE (ig_reel_metrics)
-- ============================================================================
-- Stores historical metrics for each reel (tracks growth over time)
CREATE TABLE IF NOT EXISTS ig_reel_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reel_id UUID REFERENCES ig_profile_reels(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for reel metrics
CREATE INDEX IF NOT EXISTS idx_reel_metrics_reel_captured 
  ON ig_reel_metrics(reel_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_reel_metrics_reel_id ON ig_reel_metrics(reel_id);

-- ============================================================================
-- HELPER FUNCTIONS (Optional but recommended)
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on ig_profiles
DROP TRIGGER IF EXISTS update_ig_profiles_updated_at ON ig_profiles;
CREATE TRIGGER update_ig_profiles_updated_at
  BEFORE UPDATE ON ig_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VERIFICATION QUERIES (Run these after setup to verify)
-- ============================================================================

-- Check all tables were created
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
--   AND table_name LIKE 'ig_%'
-- ORDER BY table_name;

-- Check all indexes were created
-- SELECT indexname, tablename 
-- FROM pg_indexes 
-- WHERE schemaname = 'public' 
--   AND tablename LIKE 'ig_%'
-- ORDER BY tablename, indexname;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. All timestamps use TIMESTAMPTZ (timezone-aware) for consistency
-- 2. Foreign keys use ON DELETE CASCADE to automatically clean up related data
-- 3. username is NOT unique to allow multiple users tracking the same profile
-- 4. tracking_id IS unique - each tracking instance has a unique ID
-- 5. (profile_id, shortcode) is unique in reels - one reel per profile
-- 6. (profile_id, date) is unique in daily_metrics - one entry per day per profile
-- 7. All tables have created_at for audit trail
-- 8. Indexes are optimized for common query patterns
-- ============================================================================


