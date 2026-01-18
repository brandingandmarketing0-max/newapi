-- Migration: Add daily reel growth columns (views, likes, comments) to daily metrics
-- This tracks the total daily growth from all reels combined
-- Run this in your Supabase SQL Editor

-- Add columns for daily reel growth tracking
ALTER TABLE public.ig_profile_daily_metrics 
  ADD COLUMN IF NOT EXISTS views_delta INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes_delta INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_delta INTEGER DEFAULT 0;

-- Add comments to explain the columns
COMMENT ON COLUMN public.ig_profile_daily_metrics.views_delta IS 'Total daily growth in views from all reels';
COMMENT ON COLUMN public.ig_profile_daily_metrics.likes_delta IS 'Total daily growth in likes from all reels';
COMMENT ON COLUMN public.ig_profile_daily_metrics.comments_delta IS 'Total daily growth in comments from all reels';

-- Note: Indexes already exist from the original table creation
-- idx_daily_metrics_profile_date and idx_daily_metrics_date are already created

