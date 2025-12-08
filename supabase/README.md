# Database Schema Setup

This directory contains SQL files for setting up the Instagram tracking database.

## 🚀 Quick Setup

### For a New Database

1. **Open Supabase Dashboard**
   - Go to your Supabase project
   - Navigate to **SQL Editor**

2. **Run the Complete Schema**
   - Open `complete_schema.sql`
   - Copy the entire file
   - Paste into Supabase SQL Editor
   - Click **Run** (or press `Ctrl+Enter`)

3. **Verify Setup**
   - Check that all 6 tables were created:
     - `ig_profiles`
     - `ig_profile_snapshots`
     - `ig_profile_deltas`
     - `ig_profile_daily_metrics`
     - `ig_profile_reels`
     - `ig_reel_metrics`
   - You can run this query to verify:
     ```sql
     SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
       AND table_name LIKE 'ig_%'
     ORDER BY table_name;
     ```

## 📁 Files

- **`complete_schema.sql`** - Complete database schema with all tables, indexes, and triggers
- **`migrations/add_reel_delta_columns.sql`** - Migration to add delta columns (already included in complete_schema.sql)

## 📋 What Gets Created

### Tables (6 total)
1. **ig_profiles** - Instagram profile information
2. **ig_profile_snapshots** - Historical profile metrics
3. **ig_profile_deltas** - Calculated differences between snapshots
4. **ig_profile_daily_metrics** - Daily aggregated metrics
5. **ig_profile_reels** - Instagram reels/videos
6. **ig_reel_metrics** - Historical reel metrics

### Indexes
- Optimized indexes for common query patterns
- Foreign key indexes for performance

### Triggers
- Auto-update `updated_at` timestamp on `ig_profiles`

## ⚙️ Important Notes

1. **Username is NOT unique** - This allows multiple users to track the same Instagram profile
2. **tracking_id IS unique** - Each tracking instance has a unique ID
3. **All timestamps use TIMESTAMPTZ** - Timezone-aware for consistency
4. **Cascading deletes** - Deleting a profile automatically cleans up related data

## 🔄 Migrations

If you already have a database and need to add new columns:

1. Check `migrations/` folder for specific migration files
2. Run migrations in order (if multiple exist)
3. Or use `complete_schema.sql` which includes all migrations

## 🐛 Troubleshooting

### "relation already exists" error
- Tables already exist - this is safe to ignore
- The `IF NOT EXISTS` clause prevents errors

### "extension uuid-ossp does not exist"
- Supabase should have this enabled by default
- If not, contact Supabase support

### Missing columns
- Make sure you ran the complete schema file
- Check that all migrations are included

## 📚 More Information

See `TRACKING_SQL_REFERENCE.md` in the root directory for detailed SQL operation examples.


