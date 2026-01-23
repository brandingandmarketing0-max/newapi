const supabase = require('./supabase');
const { trackTwitterProfile, updateTweetAnalytics } = require('./twitter');
const { fetchRepliesForProfile } = require('./twitter-replies');

/**
 * Track analytics growth for all Twitter profiles
 * This runs daily to update metrics for all tracked tweets
 * @returns {Promise<Object>} Result object
 */
async function trackAllTwitterAnalytics() {
  try {
    console.log('[Twitter Analytics] Starting daily analytics tracking...');

    // Get all tracked Twitter profiles
    const { data: profiles, error } = await supabase
      .from('twitter_profiles')
      .select('id, username, tracking_id');

    if (error) {
      throw error;
    }

    if (!profiles || profiles.length === 0) {
      console.log('[Twitter Analytics] No Twitter profiles to track');
      return { processed: 0, message: 'No profiles found' };
    }

    console.log(`[Twitter Analytics] Found ${profiles.length} profile(s) to track`);

    let processed = 0;
    let success = 0;
    let errors = 0;
    const results = [];

    for (const profile of profiles) {
      try {
        console.log(`[Twitter Analytics] Processing profile: ${profile.username} (${profile.id})`);

        // Re-scrape profile to get latest data
        // This will update tweets and their metrics
        const result = await trackTwitterProfile(
          profile.username,
          profile.tracking_id,
          null // userId - could be added if needed
        );

        processed++;
        success++;

        results.push({
          profile: profile.username,
          tweets: result.tweets,
          success: true
        });

        console.log(`[Twitter Analytics] ✅ Successfully updated ${profile.username}`);
        console.log(`   - Tweets saved: ${result.tweets.saved}`);
        console.log(`   - Tweets updated: ${result.tweets.updated}`);

        // Fetch replies for this profile's tweets
        try {
          const repliesResult = await fetchRepliesForProfile(profile.id);
          console.log(`[Twitter Analytics] Replies fetched: ${repliesResult.totalReplies || 0}`);
        } catch (replyError) {
          console.error(`[Twitter Analytics] Error fetching replies for ${profile.username}:`, replyError.message);
          // Don't fail the whole process if replies fail
        }

      } catch (error) {
        errors++;
        console.error(`[Twitter Analytics] ❌ Error processing ${profile.username}:`, error.message);
        results.push({
          profile: profile.username,
          error: error.message,
          success: false
        });
      }
    }

    // Calculate daily metrics for each profile
    await calculateDailyMetrics();

    return {
      processed,
      success,
      errors,
      total: profiles.length,
      results
    };
  } catch (error) {
    console.error('[Twitter Analytics] Fatal error in daily tracking:', error.message);
    throw error;
  }
}

/**
 * Calculate and save daily metrics for all profiles
 * This aggregates metrics for each profile per day
 */
async function calculateDailyMetrics() {
  try {
    console.log('[Twitter Analytics] Calculating daily metrics...');

    // Get all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('twitter_profiles')
      .select('id');

    if (profilesError) throw profilesError;

    if (!profiles || profiles.length === 0) {
      return;
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    for (const profile of profiles) {
      try {
        // Get latest snapshot for today
        const { data: todaySnapshot } = await supabase
          .from('twitter_profile_snapshots')
          .select('*')
          .eq('profile_id', profile.id)
          .gte('captured_at', `${today}T00:00:00Z`)
          .lte('captured_at', `${today}T23:59:59Z`)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Get earliest snapshot for today
        const { data: firstSnapshot } = await supabase
          .from('twitter_profile_snapshots')
          .select('*')
          .eq('profile_id', profile.id)
          .gte('captured_at', `${today}T00:00:00Z`)
          .lte('captured_at', `${today}T23:59:59Z`)
          .order('captured_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!todaySnapshot) {
          // No snapshot for today, skip
          continue;
        }

        const followers_open = firstSnapshot?.followers_count || todaySnapshot.followers_count;
        const followers_close = todaySnapshot.followers_count;
        const followers_delta = followers_close - followers_open;

        const tweets_count_open = firstSnapshot?.tweets_count || todaySnapshot.tweets_count;
        const tweets_count_close = todaySnapshot.tweets_count;
        const tweets_count_delta = tweets_count_close - tweets_count_open;

        // Upsert daily metrics
        await supabase
          .from('twitter_profile_daily_metrics')
          .upsert({
            profile_id: profile.id,
            date: today,
            followers_open,
            followers_close,
            followers_delta,
            tweets_count_open,
            tweets_count_close,
            tweets_count_delta
          }, {
            onConflict: 'profile_id,date'
          });

      } catch (error) {
        console.error(`[Twitter Analytics] Error calculating daily metrics for profile ${profile.id}:`, error.message);
      }
    }

    console.log('[Twitter Analytics] ✅ Daily metrics calculated');
  } catch (error) {
    console.error('[Twitter Analytics] Error calculating daily metrics:', error.message);
  }
}

/**
 * Update analytics for a single profile
 * @param {String} profileId - Profile UUID
 * @returns {Promise<Object>} Result object
 */
async function updateProfileAnalytics(profileId) {
  try {
    // Get profile
    const { data: profile, error } = await supabase
      .from('twitter_profiles')
      .select('username, tracking_id')
      .eq('id', profileId)
      .single();

    if (error) throw error;

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Re-scrape profile
    const result = await trackTwitterProfile(
      profile.username,
      profile.tracking_id,
      null
    );

    // Fetch replies
    await fetchRepliesForProfile(profileId);

    // Calculate daily metrics
    await calculateDailyMetrics();

    return result;
  } catch (error) {
    console.error(`[Twitter Analytics] Error updating analytics for profile ${profileId}:`, error.message);
    throw error;
  }
}

module.exports = {
  trackAllTwitterAnalytics,
  calculateDailyMetrics,
  updateProfileAnalytics
};



















