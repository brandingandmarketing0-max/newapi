-- Add growth delta columns to ig_profile_reels table
-- These columns store the calculated growth between tracking sessions

ALTER TABLE ig_profile_reels
ADD COLUMN IF NOT EXISTS view_delta INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS like_delta INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comment_delta INTEGER DEFAULT 0;

-- Add comment explaining what these columns store
COMMENT ON COLUMN ig_profile_reels.view_delta IS 'Growth in views since last tracking (stored, not calculated on-the-fly)';
COMMENT ON COLUMN ig_profile_reels.like_delta IS 'Growth in likes since last tracking (stored, not calculated on-the-fly)';
COMMENT ON COLUMN ig_profile_reels.comment_delta IS 'Growth in comments since last tracking (stored, not calculated on-the-fly)';

