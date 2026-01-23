const supabase = require('./supabase');

/**
 * Parse replies from Twitter API response
 * @param {Object} apiResponse - Twitter API response containing replies
 * @param {String} parentTweetId - The tweet ID these replies belong to
 * @returns {Array} Array of parsed reply objects
 */
function parseRepliesFromResponse(apiResponse, parentTweetId) {
  const replies = [];
  
  try {
    if (!apiResponse || !apiResponse.responseData) {
      return replies;
    }

    const responseData = apiResponse.responseData;
    
    // Navigate through the nested structure to find replies
    // Replies are typically in a conversation thread or search results
    const timeline = responseData?.data?.threaded_conversation_with_injections_v2?.instructions ||
                     responseData?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
                     responseData?.data?.user?.result?.timeline?.timeline?.instructions;
    
    if (!timeline || !Array.isArray(timeline)) {
      return replies;
    }

    // Find TimelineAddEntries instruction
    const addEntries = timeline.find(
      inst => inst.type === 'TimelineAddEntries' || inst.type === 'TimelineAddToModule'
    );

    if (!addEntries || !addEntries.entries) {
      return replies;
    }

    // Extract replies from entries
    for (const entry of addEntries.entries) {
      if (!entry.content || !entry.content.itemContent) {
        continue;
      }

      const itemContent = entry.content.itemContent;
      if (itemContent.itemType !== 'TimelineTweet') {
        continue;
      }

      const tweetResult = itemContent.tweet_results?.result;
      if (!tweetResult || tweetResult.__typename !== 'Tweet') {
        continue;
      }

      // Check if this is a reply to the parent tweet
      const legacy = tweetResult.legacy || {};
      if (legacy.in_reply_to_status_id_str === parentTweetId) {
        const reply = parseReply(tweetResult);
        if (reply) {
          replies.push(reply);
        }
      }
    }
  } catch (error) {
    console.error('[Twitter Replies] Error parsing replies:', error.message);
  }

  return replies;
}

/**
 * Parse a single reply object
 * @param {Object} tweetResult - Raw tweet data from API
 * @returns {Object|null} Parsed reply object
 */
function parseReply(tweetResult) {
  try {
    const legacy = tweetResult.legacy || {};
    const core = tweetResult.core || {};
    const userResult = core.user_results?.result;
    const userLegacy = userResult?.legacy || {};
    
    const reply = {
      reply_tweet_id: tweetResult.rest_id,
      reply_username: userLegacy.screen_name || userResult?.core?.screen_name,
      reply_user_id: userResult?.rest_id,
      reply_text: legacy.full_text || '',
      reply_created_at: parseTwitterDate(legacy.created_at),
      reply_like_count: legacy.favorite_count || 0,
      reply_retweet_count: legacy.retweet_count || 0,
      reply_reply_count: legacy.reply_count || 0,
      raw_json: tweetResult
    };

    return reply;
  } catch (error) {
    console.error('[Twitter Replies] Error parsing single reply:', error.message);
    return null;
  }
}

/**
 * Parse Twitter date string to ISO timestamp
 * @param {String} dateStr - Twitter date string
 * @returns {String} ISO timestamp
 */
function parseTwitterDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toISOString();
  } catch (error) {
    return null;
  }
}

/**
 * Save replies to database
 * @param {String} tweetDbId - Tweet UUID in database
 * @param {Array} replies - Array of parsed reply objects
 * @returns {Promise<Object>} Result with saved count
 */
async function saveReplies(tweetDbId, replies) {
  try {
    if (!tweetDbId || !replies || replies.length === 0) {
      return { saved: 0, updated: 0, errors: 0 };
    }

    let saved = 0;
    let updated = 0;
    let errors = 0;

    for (const reply of replies) {
      try {
        // Check if reply exists
        const { data: existingReply } = await supabase
          .from('twitter_replies')
          .select('id')
          .eq('tweet_id', tweetDbId)
          .eq('reply_tweet_id', reply.reply_tweet_id)
          .maybeSingle();

        const replyToSave = {
          tweet_id: tweetDbId,
          reply_tweet_id: reply.reply_tweet_id,
          reply_username: reply.reply_username,
          reply_user_id: reply.reply_user_id,
          reply_text: reply.reply_text,
          reply_created_at: reply.reply_created_at,
          reply_like_count: reply.reply_like_count,
          reply_retweet_count: reply.reply_retweet_count,
          reply_reply_count: reply.reply_reply_count,
          raw_json: reply.raw_json
        };

        if (existingReply) {
          // Update existing reply
          const { error } = await supabase
            .from('twitter_replies')
            .update(replyToSave)
            .eq('id', existingReply.id);

          if (error) throw error;
          updated++;
        } else {
          // Insert new reply
          const { error } = await supabase
            .from('twitter_replies')
            .insert(replyToSave);

          if (error) throw error;
          saved++;
        }
      } catch (error) {
        console.error(`[Twitter Replies] Error saving reply ${reply.reply_tweet_id}:`, error.message);
        errors++;
      }
    }

    return { saved, updated, errors, total: replies.length };
  } catch (error) {
    console.error('[Twitter Replies] Error saving replies:', error.message);
    throw error;
  }
}

/**
 * Fetch replies for a tweet
 * This would typically require calling Twitter API or scraping
 * For now, it's a placeholder that would integrate with the playwright script
 * @param {String} tweetId - Twitter tweet ID
 * @param {String} tweetDbId - Tweet UUID in database
 * @returns {Promise<Object>} Result object
 */
async function fetchRepliesForTweet(tweetId, tweetDbId) {
  try {
    // TODO: Integrate with x-tracker-playwright to fetch replies
    // This would navigate to the tweet's conversation page and scrape replies
    
    console.log(`[Twitter Replies] Fetching replies for tweet ${tweetId}`);
    
    // For now, return placeholder
    // In production, you'd:
    // 1. Use playwright to navigate to tweet conversation
    // 2. Parse replies from the API response
    // 3. Save them using saveReplies()
    
    return {
      fetched: 0,
      saved: 0,
      message: 'Reply fetching requires integration with x-tracker-playwright script'
    };
  } catch (error) {
    console.error('[Twitter Replies] Error fetching replies:', error.message);
    throw error;
  }
}

/**
 * Fetch replies for all tweets in a profile
 * @param {String} profileId - Profile UUID
 * @returns {Promise<Object>} Result object
 */
async function fetchRepliesForProfile(profileId) {
  try {
    // Get all tweets for this profile
    const { data: tweets, error } = await supabase
      .from('twitter_tweets')
      .select('id, tweet_id, reply_count')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(100); // Limit to most recent 100 tweets

    if (error) throw error;

    if (!tweets || tweets.length === 0) {
      return { processed: 0, message: 'No tweets found' };
    }

    let processed = 0;
    let totalReplies = 0;

    for (const tweet of tweets) {
      // Only fetch replies if the tweet has replies
      if (tweet.reply_count > 0) {
        try {
          const result = await fetchRepliesForTweet(tweet.tweet_id, tweet.id);
          processed++;
          totalReplies += result.saved || 0;
        } catch (error) {
          console.error(`[Twitter Replies] Error fetching replies for tweet ${tweet.tweet_id}:`, error.message);
        }
      }
    }

    return {
      processed,
      totalReplies,
      totalTweets: tweets.length
    };
  } catch (error) {
    console.error('[Twitter Replies] Error fetching replies for profile:', error.message);
    throw error;
  }
}

module.exports = {
  parseRepliesFromResponse,
  parseReply,
  saveReplies,
  fetchRepliesForTweet,
  fetchRepliesForProfile
};



















