const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { trackTwitterProfile, saveTweets, parseTweetsFromResponse, parseProfileFromResponse } = require('../services/twitter');
const { fetchRepliesForProfile, fetchRepliesForTweet } = require('../services/twitter-replies');
const { updateProfileAnalytics } = require('../services/twitter-analytics');

/**
 * GET /twitter/profiles
 * Get all tracked Twitter profiles
 */
router.get('/profiles', async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('twitter_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Twitter API] Error fetching profiles:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(profiles || []);
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /twitter/profiles/tracking/:tracking_id
 * Get profile by tracking ID
 */
router.get('/profiles/tracking/:tracking_id', async (req, res) => {
  try {
    const { tracking_id } = req.params;

    const { data: profile, error } = await supabase
      .from('twitter_profiles')
      .select('*')
      .eq('tracking_id', tracking_id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Profile not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(profile);
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /twitter/profiles
 * Track a new Twitter profile
 * Body: { username, tracking_id?, user_id? }
 */
router.post('/profiles', async (req, res) => {
  try {
    const { username, tracking_id, user_id } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    console.log(`[Twitter API] Tracking profile: ${username}`);

    const result = await trackTwitterProfile(username, tracking_id, user_id);

    res.json({
      message: 'Profile tracked successfully',
      profile: result.profile,
      tweets: result.tweets
    });
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /twitter/profiles/:username/refresh
 * Refresh/update a Twitter profile
 */
router.post('/profiles/:username/refresh', async (req, res) => {
  try {
    const { username } = req.params;

    console.log(`[Twitter API] Refreshing profile: ${username}`);

    // Get profile first
    const { data: profile, error: profileError } = await supabase
      .from('twitter_profiles')
      .select('id, tracking_id')
      .eq('username', username)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Update analytics
    const result = await updateProfileAnalytics(profile.id);

    res.json({
      message: 'Profile refreshed successfully',
      profile: result.profile,
      tweets: result.tweets
    });
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /twitter/profiles/tracking/:tracking_id
 * Delete a tracked Twitter profile
 */
router.delete('/profiles/tracking/:tracking_id', async (req, res) => {
  try {
    const { tracking_id } = req.params;

    const { error } = await supabase
      .from('twitter_profiles')
      .delete()
      .eq('tracking_id', tracking_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Profile deleted successfully' });
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /twitter/profiles/:username/tweets
 * Get tweets for a profile
 */
router.get('/profiles/:username/tweets', async (req, res) => {
  try {
    const { username } = req.params;
    const { offset = 0, limit = 100 } = req.query;

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('twitter_profiles')
      .select('id')
      .eq('username', username)
      .single();

    if (profileError) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get tweets
    const { data: tweets, error: tweetsError } = await supabase
      .from('twitter_tweets')
      .select('*')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (tweetsError) {
      return res.status(500).json({ error: tweetsError.message });
    }

    res.json(tweets || []);
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /twitter/tweets/:tweet_id
 * Get a specific tweet
 */
router.get('/tweets/:tweet_id', async (req, res) => {
  try {
    const { tweet_id } = req.params;

    const { data: tweet, error } = await supabase
      .from('twitter_tweets')
      .select('*')
      .eq('tweet_id', tweet_id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Tweet not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(tweet);
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /twitter/tweets/:tweet_id/metrics
 * Get metrics history for a tweet
 */
router.get('/tweets/:tweet_id/metrics', async (req, res) => {
  try {
    const { tweet_id } = req.params;

    // Get tweet DB ID
    const { data: tweet, error: tweetError } = await supabase
      .from('twitter_tweets')
      .select('id')
      .eq('tweet_id', tweet_id)
      .single();

    if (tweetError) {
      return res.status(404).json({ error: 'Tweet not found' });
    }

    // Get metrics
    const { data: metrics, error: metricsError } = await supabase
      .from('twitter_tweet_metrics')
      .select('*')
      .eq('tweet_id', tweet.id)
      .order('captured_at', { ascending: false });

    if (metricsError) {
      return res.status(500).json({ error: metricsError.message });
    }

    res.json(metrics || []);
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /twitter/tweets/:tweet_id/replies
 * Get replies for a tweet
 */
router.get('/tweets/:tweet_id/replies', async (req, res) => {
  try {
    const { tweet_id } = req.params;

    // Get tweet DB ID
    const { data: tweet, error: tweetError } = await supabase
      .from('twitter_tweets')
      .select('id')
      .eq('tweet_id', tweet_id)
      .single();

    if (tweetError) {
      return res.status(404).json({ error: 'Tweet not found' });
    }

    // Get replies
    const { data: replies, error: repliesError } = await supabase
      .from('twitter_replies')
      .select('*')
      .eq('tweet_id', tweet.id)
      .order('reply_created_at', { ascending: false });

    if (repliesError) {
      return res.status(500).json({ error: repliesError.message });
    }

    res.json(replies || []);
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /twitter/tweets/:tweet_id/fetch-replies
 * Manually fetch replies for a tweet
 */
router.post('/tweets/:tweet_id/fetch-replies', async (req, res) => {
  try {
    const { tweet_id } = req.params;

    // Get tweet DB ID
    const { data: tweet, error: tweetError } = await supabase
      .from('twitter_tweets')
      .select('id, tweet_id')
      .eq('tweet_id', tweet_id)
      .single();

    if (tweetError) {
      return res.status(404).json({ error: 'Tweet not found' });
    }

    // Fetch replies
    const result = await fetchRepliesForTweet(tweet.tweet_id, tweet.id);

    res.json({
      message: 'Replies fetched',
      result
    });
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /twitter/profiles/:username/fetch-replies
 * Fetch replies for all tweets in a profile
 */
router.post('/profiles/:username/fetch-replies', async (req, res) => {
  try {
    const { username } = req.params;

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('twitter_profiles')
      .select('id')
      .eq('username', username)
      .single();

    if (profileError) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Fetch replies
    const result = await fetchRepliesForProfile(profile.id);

    res.json({
      message: 'Replies fetched for profile',
      result
    });
  } catch (error) {
    console.error('[Twitter API] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;













