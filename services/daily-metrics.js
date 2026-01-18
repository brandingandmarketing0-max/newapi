/**
 * Daily Metrics Service
 * Updates daily metrics for all profiles by calculating from snapshots
 */

const supabase = require("./supabase");

/**
 * Update daily metrics for all profiles
 * This should be called daily (via cron) to ensure daily metrics are always up to date
 */
async function updateDailyMetricsForAllProfiles() {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`\n📊 [Daily Metrics] Processing date: ${today}`);

    // Get all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('ig_profiles')
      .select('id, username');

    if (profilesError) {
      throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
    }

    if (!profiles || profiles.length === 0) {
      console.log(`ℹ️  [Daily Metrics] No profiles found`);
      return { date: today, profiles: 0, created: 0, updated: 0, errors: 0 };
    }

    console.log(`✅ [Daily Metrics] Found ${profiles.length} profile(s)`);

    let updated = 0;
    let created = 0;
    let errors = 0;

    // Process each profile
    for (const profile of profiles) {
      try {
        // Get the first snapshot of today (opening value) - include all fields
        const { data: firstSnapshot } = await supabase
          .from('ig_profile_snapshots')
          .select('followers, following, media_count, clips_count, captured_at')
          .eq('profile_id', profile.id)
          .gte('captured_at', `${today}T00:00:00.000Z`)
          .lte('captured_at', `${today}T23:59:59.999Z`)
          .order('captured_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        // Get the last snapshot of today (closing value) - include all fields
        const { data: lastSnapshot } = await supabase
          .from('ig_profile_snapshots')
          .select('followers, following, media_count, clips_count, captured_at')
          .eq('profile_id', profile.id)
          .gte('captured_at', `${today}T00:00:00.000Z`)
          .lte('captured_at', `${today}T23:59:59.999Z`)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // If no snapshots for today, get the most recent snapshot (for closing value)
        let latestSnapshot = lastSnapshot;
        if (!latestSnapshot) {
          const { data: recentSnapshot } = await supabase
            .from('ig_profile_snapshots')
            .select('followers, following, media_count, clips_count, captured_at')
            .eq('profile_id', profile.id)
            .order('captured_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          latestSnapshot = recentSnapshot;
        }

        if (!latestSnapshot) {
          console.log(`   ⚠️  @${profile.username}: No snapshots found, skipping`);
          continue;
        }

        // Calculate open/close values for all metrics
        const followersOpen = firstSnapshot?.followers || latestSnapshot.followers || 0;
        const followersClose = latestSnapshot.followers || 0;
        const followersDelta = followersClose - followersOpen;

        const followingOpen = firstSnapshot?.following || latestSnapshot.following || 0;
        const followingClose = latestSnapshot.following || 0;
        const followingDelta = followingClose - followingOpen;

        const mediaOpen = firstSnapshot?.media_count || latestSnapshot.media_count || 0;
        const mediaClose = latestSnapshot.media_count || 0;
        const mediaDelta = mediaClose - mediaOpen;

        const clipsOpen = firstSnapshot?.clips_count || latestSnapshot.clips_count || 0;
        const clipsClose = latestSnapshot.clips_count || 0;
        const clipsDelta = clipsClose - clipsOpen;

        // Calculate daily reel growth (views, likes, comments) from reel metrics
        let totalViewsDelta = 0;
        let totalLikesDelta = 0;
        let totalCommentsDelta = 0;

        // Get all reels for this profile
        const { data: reels } = await supabase
          .from('ig_profile_reels')
          .select('id')
          .eq('profile_id', profile.id);

        if (reels && reels.length > 0) {
          const reelIds = reels.map(r => r.id);
          
          // Get yesterday's date for comparison
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];

          // For each reel, calculate growth from metrics snapshots
          for (const reelId of reelIds) {
            // Get metrics snapshots for today and yesterday
            const { data: todayMetrics } = await supabase
              .from('ig_reel_metrics')
              .select('view_count, like_count, comment_count, captured_at')
              .eq('reel_id', reelId)
              .gte('captured_at', `${today}T00:00:00.000Z`)
              .lte('captured_at', `${today}T23:59:59.999Z`)
              .order('captured_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            // Get the most recent metric before today (could be yesterday or earlier)
            const { data: previousMetrics } = await supabase
              .from('ig_reel_metrics')
              .select('view_count, like_count, comment_count, captured_at')
              .eq('reel_id', reelId)
              .lt('captured_at', `${today}T00:00:00.000Z`)
              .order('captured_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (todayMetrics && previousMetrics) {
              // Calculate growth
              const viewsGrowth = Math.max(0, (todayMetrics.view_count || 0) - (previousMetrics.view_count || 0));
              const likesGrowth = Math.max(0, (todayMetrics.like_count || 0) - (previousMetrics.like_count || 0));
              const commentsGrowth = Math.max(0, (todayMetrics.comment_count || 0) - (previousMetrics.comment_count || 0));

              totalViewsDelta += viewsGrowth;
              totalLikesDelta += likesGrowth;
              totalCommentsDelta += commentsGrowth;
            }
          }
        }

        // Check if daily metrics row already exists for today
        const { data: existingMetrics } = await supabase
          .from('ig_profile_daily_metrics')
          .select('id')
          .eq('profile_id', profile.id)
          .eq('date', today)
          .maybeSingle();

        if (existingMetrics) {
          // Update existing row
          const { error: updateError } = await supabase
            .from('ig_profile_daily_metrics')
            .update({
              followers_open: followersOpen,
              followers_close: followersClose,
              followers_delta: followersDelta,
              following_open: followingOpen,
              following_close: followingClose,
              following_delta: followingDelta,
              media_open: mediaOpen,
              media_close: mediaClose,
              media_delta: mediaDelta,
              posts_delta: mediaDelta, // Alias for backwards compatibility
              clips_open: clipsOpen,
              clips_close: clipsClose,
              clips_delta: clipsDelta,
              views_delta: totalViewsDelta,
              likes_delta: totalLikesDelta,
              comments_delta: totalCommentsDelta,
            })
            .eq('profile_id', profile.id)
            .eq('date', today);

          if (updateError) {
            console.error(`   ❌ @${profile.username}: Failed to update - ${updateError.message}`);
            errors++;
          } else {
            updated++;
            console.log(`   ✅ @${profile.username}: Updated (+${followersDelta.toLocaleString()} followers, +${followingDelta.toLocaleString()} following, +${mediaDelta.toLocaleString()} media, +${clipsDelta.toLocaleString()} clips, +${totalViewsDelta.toLocaleString()} views, +${totalLikesDelta.toLocaleString()} likes, +${totalCommentsDelta.toLocaleString()} comments)`);
          }
        } else {
          // Create new row
          const { error: insertError } = await supabase
            .from('ig_profile_daily_metrics')
            .insert({
              profile_id: profile.id,
              date: today,
              followers_open: followersOpen,
              followers_close: followersClose,
              followers_delta: followersDelta,
              following_open: followingOpen,
              following_close: followingClose,
              following_delta: followingDelta,
              media_open: mediaOpen,
              media_close: mediaClose,
              media_delta: mediaDelta,
              posts_delta: mediaDelta, // Alias for backwards compatibility
              clips_open: clipsOpen,
              clips_close: clipsClose,
              clips_delta: clipsDelta,
              views_delta: totalViewsDelta,
              likes_delta: totalLikesDelta,
              comments_delta: totalCommentsDelta,
            });

          if (insertError) {
            console.error(`   ❌ @${profile.username}: Failed to create - ${insertError.message}`);
            errors++;
          } else {
            created++;
            console.log(`   ✅ @${profile.username}: Created (+${followersDelta.toLocaleString()} followers, +${followingDelta.toLocaleString()} following, +${mediaDelta.toLocaleString()} media, +${clipsDelta.toLocaleString()} clips, +${totalViewsDelta.toLocaleString()} views, +${totalLikesDelta.toLocaleString()} likes, +${totalCommentsDelta.toLocaleString()} comments)`);
          }
        }
      } catch (error) {
        console.error(`   ❌ @${profile.username}: Error - ${error.message}`);
        errors++;
      }
    }

    const result = {
      date: today,
      profiles: profiles.length,
      created,
      updated,
      errors,
      total: created + updated,
    };

    console.log(`\n✅ [Daily Metrics] Completed:`);
    console.log(`   Date: ${today}`);
    console.log(`   Profiles processed: ${profiles.length}`);
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${created + updated}`);

    return result;
  } catch (error) {
    console.error(`❌ [Daily Metrics] Fatal error:`, error.message);
    throw error;
  }
}

module.exports = {
  updateDailyMetricsForAllProfiles,
};

