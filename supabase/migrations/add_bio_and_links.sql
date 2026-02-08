-- ============================================================================
-- Migration: Add Biography and External URL to Instagram Profile Tables
-- ============================================================================
-- This migration adds bio (biography) and links (external_url) tracking
-- to both ig_profiles and ig_profile_snapshots tables
-- ============================================================================

-- Add biography and external_url to ig_profiles table
ALTER TABLE ig_profiles 
ADD COLUMN IF NOT EXISTS biography TEXT,
ADD COLUMN IF NOT EXISTS external_url TEXT;

-- Add external_url to ig_profile_snapshots table (biography already exists)
ALTER TABLE ig_profile_snapshots 
ADD COLUMN IF NOT EXISTS external_url TEXT;

-- Add comments for documentation
COMMENT ON COLUMN ig_profiles.biography IS 'Instagram profile bio/biography text';
COMMENT ON COLUMN ig_profiles.external_url IS 'External link in Instagram profile (website/link in bio)';
COMMENT ON COLUMN ig_profile_snapshots.external_url IS 'External link in Instagram profile at time of snapshot';

-- ============================================================================
-- Verification (optional - uncomment to verify)
-- ============================================================================
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'ig_profiles' 
--   AND column_name IN ('biography', 'external_url');
--
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'ig_profile_snapshots' 
--   AND column_name IN ('biography', 'external_url');

















