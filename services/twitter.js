const supabase = require('./supabase');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * Parse Twitter API response and extract tweets + replies (UserTweetsAndReplies aware)
 * Returns latest 15 tweets + 15 replies to keep payload lean.
 * @param {Object} apiResponse - The UserTweets/UserTweetsAndReplies API response
 * @returns {{tweets: Array, replies: Array}}
 */
function parseTweetsFromResponse(apiResponse) {
  const tweets = [];
  const replies = [];

  // Helpers to navigate timeline shapes
  const findTimeline = (data) =>
    data?.data?.user?.result?.timeline?.timeline ||
    data?.data?.user?.result?.timeline_v2?.timeline ||
    data?.data?.timeline ||
    null;

  const normalizeEntries = (instructions = []) => {
    const entries = [];
    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
        entries.push(...instruction.entries);
      }
      if (instruction.type === 'TimelineReplaceEntry' && instruction.entry) {
        entries.push(instruction.entry);
      }
      if (instruction.type === 'TimelinePinEntry' && instruction.entry) {
        entries.push(instruction.entry);
      }
      if (instruction.type === 'TimelineAddToModule' && instruction.moduleItems) {
        instruction.moduleItems.forEach((item) => {
          const itemContent = item.item?.itemContent || item.itemContent || item.content?.itemContent;
          if (itemContent) {
            entries.push({ content: { itemContent } });
          }
        });
      }
    }
    return entries;
  };

  const extractItemContent = (entry) =>
    entry?.item?.itemContent ||
    entry?.content?.itemContent ||
    entry?.content?.content?.itemContent ||
    entry?.content?.content ||
    entry?.content ||
    entry?.item ||
    null;

  const extractTweetResult = (itemContent) => {
    if (!itemContent) return null;
    let result = itemContent.tweet_results?.result || itemContent.tweet_results;

    if (Array.isArray(itemContent.tweet_results)) {
      result = itemContent.tweet_results[0]?.result || itemContent.tweet_results[0];
    }

    if (result?.__typename === 'TweetWithVisibilityResults') {
      result = result.result?.tweet || result.result;
    }

    return result;
  };

  try {
    if (!apiResponse || !apiResponse.responseData) {
      return { tweets: [], replies: [] };
    }

    const timeline = findTimeline(apiResponse.responseData);
    if (!timeline?.instructions) {
      return { tweets: [], replies: [] };
    }

    const entries = normalizeEntries(timeline.instructions);
    if (entries.length === 0) {
      return { tweets: [], replies: [] };
    }

    let skippedRetweets = 0;
    let skippedNoContent = 0;

    for (const entry of entries) {
      const itemContent = extractItemContent(entry);
      const tweetResult = extractTweetResult(itemContent);

      if (!tweetResult || tweetResult.__typename !== 'Tweet') {
        skippedNoContent++;
        continue;
      }

      const legacy = tweetResult.legacy || {};
      const retweetedStatus = legacy.retweeted_status_result?.result;
      if (retweetedStatus) {
        skippedRetweets++;
        continue; // ignore retweets/reposts
      }

      const parsed = parseTweet(tweetResult, entry);
      if (!parsed) {
        skippedNoContent++;
        continue;
      }

      // Force reply flag from legacy in case parseTweet missed
      const isReply = !!legacy.in_reply_to_status_id_str;
      parsed.is_reply = isReply;

      if (isReply) {
        replies.push(parsed);
      } else {
        tweets.push(parsed);
      }
    }

    // Sort newest first and trim
    const sortByDateDesc = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    tweets.sort(sortByDateDesc);
    replies.sort(sortByDateDesc);

    return {
      tweets: tweets.slice(0, 15),
      replies: replies.slice(0, 15),
      skippedRetweets,
      skippedNoContent
    };
  } catch (error) {
    console.error('[Twitter] Error parsing tweets:', error.message);
    return { tweets: [], replies: [] };
  }
}

/**
 * Parse a single tweet object
 * @param {Object} tweetResult - Raw tweet data from API
 * @param {Object} entryData - Optional entry data (for pinned status, etc.)
 * @returns {Object|null} Parsed tweet object
 */
