-- Migration: Add following, media, and clips delta columns to daily metrics
-- Run this in your Supabase SQL Editor

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