function parseTweet(tweetResult, entryData = null) {
  try {
    const legacy = tweetResult.legacy || {};
    const core = tweetResult.core || {};
    const userResult = core.user_results?.result;
    const userLegacy = userResult?.legacy || {};
    
    // Check if pinned
    const isPinned = entryData?.content?.socialContext?.contextType === 'Pin' || false;
    
    // Parse entities
    const entities = legacy.entities || {};
    const extendedEntities = legacy.extended_entities || {};
    
    // Extract media information
    const media = entities.media || extendedEntities.media || [];
    const mediaTypes = [...new Set(media.map(m => m.type || 'unknown'))];
    const mediaUrls = media.map(m => m.media_url_https || m.url || '').filter(Boolean);
    
    // Parse edit control
    const editControl = tweetResult.edit_control || {};
    const editTweetIds = editControl.edit_tweet_ids || [];
    
    // Parse note tweet (long-form content)
    const noteTweet = tweetResult.note_tweet?.note_tweet_results?.result;
    const isNoteTweet = !!noteTweet;
    const noteTweetText = noteTweet?.text || null;
    
    // Parse views
    const views = tweetResult.views || {};
    const viewCount = views.count ? parseInt(views.count) : 0;
    const viewsState = views.state || null;
    
    // Parse in-reply-to information
    const inReplyToUserId = legacy.in_reply_to_user_id_str || null;
    const inReplyToUsername = legacy.in_reply_to_screen_name || null;
    
    // Check if retweet
    const retweetedStatus = legacy.retweeted_status_result?.result;
    const isRetweet = !!retweetedStatus;
    const retweetedTweetId = retweetedStatus?.rest_id || null;
    
    // Check if quote tweet
    const quotedStatus = tweetResult.quoted_status_result?.result;
    const isQuote = !!legacy.is_quote_status || !!quotedStatus;
    const quotedTweetId = legacy.quoted_status_id_str || null;
    
    const tweet = {
      tweet_id: tweetResult.rest_id,
      conversation_id: legacy.conversation_id_str || tweetResult.rest_id,
      text: legacy.full_text || noteTweetText || '',
      full_text: legacy.full_text || noteTweetText || '',
      created_at: parseTwitterDate(legacy.created_at),
      // Engagement metrics
      like_count: legacy.favorite_count || 0,
      retweet_count: legacy.retweet_count || 0,
      reply_count: legacy.reply_count || 0,
      quote_count: legacy.quote_count || 0,
      view_count: viewCount,
      bookmark_count: legacy.bookmark_count || 0,
      // Tweet type flags
      is_reply: !!legacy.in_reply_to_status_id_str,
      is_retweet: isRetweet,
      is_quote: isQuote,
      is_pinned: isPinned,
      favorited: legacy.favorited || false,
      bookmarked: legacy.bookmarked || false,
      retweeted: legacy.retweeted || false,
      // Relationships
      in_reply_to_tweet_id: legacy.in_reply_to_status_id_str || null,
      in_reply_to_user_id: inReplyToUserId,
      in_reply_to_username: inReplyToUsername,
      quoted_tweet_id: quotedTweetId,
      retweeted_tweet_id: retweetedTweetId,
      // Tweet metadata
      source: legacy.source || null,
      lang: legacy.lang || null,
      display_text_range: legacy.display_text_range || null,
      // Entities
      entities: entities,
      extended_entities: Object.keys(extendedEntities).length > 0 ? extendedEntities : null,
      // Media information
      has_media: media.length > 0,
      media_count: media.length,
      media_types: mediaTypes.length > 0 ? mediaTypes : null,
      media_urls: mediaUrls.length > 0 ? mediaUrls : null,
      // Edit control
      is_edit_eligible: editControl.is_edit_eligible || false,
      editable_until_msecs: editControl.editable_until_msecs ? parseInt(editControl.editable_until_msecs) : null,
      edits_remaining: editControl.edits_remaining ? parseInt(editControl.edits_remaining) : null,
      edit_tweet_ids: editTweetIds.length > 0 ? editTweetIds : null,
      // Views
      views_state: viewsState,
      // Note tweet
      is_note_tweet: isNoteTweet,
      note_tweet_text: noteTweetText,
      // Raw data
      raw_json: tweetResult,
      // User info (for reference, not stored in DB)
      username: userLegacy.screen_name || userResult?.core?.screen_name || null,
      user_id: userResult?.rest_id || null
    };

    return tweet;
  } catch (error) {
    console.error('[Twitter] Error parsing single tweet:', error.message);
    console.error('[Twitter] Tweet ID:', tweetResult.rest_id);
    return null;
  }
}

/**
 * Parse Twitter date string to ISO timestamp
 * @param {String} dateStr - Twitter date string (e.g., "Tue Jan 06 06:34:34 +0000 2026")
 * @returns {String} ISO timestamp
 */
function parseTwitterDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toISOString();
  } catch (error) {
    console.error('[Twitter] Error parsing date:', dateStr, error.message);
    return null;
  }
}

/**
 * Parse Twitter profile from UserByScreenName response
 * @param {Object} apiResponse - The UserByScreenName API response
 * @returns {Object|null} Parsed profile object
 */
function parseProfileFromResponse(apiResponse) {
  try {
    if (!apiResponse || !apiResponse.responseData) {
      return null;
    }

    const responseData = apiResponse.responseData;
    const userResult = responseData?.data?.user?.result;
    
    if (!userResult || userResult.__typename !== 'User') {
      return null;
    }

    const legacy = userResult.legacy || {};
    const core = userResult.core || {};

    const profile = {
      user_id: userResult.rest_id,
      username: core.screen_name || legacy.screen_name,
      screen_name: core.screen_name || legacy.screen_name,
      full_name: core.name || legacy.name,
      avatar_url: userResult.avatar?.image_url || legacy.profile_image_url_https,
      profile_banner_url: legacy.profile_banner_url || null,
      followers_count: legacy.followers_count || 0,
      following_count: legacy.friends_count || 0,
      tweets_count: legacy.statuses_count || 0,
      verified: userResult.is_blue_verified || legacy.verified || false,
      description: legacy.description || '',
      location: legacy.location || '',
      raw_json: userResult
    };

    return profile;
  } catch (error) {
    console.error('[Twitter] Error parsing profile:', error.message);
    return null;
  }
}

/**
 * Save or update Twitter profile in database
 * @param {Object} profileData - Parsed profile data
 * @param {String} trackingId - Optional tracking ID
 * @param {String} userId - Optional user ID (UUID)
 * @returns {Promise<Object>} Saved profile object
 */
async function saveTwitterProfile(profileData, trackingId = null, userId = null) {
  try {
    if (!profileData || !profileData.username) {
      throw new Error('Profile data is required');
    }

    // Check if profile exists
    const { data: existingProfile } = await supabase
      .from('twitter_profiles')
      .select('*')
      .eq('username', profileData.username)
      .maybeSingle();

    const profileToSave = {
      username: profileData.username,
      screen_name: profileData.screen_name || profileData.username,
      full_name: profileData.full_name,
      avatar_url: profileData.avatar_url,
      profile_banner_url: profileData.profile_banner_url,
      user_id: profileData.user_id,
      followers_count: profileData.followers_count,
      following_count: profileData.following_count,
      tweets_count: profileData.tweets_count,
      verified: profileData.verified,
      description: profileData.description,
      location: profileData.location,
      updated_at: new Date().toISOString()
    };

    if (trackingId) {
      profileToSave.tracking_id = trackingId;
    }

    if (userId) {
      profileToSave.user_id_uuid = userId;
    }

    let result;
    if (existingProfile) {
      // Update existing profile
      const { data, error } = await supabase
        .from('twitter_profiles')
        .update(profileToSave)
        .eq('id', existingProfile.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Insert new profile
      const { data, error } = await supabase
        .from('twitter_profiles')
        .insert(profileToSave)
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Save snapshot
    await saveTwitterProfileSnapshot(result.id, profileData);

    return result;
  } catch (error) {
    console.error('[Twitter] Error saving profile:', error.message);
    throw error;
  }
}

/**
 * Save Twitter profile snapshot
 * @param {String} profileId - Profile UUID
 * @param {Object} profileData - Profile data
 */
async function saveTwitterProfileSnapshot(profileId, profileData) {
  try {
    await supabase
      .from('twitter_profile_snapshots')
      .insert({
        profile_id: profileId,
        followers_count: profileData.followers_count,
        following_count: profileData.following_count,
        tweets_count: profileData.tweets_count,
        raw_json: profileData.raw_json || {}
      });
  } catch (error) {
    console.error('[Twitter] Error saving profile snapshot:', error.message);
  }
}

/**
 * Save tweets to database
 * @param {String} profileId - Profile UUID
 * @param {Array} tweets - Array of parsed tweet objects
 * @returns {Promise<Object>} Result with saved count
 */
async function saveTweets(profileId, tweets) {
  try {
    if (!profileId || !tweets || tweets.length === 0) {
      return { saved: 0, updated: 0, errors: 0 };
    }

    let saved = 0;
    let updated = 0;
    let errors = 0;

    for (const tweet of tweets) {
      try {
        // Check if tweet exists
        const { data: existingTweet } = await supabase
          .from('twitter_tweets')
          .select('id')
          .eq('profile_id', profileId)
          .eq('tweet_id', tweet.tweet_id)
          .maybeSingle();

        const tweetToSave = {
          profile_id: profileId,
          tweet_id: tweet.tweet_id,
          conversation_id: tweet.conversation_id,
          text: tweet.text,
          full_text: tweet.full_text,
          created_at: tweet.created_at,
          // Engagement metrics
          like_count: tweet.like_count,
          retweet_count: tweet.retweet_count,
          reply_count: tweet.reply_count,
          quote_count: tweet.quote_count,
          view_count: tweet.view_count,
          bookmark_count: tweet.bookmark_count,
          // Tweet type flags
          is_reply: tweet.is_reply,
          is_retweet: tweet.is_retweet,
          is_quote: tweet.is_quote,
          is_pinned: tweet.is_pinned,
          favorited: tweet.favorited,
          bookmarked: tweet.bookmarked,
          retweeted: tweet.retweeted,
          // Relationships
          in_reply_to_tweet_id: tweet.in_reply_to_tweet_id,
          in_reply_to_user_id: tweet.in_reply_to_user_id,
          in_reply_to_username: tweet.in_reply_to_username,
          quoted_tweet_id: tweet.quoted_tweet_id,
          retweeted_tweet_id: tweet.retweeted_tweet_id,
          // Tweet metadata
          source: tweet.source,
          lang: tweet.lang,
          display_text_range: tweet.display_text_range,
          // Entities
          entities: tweet.entities,
          extended_entities: tweet.extended_entities,
          // Media information
          has_media: tweet.has_media,
          media_count: tweet.media_count,
          media_types: tweet.media_types,
          media_urls: tweet.media_urls,
          // Edit control
          is_edit_eligible: tweet.is_edit_eligible,
          editable_until_msecs: tweet.editable_until_msecs,
          edits_remaining: tweet.edits_remaining,
          edit_tweet_ids: tweet.edit_tweet_ids,
          // Views
          views_state: tweet.views_state,
          // Note tweet
          is_note_tweet: tweet.is_note_tweet,
          note_tweet_text: tweet.note_tweet_text,
          // Raw data
          raw_json: tweet.raw_json,
          updated_at: new Date().toISOString()
        };

        if (existingTweet) {
          // Update existing tweet
          const { error } = await supabase
            .from('twitter_tweets')
            .update(tweetToSave)
            .eq('id', existingTweet.id);

          if (error) throw error;
          updated++;

          // Save metrics snapshot
          await saveTweetMetrics(existingTweet.id, tweet);
        } else {
          // Insert new tweet
          const { data, error } = await supabase
            .from('twitter_tweets')
            .insert(tweetToSave)
            .select('id')
            .single();

          if (error) throw error;
          saved++;

          // Save initial metrics snapshot
          await saveTweetMetrics(data.id, tweet);
        }
      } catch (error) {
        console.error(`[Twitter] Error saving tweet ${tweet.tweet_id}:`, error.message);
        errors++;
      }
    }

    return { saved, updated, errors, total: tweets.length };
  } catch (error) {
    console.error('[Twitter] Error saving tweets:', error.message);
    throw error;
  }
}

/**
 * Save tweet metrics snapshot
 * @param {String} tweetDbId - Tweet UUID in database
 * @param {Object} tweetData - Tweet data with metrics
 */
async function saveTweetMetrics(tweetDbId, tweetData) {
  try {
    // Get previous metrics to calculate delta
    const { data: previousMetrics } = await supabase
      .from('twitter_tweet_metrics')
      .select('*')
      .eq('tweet_id', tweetDbId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const deltas = {
      like_delta: 0,
      retweet_delta: 0,
      reply_delta: 0,
      quote_delta: 0,
      view_delta: 0,
      bookmark_delta: 0
    };

    if (previousMetrics) {
      deltas.like_delta = (tweetData.like_count || 0) - (previousMetrics.like_count || 0);
      deltas.retweet_delta = (tweetData.retweet_count || 0) - (previousMetrics.retweet_count || 0);
      deltas.reply_delta = (tweetData.reply_count || 0) - (previousMetrics.reply_count || 0);
      deltas.quote_delta = (tweetData.quote_count || 0) - (previousMetrics.quote_count || 0);
      deltas.view_delta = (tweetData.view_count || 0) - (previousMetrics.view_count || 0);
      deltas.bookmark_delta = (tweetData.bookmark_count || 0) - (previousMetrics.bookmark_count || 0);
    }

    await supabase
      .from('twitter_tweet_metrics')
      .insert({
        tweet_id: tweetDbId,
        like_count: tweetData.like_count || 0,
        retweet_count: tweetData.retweet_count || 0,
        reply_count: tweetData.reply_count || 0,
        quote_count: tweetData.quote_count || 0,
        view_count: tweetData.view_count || 0,
        bookmark_count: tweetData.bookmark_count || 0,
        ...deltas
      });
  } catch (error) {
    console.error('[Twitter] Error saving tweet metrics:', error.message);
  }
}

/**
 * Track Twitter profile - fetch and save profile + tweets
 * @param {String} username - Twitter username
 * @param {String} trackingId - Optional tracking ID
 * @param {String} userId - Optional user ID (UUID)
 * @returns {Promise<Object>} Result object
 */
async function trackTwitterProfile(username, trackingId = null, userId = null) {
  try {
    console.log(`[Twitter] Tracking profile: ${username}`);

    // This would integrate with the x-tracker-playwright script
    // For now, we'll assume the data is already scraped and saved as JSON
    // In production, you'd call the playwright script here
    
    // Load scraped data if available
    const dataDir = path.join(__dirname, '../../x-tracker-playwright/data');
    const files = fs.existsSync(dataDir) 
      ? fs.readdirSync(dataDir).filter(f => f.includes(username) && f.endsWith('.json'))
      : [];
    
    if (files.length === 0) {
      throw new Error(`No scraped data found for ${username}. Run x-tracker-playwright first.`);
    }

    // Get most recent file
    const latestFile = files.sort().reverse()[0];
    const filePath = path.join(dataDir, latestFile);
    const scrapedData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Parse profile
    const profileData = parseProfileFromResponse(scrapedData.UserByScreenName[0]);
    if (!profileData) {
      throw new Error('Failed to parse profile data');
    }

    // Save profile
    const profile = await saveTwitterProfile(profileData, trackingId, userId);

    // Parse and save tweets
    const tweets = [];
    for (const userTweetsResponse of scrapedData.UserTweets) {
      const parsed = parseTweetsFromResponse(userTweetsResponse);
      tweets.push(...(parsed.tweets || []), ...(parsed.replies || []));
    }

    const saveResult = await saveTweets(profile.id, tweets);

    return {
      profile,
      tweets: saveResult,
      totalTweets: tweets.length
    };
  } catch (error) {
    console.error(`[Twitter] Error tracking profile ${username}:`, error.message);
    throw error;
  }
}

/**
 * Update tweet analytics - fetch latest metrics for all tweets
 * @param {String} profileId - Profile UUID
 * @returns {Promise<Object>} Result object
 */
async function updateTweetAnalytics(profileId) {
  try {
    // Get all tweets for this profile
    const { data: tweets, error } = await supabase
      .from('twitter_tweets')
      .select('id, tweet_id')
      .eq('profile_id', profileId);

    if (error) throw error;

    if (!tweets || tweets.length === 0) {
      return { updated: 0, message: 'No tweets found' };
    }

    // This would fetch fresh data from Twitter API
    // For now, we'll need to re-scrape or use the API
    // In production, you'd integrate with the playwright script or Twitter API
    
    console.log(`[Twitter] Updating analytics for ${tweets.length} tweets`);
    
    // TODO: Implement actual fetching of updated metrics
    // For now, return placeholder
    return {
      updated: 0,
      message: 'Analytics update requires re-scraping. Use trackTwitterProfile() to refresh data.'
    };
  } catch (error) {
    console.error('[Twitter] Error updating tweet analytics:', error.message);
    throw error;
  }
}

module.exports = {
  parseTweetsFromResponse,
  parseTweet,
  parseProfileFromResponse,
  saveTwitterProfile,
  saveTweets,
  saveTweetMetrics,
  trackTwitterProfile,
  updateTweetAnalytics
};

