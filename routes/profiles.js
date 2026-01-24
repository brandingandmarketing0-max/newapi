
const express = require("express");
const router = express.Router();
const supabase = require("../services/supabase");
const { trackProfile } = require("../services/tracking");
const { fetchReelData } = require("../services/instagram");
const { addJob } = require("../services/queue");

// Image proxy endpoint to bypass CORS
router.get("/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;
  
  if (!imageUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('[Image Proxy] Error:', error.message);
    res.status(500).json({ error: "Failed to proxy image", details: error.message });
  }
});

const extractShortcode = (input) => {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const regex = /instagram\.com\/(?:[A-Za-z0-9_.-]+\/)?(p|reel|reels|stories)\/([A-Za-z0-9_-]+)/i;
  const match = trimmed.match(regex);
  if (match && match[2]) {
    return match[2];
  }
  // fallback: assume user pasted the shortcode directly
  return trimmed.replace(/\//g, "");
};

// POST /profiles - Register and initial track (runs immediately via queue)
router.post("/", async (req, res) => {
  const { username, tracking_id, user_id } = req.body;
  
  // Store user_id in a way that tracking service can access it
  // We'll pass it through the job
  if (!username) return res.status(400).json({ error: "Username is required" });

  try {
    console.log(`\n📥 [API] POST /profiles - Adding ${username} to queue for immediate tracking...`);
    console.log(`   User-provided tracking_id: ${tracking_id || 'none (will generate new)'}`);
    console.log(`   User ID: ${user_id || 'none'}`);
    
    // If tracking_id is provided, use it (user-specific tracking)
    // Otherwise, generate a new one or use existing
    let finalTrackingId = tracking_id;
    
    if (!finalTrackingId) {
      // Check if profile already exists
      const { data: existingProfile } = await supabase
      .from("ig_profiles")
        .select("tracking_id")
        .eq("username", username)
        .maybeSingle();
      
      finalTrackingId = existingProfile?.tracking_id || require("crypto").randomBytes(8).toString('hex');
    } else {
      // User provided tracking_id - verify it's unique and not already used for this username by another user
      const { data: existingWithTrackingId } = await supabase
        .from("ig_profiles")
        .select("username, tracking_id")
        .eq("tracking_id", finalTrackingId)
        .maybeSingle();
      
      if (existingWithTrackingId && existingWithTrackingId.username !== username) {
        // Tracking ID exists for different username - this shouldn't happen, but generate new one
        console.log(`⚠️  Tracking ID ${finalTrackingId} exists for different username, generating new one`);
        finalTrackingId = require("crypto").randomBytes(8).toString('hex');
      }
    }
    
    // Add job to queue with immediate flag and custom tracking_id
    // The job will complete asynchronously, so we wait for it
    const result = await addJob(username, true, finalTrackingId, user_id);
    
    // Wait a moment for the profile to be created/updated in the database
    // Then fetch it to verify tracking_id is set
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for tracking to complete
    
    // Fetch profile with tracking_id - try by tracking_id first
    let profile = null;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!profile && attempts < maxAttempts) {
      if (finalTrackingId) {
        const { data: profileByTrackingId } = await supabase
          .from("ig_profiles")
          .select("tracking_id, username, id")
          .eq("tracking_id", finalTrackingId)
          .maybeSingle();
        
        if (profileByTrackingId) {
          profile = profileByTrackingId;
          console.log(`✅ [API] Found profile by tracking_id: ${finalTrackingId}`);
          break;
        }
      }
      
      // If not found by tracking_id, try by username
      const { data: profileByUsername } = await supabase
        .from("ig_profiles")
        .select("tracking_id, username, id")
        .eq("username", username)
        .maybeSingle();
      
      if (profileByUsername) {
        // If we have a custom tracking_id but profile has different one, update it
        if (finalTrackingId && profileByUsername.tracking_id !== finalTrackingId) {
          console.log(`🔄 [API] Updating profile ${username} with new tracking_id ${finalTrackingId} (attempt ${attempts + 1})`);
          const { data: updatedProfile } = await supabase
            .from("ig_profiles")
            .update({ tracking_id: finalTrackingId })
            .eq("id", profileByUsername.id)
      .select("tracking_id, username")
      .single();
    
          if (updatedProfile && updatedProfile.tracking_id === finalTrackingId) {
            profile = updatedProfile;
            console.log(`✅ [API] Profile updated with tracking_id: ${finalTrackingId}`);
            break;
          }
        } else if (profileByUsername.tracking_id === finalTrackingId) {
          profile = profileByUsername;
          break;
        }
      }
      
      attempts++;
      if (attempts < maxAttempts) {
        console.log(`⏳ [API] Waiting for profile to be created/updated (attempt ${attempts + 1}/${maxAttempts})...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      }
    }
    
    if (!profile) {
      // Profile should exist after tracking, but if not, return error
      console.error(`❌ [API] Profile ${username} not found after tracking (tried ${maxAttempts} times)`);
      return res.status(500).json({ error: "Profile was tracked but not found in database. Please try refreshing the page." });
    }
    
    console.log(`✅ [API] Profile ${username} tracked successfully (tracking_id: ${profile.tracking_id || finalTrackingId})`);
    res.json({ 
      success: true,
      username: profile.username,
      tracking_id: profile.tracking_id || finalTrackingId,
      profile: result?.profile || profile
    });
  } catch (err) {
    console.error(`❌ [API] Failed to track ${username}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /profiles/:username/refresh - Refresh tracking data (runs immediately via queue)
router.post("/:username/refresh", async (req, res) => {
  const { username } = req.params;
  try {
    console.log(`\n📥 [API] POST /profiles/${username}/refresh - Adding to queue for immediate refresh...`);
    
    // Add job to queue with immediate flag
    const result = await addJob(username, true);
    
    const { data: profile } = await supabase
      .from("ig_profiles")
      .select("tracking_id, username")
      .eq("id", result.profile.id)
      .single();
    
    console.log(`✅ [API] Profile ${username} refreshed successfully`);
    res.json({ ...result, tracking_id: profile?.tracking_id });
  } catch (err) {
    console.error(`❌ [API] Failed to refresh ${username}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /tracking/:tracking_id - Get profile by tracking ID
// IMPORTANT: This route must be defined BEFORE /:username to avoid route conflicts
router.get("/tracking/:tracking_id", async (req, res) => {
  const { tracking_id } = req.params;
  console.log(`\n📥 [API] GET /profiles/tracking/${tracking_id} - Request received`);
  console.log(`   Route matched: /tracking/:tracking_id`);
  console.log(`   tracking_id param: ${tracking_id}`);
  
  if (!tracking_id) {
    console.error(`❌ [API] Tracking ID is missing`);
    return res.status(400).json({ error: "Tracking ID is required" });
  }
  
  // First, check if any profile exists with this tracking_id
  const { data: allProfiles, error: checkError } = await supabase
    .from("ig_profiles")
    .select("id, username, tracking_id")
    .eq("tracking_id", tracking_id);
  
  console.log(`   Found ${allProfiles?.length || 0} profiles with tracking_id ${tracking_id}`);
  if (allProfiles && allProfiles.length > 0) {
    console.log(`   Profiles:`, allProfiles.map(p => `${p.username} (${p.tracking_id})`));
  }
  
  const { data: profile, error: profileError } = await supabase
    .from("ig_profiles")
    .select("*")
    .eq("tracking_id", tracking_id)
    .maybeSingle();

  if (profileError) {
    console.error(`❌ [API] Error fetching profile by tracking_id ${tracking_id}:`, profileError.message);
    console.error(`   Error code: ${profileError.code}, details: ${JSON.stringify(profileError)}`);
    return res.status(500).json({ error: "Database error", details: profileError.message });
  }
  
  if (!profile) {
    console.error(`❌ [API] Tracking ID not found: ${tracking_id}`);
    // Check if tracking_id exists but with different case or format
    const { data: similarProfiles } = await supabase
      .from("ig_profiles")
      .select("tracking_id, username")
      .ilike("tracking_id", `%${tracking_id}%`);
    if (similarProfiles && similarProfiles.length > 0) {
      console.log(`   Similar tracking_ids found:`, similarProfiles);
    }
    return res.status(404).json({ error: "Tracking not found", tracking_id });
  }
  
  console.log(`✅ [API] Profile found: ${profile.username} (ID: ${profile.id}, tracking_id: ${profile.tracking_id})`);

  // IMPORTANT: For user-specific tracking, only show snapshots created AFTER this tracking session started
  // Use updated_at as the tracking session start time (when tracking_id was assigned)
  const trackingStartTime = profile.updated_at || profile.created_at;
  const trackingStartDateObj = new Date(trackingStartTime);
  // Subtract 1 second to ensure we include the first snapshot (created at nearly the same time)
  trackingStartDateObj.setSeconds(trackingStartDateObj.getSeconds() - 1);
  const trackingStartTimeAdjusted = trackingStartDateObj.toISOString();
  const trackingStartDate = trackingStartDateObj.toISOString().split("T")[0]; // Date string for daily metrics filtering
  
  console.log(`   Tracking session started at: ${trackingStartTime}`);
  console.log(`   Adjusted start time (to include first snapshot): ${trackingStartTimeAdjusted}`);
  
  // Get latest snapshot - only from this tracking session
  // If the profile was updated (tracking_id changed), only show snapshots after that time
  let snapshotQuery = supabase
    .from("ig_profile_snapshots")
    .select("*")
    .eq("profile_id", profile.id);
  
  // Filter by tracking session start time to ensure fresh start
  // Use >= to include the first snapshot (created at nearly the same time as updated_at)
  snapshotQuery = snapshotQuery.gte("captured_at", trackingStartTimeAdjusted);
  
  const { data: snapshot, error: snapshotError } = await snapshotQuery
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (snapshotError) {
    console.error(`Error fetching snapshot for tracking ${tracking_id}:`, snapshotError.message);
  } else if (snapshot) {
    console.log(`✅ Found snapshot from this tracking session (created at ${snapshot.captured_at})`);
  } else {
    console.log(`ℹ️  No snapshots found for this tracking session yet (will show after first tracking)`);
  }

  // Get latest delta - only from this tracking session
  // Deltas are created when snapshots are compared, so they're already session-specific
  const { data: delta, error: deltaError } = await supabase
    .from("ig_profile_deltas")
    .select("*")
    .eq("profile_id", profile.id)
    .gte("created_at", trackingStartTimeAdjusted) // Only deltas from this tracking session (include first one)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (deltaError) {
    console.error(`Error fetching delta for tracking ${tracking_id}:`, deltaError.message);
  }

  // ALSO get daily metrics to show actual daily growth (more accurate)
  // Only get daily metrics from this tracking session (after tracking started)
  // trackingStartDate is already declared above (line 227)
  const today = new Date().toISOString().split("T")[0];
  
  // Get today's metrics if it's after tracking started
  let todayMetrics = null;
  if (today >= trackingStartDate) {
    const { data: todayData } = await supabase
    .from("ig_profile_daily_metrics")
    .select("*")
    .eq("profile_id", profile.id)
    .eq("date", today)
    .maybeSingle();
    todayMetrics = todayData;
  }

  // If no today's metrics, get the most recent daily metrics from this tracking session
  let dailyMetrics = todayMetrics;
  if (!dailyMetrics) {
    const { data: recentMetrics } = await supabase
      .from("ig_profile_daily_metrics")
      .select("*")
      .eq("profile_id", profile.id)
      .gte("date", trackingStartDate) // Only metrics from this tracking session
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    dailyMetrics = recentMetrics;
    if (dailyMetrics) {
      console.log(`\n📊 [API] Today's metrics not found, using most recent daily metrics (date: ${dailyMetrics.date})`);
    }
  }

  // Use daily metrics if available (more accurate for daily growth), otherwise use delta
  // ALWAYS prefer daily metrics over delta table for followers_diff (even if delta is 0)
  let finalDelta = delta || {
    followers_diff: 0,
    following_diff: 0,
    media_diff: 0,
    clips_diff: 0
  };
  
  if (dailyMetrics) {
    console.log(`\n📊 [API] Found daily metrics for tracking ${tracking_id} (date: ${dailyMetrics.date})`);
    console.log(`   Daily metrics followers_delta: ${dailyMetrics.followers_delta?.toLocaleString() ?? 'null/undefined'} (type: ${typeof dailyMetrics.followers_delta})`);
    console.log(`   Daily metrics followers_open: ${dailyMetrics.followers_open?.toLocaleString() || 0}`);
    console.log(`   Daily metrics followers_close: ${dailyMetrics.followers_close?.toLocaleString() || 0}`);
    
    // Calculate delta from daily metrics if followers_delta is null/undefined
    // This matches what the graph uses (followers_close - followers_open)
    let dailyFollowersDelta = dailyMetrics.followers_delta;
    
    // If followers_delta is null/undefined, calculate it from open/close (same as graph)
    if ((dailyFollowersDelta === null || dailyFollowersDelta === undefined) 
        && dailyMetrics.followers_open !== null && dailyMetrics.followers_close !== null) {
      dailyFollowersDelta = dailyMetrics.followers_close - dailyMetrics.followers_open;
      console.log(`   ⚠️  followers_delta was ${dailyMetrics.followers_delta}, calculating from open/close: ${dailyMetrics.followers_close} - ${dailyMetrics.followers_open} = ${dailyFollowersDelta}`);
    }
    
    // If still null/undefined, use 0
    if (dailyFollowersDelta === null || dailyFollowersDelta === undefined) {
      dailyFollowersDelta = 0;
    }
    
    console.log(`   📊 Using dailyFollowersDelta: ${dailyFollowersDelta?.toLocaleString() || 0}`);
    
    // Create a delta object from daily metrics (always include followers_diff)
    finalDelta = {
      ...finalDelta,
      followers_diff: dailyFollowersDelta, // ALWAYS use daily metrics value (calculated if needed)
      // Keep other deltas from the latest delta record if available, otherwise 0
      following_diff: finalDelta.following_diff ?? 0,
      media_diff: finalDelta.media_diff ?? 0,
      clips_diff: finalDelta.clips_diff ?? 0,
      created_at: dailyMetrics.created_at || finalDelta.created_at,
      source: 'daily_metrics'
    };
    
    console.log(`   ✅ Final followers_diff from daily metrics: ${finalDelta.followers_diff?.toLocaleString() || 0} (type: ${typeof finalDelta.followers_diff})`);
    if (finalDelta.followers_diff > 0) {
      console.log(`   🟢 FOLLOWERS GROWTH DETECTED: +${finalDelta.followers_diff.toLocaleString()} - This WILL show on the Followers card!`);
    } else if (finalDelta.followers_diff === 0) {
      console.log(`   ⚠️  Followers delta is 0 - this might mean:`);
      console.log(`      1. No growth today yet`);
      console.log(`      2. Daily metrics row was just created (delta starts at 0)`);
      console.log(`      3. Need to wait for next refresh to see growth`);
    } else if (finalDelta.followers_diff < 0) {
      console.log(`   🔴 Followers decreased: ${finalDelta.followers_diff.toLocaleString()}`);
    }
  } else {
    console.log(`\n📊 [API] No daily metrics found for tracking ${tracking_id}, using delta table`);
    if (delta) {
      console.log(`   Delta table followers_diff: ${delta.followers_diff?.toLocaleString() || 0}`);
    }
  }

  // Log delta for debugging
  if (finalDelta) {
    console.log(`\n📊 [API] Final Delta for tracking ${tracking_id} (${finalDelta.source === 'daily_metrics' ? 'from daily metrics' : 'from delta table'}):`);
    console.log(`   Followers: ${finalDelta.followers_diff > 0 ? '+' : ''}${finalDelta.followers_diff?.toLocaleString() || 0}`);
    console.log(`   Following: ${finalDelta.following_diff > 0 ? '+' : ''}${finalDelta.following_diff?.toLocaleString() || 0}`);
    console.log(`   Media: ${finalDelta.media_diff > 0 ? '+' : ''}${finalDelta.media_diff?.toLocaleString() || 0}`);
    console.log(`   Clips: ${finalDelta.clips_diff > 0 ? '+' : ''}${finalDelta.clips_diff?.toLocaleString() || 0}`);
    if (finalDelta.followers_diff > 0) {
      console.log(`   🟢 FOLLOWERS GROWTH: +${finalDelta.followers_diff.toLocaleString()} - This should show on the Followers card!`);
    }
  }

  // Always return a delta object, even if null/empty (frontend expects an object)
  const responseDelta = finalDelta || {
    followers_diff: 0,
    following_diff: 0,
    media_diff: 0,
    clips_diff: 0
  };

  const response = { 
    profile, 
    snapshot: snapshot || null, 
    delta: responseDelta
  };
  
  console.log(`✅ [API] Sending response for tracking ${tracking_id} (has snapshot: ${!!snapshot}, has delta: ${!!finalDelta})`);
  if (responseDelta && responseDelta.followers_diff > 0) {
    console.log(`   🟢 FOLLOWERS GROWTH IN RESPONSE: +${responseDelta.followers_diff.toLocaleString()}`);
  } else if (!finalDelta) {
    console.log(`   ⚠️  No delta found - returning default delta with 0 values`);
  }
  res.json(response);
});

// GET /profiles - List all tracked profiles with latest snapshot and delta
router.get("/", async (req, res) => {
  const { data: profiles, error } = await supabase
    .from("ig_profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  if (!profiles || profiles.length === 0) return res.json({ data: [] });

  // Fetch latest snapshot and delta for each profile in parallel
  const profilesWithData = await Promise.all(
    profiles.map(async (profile) => {
      // Get latest snapshot
      const { data: snapshot } = await supabase
        .from("ig_profile_snapshots")
        .select("*")
        .eq("profile_id", profile.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get latest delta
      const { data: delta } = await supabase
        .from("ig_profile_deltas")
        .select("*")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        ...profile,
        latest_snapshot: snapshot || null, // Also include as latest_snapshot for compatibility
        snapshot: snapshot || null,
        delta: delta || null,
      };
    })
  );

  res.json({ data: profilesWithData });
});

// GET /profiles/graph-data - Get daily growth data for ALL profiles (optimized for dashboard graph)
// Query params: ?days=14&metric=followers|views|likes|comments
// IMPORTANT: This route MUST be before /:username to avoid route conflicts
router.get("/graph-data", async (req, res) => {
  const { days, metric } = req.query;
  const daysNum = Number(days) || 14;
  const metricType = metric || 'followers'; // followers, views, likes, comments
  
  console.log(`\n📊 [API] GET /profiles/graph-data (days: ${daysNum}, metric: ${metricType})`);

  try {
    // Get all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("ig_profiles")
      .select("id, username, tracking_id, updated_at, created_at")
      .order("created_at", { ascending: false });

    if (profilesError) {
      console.error(`❌ [API] Error fetching profiles:`, profilesError.message);
      return res.status(500).json({ error: "Database error", details: profilesError.message });
    }

    if (!profiles || profiles.length === 0) {
      console.log(`ℹ️  [API] No profiles found`);
      return res.json({ data: [], profiles: [] });
    }

    console.log(`✅ [API] Found ${profiles.length} profile(s)`);

    // Calculate date range
    const since = new Date();
    since.setDate(since.getDate() - daysNum);
    const startDate = since.toISOString().split("T")[0];

    // Fetch daily metrics for all profiles in parallel
    const profilesData = await Promise.all(
      profiles.map(async (profile) => {
        const trackingStartTime = profile.updated_at || profile.created_at;
        const trackingStartDate = new Date(trackingStartTime).toISOString().split("T")[0];
        
        // Use the requested days range (don't filter by tracking start date for graph - show all available data)
        // This way the graph can show data even if profiles were tracked before the user started tracking
        const queryStartDate = startDate;

        // Get daily metrics for this profile
        const { data: metrics, error: metricsError } = await supabase
          .from("ig_profile_daily_metrics")
          .select("*")
          .eq("profile_id", profile.id)
          .gte("date", queryStartDate)
          .order("date", { ascending: true });

        if (metricsError) {
          console.error(`❌ [API] Error fetching metrics for @${profile.username}:`, metricsError.message);
        } else {
          console.log(`   @${profile.username}: Found ${metrics?.length || 0} daily metrics (queryStartDate: ${queryStartDate}, trackingStartDate: ${trackingStartDate})`);
        }

        // If metric is views/likes/comments, we also need reel metrics
        const reelDeltasByDate = new Map();
        
        if (metricType === 'views' || metricType === 'likes' || metricType === 'comments') {
          // Get all reels for this profile
          const { data: reels } = await supabase
            .from("ig_profile_reels")
            .select("id")
            .eq("profile_id", profile.id);

          const reelIds = (reels || []).map(r => r.id);

          if (reelIds.length > 0 && metrics && metrics.length > 0) {
            // Fetch all reel metrics for the date range
            const { data: allReelMetrics } = await supabase
              .from("ig_reel_metrics")
              .select("*")
              .in("reel_id", reelIds)
              .gte("captured_at", queryStartDate + 'T00:00:00.000Z')
              .order("captured_at", { ascending: true });

            // Group by reel_id
            const reelMetricsMap = new Map();
            allReelMetrics?.forEach(m => {
              if (!reelMetricsMap.has(m.reel_id)) {
                reelMetricsMap.set(m.reel_id, []);
              }
              reelMetricsMap.get(m.reel_id).push(m);
            });

            // For each daily metric date, calculate reel growth for that date
            metrics.forEach((dailyMetric) => {
              const metricDate = dailyMetric.date;
              const nextDate = new Date(metricDate);
              nextDate.setDate(nextDate.getDate() + 1);
              const nextDateStr = nextDate.toISOString().split("T")[0];

              let totalReelViews = 0;
              let totalReelLikes = 0;
              let totalReelComments = 0;

              reelMetricsMap.forEach((reelMetrics) => {
                reelMetrics.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
                
                // Find metrics for this specific date
                const dateMetrics = reelMetrics.filter(m => {
                  const capturedDate = new Date(m.captured_at).toISOString().split("T")[0];
                  return capturedDate === metricDate || capturedDate === nextDateStr;
                });
                
                if (dateMetrics.length > 0) {
                  // Get the latest metric for this date
                  const latest = dateMetrics[dateMetrics.length - 1];
                  // Get the previous metric (before this date)
                  const previousIndex = reelMetrics.indexOf(latest) - 1;
                  
                  if (previousIndex >= 0) {
                    const previous = reelMetrics[previousIndex];
                    totalReelViews += Math.max(0, (latest.view_count || 0) - (previous.view_count || 0));
                    totalReelLikes += Math.max(0, (latest.like_count || 0) - (previous.like_count || 0));
                    totalReelComments += Math.max(0, (latest.comment_count || 0) - (previous.comment_count || 0));
                  }
                }
              });

              reelDeltasByDate.set(metricDate, {
                views: totalReelViews,
                likes: totalReelLikes,
                comments: totalReelComments,
              });
            });
          }
        }

        // Format metrics for this profile
        const profilePoints = (metrics || []).map((metric) => {
          let value = 0;
          
          if (metricType === 'followers') {
            value = metric.followers_delta || 0;
          } else if (metricType === 'views') {
            const dateStr = metric.date;
            const reelData = reelDeltasByDate.get(dateStr) || { views: 0 };
            value = reelData.views;
          } else if (metricType === 'likes') {
            const dateStr = metric.date;
            const reelData = reelDeltasByDate.get(dateStr) || { likes: 0 };
            value = reelData.likes;
          } else if (metricType === 'comments') {
            const dateStr = metric.date;
            const reelData = reelDeltasByDate.get(dateStr) || { comments: 0 };
            value = reelData.comments;
          }

          return {
            date: metric.date,
            value: value,
          };
        });

        return {
          username: profile.username,
          tracking_id: profile.tracking_id,
          points: profilePoints,
        };
      })
    );

    // Merge all profiles into a date-indexed structure
    const dateMap = new Map();

    profilesData.forEach((profile) => {
      const label = `@${profile.username}`;
      profile.points.forEach((point) => {
        const date = point.date;
        if (!date) return;

        if (!dateMap.has(date)) {
          dateMap.set(date, { date });
        }
        dateMap.get(date)[label] = point.value;
      });
    });

    // Convert to array and sort by date
    const chartData = Array.from(dateMap.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    console.log(`✅ [API] Graph data generated: ${chartData.length} data points across ${profilesData.length} profile(s)`);
    if (chartData.length > 0) {
      console.log(`   Date range: ${chartData[0].date} to ${chartData[chartData.length - 1].date}`);
    }

    res.json({
      data: chartData,
      profiles: profilesData.map(p => ({ username: p.username, tracking_id: p.tracking_id })),
      metric: metricType,
      days: daysNum,
    });
  } catch (error) {
    console.error(`❌ [API] Error fetching graph data:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /profiles/:username - Latest snapshot + stats
router.get("/:username", async (req, res) => {
  const { username } = req.params;
  console.log(`\n📥 [API] GET /profiles/${username} - Request received`);

  // 1. Get Profile
  const { data: profile, error: profileError } = await supabase
    .from("ig_profiles")
    .select("*")
    .eq("username", username)
    .single();

  if (profileError || !profile) {
    console.error(`❌ [API] Profile not found: ${username}`, profileError?.message);
    return res.status(404).json({ error: "Profile not found" });
  }
  
  console.log(`✅ [API] Profile found: ${username} (ID: ${profile.id})`);

  // 2. Get Latest Snapshot
  const { data: snapshot, error: snapshotError } = await supabase
    .from("ig_profile_snapshots")
    .select("*")
    .eq("profile_id", profile.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (snapshotError) {
    console.error(`Error fetching snapshot for ${username}:`, snapshotError.message);
  }
  
  if (!snapshot) {
    console.log(`⚠️  No snapshot found for ${username} - profile may not have been tracked yet`);
  }

  // 3. Get Last Delta (if exists) - Get the MOST RECENT delta
  // This delta compares the latest snapshot with the previous one
  const { data: delta, error: deltaError } = await supabase
    .from("ig_profile_deltas")
    .select("*")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (deltaError) {
    console.error(`Error fetching delta for ${username}:`, deltaError.message);
  }

  // 4. ALSO get daily metrics to show actual daily growth (more accurate)
  // First try today's metrics, then fall back to most recent daily metrics
  const today = new Date().toISOString().split("T")[0];
  const { data: todayMetrics } = await supabase
    .from("ig_profile_daily_metrics")
    .select("*")
    .eq("profile_id", profile.id)
    .eq("date", today)
    .maybeSingle();

  // If no today's metrics, get the most recent daily metrics
  let dailyMetrics = todayMetrics;
  if (!dailyMetrics) {
    const { data: recentMetrics } = await supabase
      .from("ig_profile_daily_metrics")
      .select("*")
      .eq("profile_id", profile.id)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    dailyMetrics = recentMetrics;
    if (dailyMetrics) {
      console.log(`\n📊 [API] Today's metrics not found, using most recent daily metrics (date: ${dailyMetrics.date})`);
    }
  }

  // Use daily metrics if available (more accurate for daily growth), otherwise use delta
  // ALWAYS prefer daily metrics over delta table for followers_diff (even if delta is 0)
  let finalDelta = delta || {
    followers_diff: 0,
    following_diff: 0,
    media_diff: 0,
    clips_diff: 0
  };
  
  if (dailyMetrics) {
    console.log(`\n📊 [API] Found daily metrics for ${username} (date: ${dailyMetrics.date})`);
    console.log(`   Daily metrics followers_delta: ${dailyMetrics.followers_delta?.toLocaleString() ?? 'null/undefined'} (type: ${typeof dailyMetrics.followers_delta})`);
    console.log(`   Daily metrics followers_open: ${dailyMetrics.followers_open?.toLocaleString() || 0}`);
    console.log(`   Daily metrics followers_close: ${dailyMetrics.followers_close?.toLocaleString() || 0}`);
    
    // Calculate delta from daily metrics if followers_delta is 0 or null
    // This matches what the graph uses (followers_close - followers_open)
    let dailyFollowersDelta = dailyMetrics.followers_delta;
    
    // If followers_delta is null/undefined, calculate it from open/close (same as graph)
    if ((dailyFollowersDelta === null || dailyFollowersDelta === undefined) 
        && dailyMetrics.followers_open !== null && dailyMetrics.followers_close !== null) {
      dailyFollowersDelta = dailyMetrics.followers_close - dailyMetrics.followers_open;
      console.log(`   ⚠️  followers_delta was ${dailyMetrics.followers_delta}, calculating from open/close: ${dailyMetrics.followers_close} - ${dailyMetrics.followers_open} = ${dailyFollowersDelta}`);
    }
    
    // If still null/undefined, use 0
    if (dailyFollowersDelta === null || dailyFollowersDelta === undefined) {
      dailyFollowersDelta = 0;
    }
    
    console.log(`   📊 Using dailyFollowersDelta: ${dailyFollowersDelta?.toLocaleString() || 0}`);
    
    // Create a delta object from daily metrics (always include followers_diff)
    finalDelta = {
      ...finalDelta,
      followers_diff: dailyFollowersDelta, // ALWAYS use daily metrics value (calculated if needed)
      // Keep other deltas from the latest delta record if available, otherwise 0
      following_diff: finalDelta.following_diff ?? 0,
      media_diff: finalDelta.media_diff ?? 0,
      clips_diff: finalDelta.clips_diff ?? 0,
      created_at: dailyMetrics.created_at || finalDelta.created_at,
      source: 'daily_metrics' // Mark that this came from daily metrics
    };
    
    console.log(`   ✅ Final followers_diff from daily metrics: ${finalDelta.followers_diff?.toLocaleString() || 0} (type: ${typeof finalDelta.followers_diff})`);
    if (finalDelta.followers_diff > 0) {
      console.log(`   🟢 FOLLOWERS GROWTH DETECTED: +${finalDelta.followers_diff.toLocaleString()} - This WILL show on the Followers card!`);
    } else if (finalDelta.followers_diff === 0) {
      console.log(`   ⚠️  Followers delta is 0 - this might mean:`);
      console.log(`      1. No growth today yet`);
      console.log(`      2. Daily metrics row was just created (delta starts at 0)`);
      console.log(`      3. Need to wait for next refresh to see growth`);
    } else if (finalDelta.followers_diff < 0) {
      console.log(`   🔴 Followers decreased: ${finalDelta.followers_diff.toLocaleString()}`);
    }
  } else {
    console.log(`\n📊 [API] No daily metrics found for ${username}, using delta table`);
    if (delta) {
      console.log(`   Delta table followers_diff: ${delta.followers_diff?.toLocaleString() || 0}`);
    }
  }

  // Log delta for debugging
  if (finalDelta) {
    console.log(`\n📊 [API] Final Delta for ${username} (${finalDelta.source === 'daily_metrics' ? 'from daily metrics' : 'from delta table'}, created: ${finalDelta.created_at}):`);
    if (finalDelta.base_snapshot_id) {
      console.log(`   Base Snapshot ID: ${finalDelta.base_snapshot_id}`);
      console.log(`   Compare Snapshot ID: ${finalDelta.compare_snapshot_id}`);
    }
    console.log(`   Followers: ${finalDelta.followers_diff > 0 ? '+' : ''}${finalDelta.followers_diff?.toLocaleString() || 0}`);
    console.log(`   Following: ${finalDelta.following_diff > 0 ? '+' : ''}${finalDelta.following_diff?.toLocaleString() || 0}`);
    console.log(`   Media: ${finalDelta.media_diff > 0 ? '+' : ''}${finalDelta.media_diff?.toLocaleString() || 0}`);
    console.log(`   Clips: ${finalDelta.clips_diff > 0 ? '+' : ''}${finalDelta.clips_diff?.toLocaleString() || 0}`);
    
    // Warn if delta is 0
    if (finalDelta.followers_diff === 0 && finalDelta.following_diff === 0 && finalDelta.media_diff === 0 && finalDelta.clips_diff === 0) {
      console.log(`   ⚠️  All deltas are 0 - this might mean:`);
      console.log(`      1. Values haven't changed since last refresh`);
      console.log(`      2. This is comparing with the wrong snapshot`);
      console.log(`      3. Instagram hasn't updated the profile yet`);
    } else if (finalDelta.followers_diff > 0) {
      console.log(`   ✅ FOLLOWERS GROWTH: +${finalDelta.followers_diff.toLocaleString()} - This should show on the Followers card!`);
    }
  } else {
    console.log(`\n📊 [API] No delta found for ${username} (first tracking or no previous snapshot)`);
  }

  // Always return a delta object, even if null/empty (frontend expects an object)
  const responseDelta = finalDelta || {
    followers_diff: 0,
    following_diff: 0,
    media_diff: 0,
    clips_diff: 0
  };

  const response = { 
    profile, 
    snapshot: snapshot || null, 
    delta: responseDelta
  };
  
  console.log(`✅ [API] Sending response for ${username} (has snapshot: ${!!snapshot}, has delta: ${!!finalDelta})`);
  if (responseDelta && responseDelta.followers_diff > 0) {
    console.log(`   🟢 FOLLOWERS GROWTH IN RESPONSE: +${responseDelta.followers_diff.toLocaleString()}`);
  } else if (!finalDelta) {
    console.log(`   ⚠️  No delta found - returning default delta with 0 values`);
  }
  res.json(response);
});

// GET /profiles/:username/reels - Get stored reels with growth metrics
router.get("/:username/reels", async (req, res) => {
  const { username } = req.params;
  const offset = Number.isNaN(Number(req.query.offset)) ? 0 : Number(req.query.offset);
  const limitParam = Number(req.query.limit);
  const limit = Number.isNaN(limitParam) ? 12 : Math.max(limitParam, 1); // Allow unlimited (no cap)

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) return res.status(404).json({ error: "Profile not found" });

  // Get profile's current followers count for viewer-to-follower ratio calculation
  const { data: latestSnapshot } = await supabase
    .from("ig_profile_snapshots")
    .select("followers")
    .eq("profile_id", profile.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const totalFollowers = latestSnapshot?.followers || 0;

  const { data: reels, error, count } = await supabase
    .from("ig_profile_reels")
    .select("*", { count: "exact" })
    .eq("profile_id", profile.id)
    .eq("is_video", true)
    .order("taken_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });

  // Handle empty reels array
  if (!reels || reels.length === 0) {
    return res.json({ data: [], total: count || 0, offset, limit });
  }

  // Calculate growth for EACH reel individually by comparing current metrics with previous snapshot
  console.log(`\n📊 [API] Calculating growth for ${reels.length} reels/posts individually...`);
  
  const reelsWithGrowth = reels.map((reel) => {
      // Use stored deltas from ig_profile_reels table
      const viewGrowth = reel.view_delta || 0;
      const likeGrowth = reel.like_delta || 0;
      const commentGrowth = reel.comment_delta || 0;

      // Current values from the reel record (most recent)
      const currViews = reel.view_count || 0;
      const currLikes = reel.like_count || 0;
      const currComments = reel.comment_count || 0;
      
      // Demo data for metrics not available in public API
      // In production, these would come from Instagram Insights API
      const currShares = reel.share_count || Math.floor(currViews * 0.02); // Demo: ~2% of views
      const currSaves = reel.save_count || Math.floor(currViews * 0.05); // Demo: ~5% of views
      const currRetweets = 0; // Retweets are Twitter-specific, not Instagram

      // Log growth from stored deltas
      if (viewGrowth !== 0 || likeGrowth !== 0 || commentGrowth !== 0) {
        console.log(`\n🎬 [API] Reel ${reel.shortcode} Growth (from stored deltas):`);
        console.log(`   Views: ${viewGrowth > 0 ? '+' : ''}${viewGrowth.toLocaleString()}, Likes: ${likeGrowth > 0 ? '+' : ''}${likeGrowth.toLocaleString()}, Comments: ${commentGrowth > 0 ? '+' : ''}${commentGrowth.toLocaleString()}`);
      }

      // Calculate Engagement Rate: (LIKES + COMMENTS + SHARES + SAVES + RETWEETS) / TOTAL VIEWS
      const totalEngagements = currLikes + currComments + currShares + currSaves + currRetweets;
      const engagementRate = currViews > 0 
        ? (totalEngagements / currViews) * 100 // Convert to percentage
        : 0;
      
      // Calculate Viewer to Follower Ratio: (TOTAL VIEWS / TOTAL FOLLOWERS) × 100
      const viewerToFollowerRatio = totalFollowers > 0
        ? (currViews / totalFollowers) * 100
        : 0;
      
      // Log engagement and viewer-to-follower ratio calculations
      console.log(`\n📊 [API] Reel ${reel.shortcode} Engagement & Viewer-to-Follower Ratio Calculation:`);
      console.log(`   Engagements: Likes=${currLikes.toLocaleString()} + Comments=${currComments.toLocaleString()} + Shares=${currShares.toLocaleString()} + Saves=${currSaves.toLocaleString()} + Retweets=${currRetweets.toLocaleString()} = ${totalEngagements.toLocaleString()}`);
      console.log(`   📊 Engagement Rate: (${totalEngagements.toLocaleString()} / ${currViews.toLocaleString()}) × 100 = ${engagementRate.toFixed(2)}%`);
      console.log(`   📈 Viewer to Follower Ratio: (${currViews.toLocaleString()} / ${totalFollowers.toLocaleString()}) × 100 = ${viewerToFollowerRatio.toFixed(2)}%`);
      
      // Return reel with individual growth data and engagement/viewer-to-follower rates
      const reelWithGrowth = {
        ...reel,
        growth: {
          views: viewGrowth,
          likes: likeGrowth,
          comments: commentGrowth
        },
        // Engagement metrics
        engagement: {
          likes: currLikes,
          comments: currComments,
          shares: currShares,
          saves: currSaves,
          retweets: currRetweets,
          total: totalEngagements,
          rate: parseFloat(engagementRate.toFixed(2)) // Engagement rate as percentage
        },
        // Viewer to Follower Ratio metrics
        follow_rate: {
          rate: parseFloat(viewerToFollowerRatio.toFixed(2)) // Viewer to Follower Ratio as percentage
        }
      };
      
      // Log final growth values for this reel
      if (viewGrowth !== 0 || likeGrowth !== 0 || commentGrowth !== 0) {
        console.log(`✅ [API] Reel ${reel.shortcode} final growth:`, reelWithGrowth.growth);
      }
      
      return reelWithGrowth;
    });
  
  // Log summary
  const reelsWithNonZeroGrowth = reelsWithGrowth.filter(r => 
    r.growth && (r.growth.views !== 0 || r.growth.likes !== 0 || r.growth.comments !== 0)
  );
  console.log(`✅ [API] Using stored growth deltas for all ${reelsWithGrowth.length} reels/posts`);
  console.log(`📊 [API] ${reelsWithNonZeroGrowth.length} reels have non-zero growth`);
  
  // Final check: Log what we're sending to frontend
  if (reelsWithNonZeroGrowth.length > 0) {
    console.log(`\n📤 [API] Sending ${reelsWithNonZeroGrowth.length} reels with growth to frontend:`);
    reelsWithNonZeroGrowth.slice(0, 3).forEach(r => {
      console.log(`   ${r.shortcode}: Views=${r.growth.views}, Likes=${r.growth.likes}, Comments=${r.growth.comments}`);
    });
  } else {
    console.log(`\n⚠️ [API] WARNING: No reels with growth detected! This might mean:`);
    console.log(`   1. This is the first tracking (need 2+ refreshes to see growth)`);
    console.log(`   2. Metrics haven't changed since last refresh`);
    console.log(`   3. ig_reel_metrics table might not have enough snapshots`);
  }

  res.json({ data: reelsWithGrowth, total: count || reelsWithGrowth.length, offset, limit });
});

// GET /profiles/tracking/:tracking_id/reels - Get stored reels with growth metrics (by tracking_id)
router.get("/tracking/:tracking_id/reels", async (req, res) => {
  const { tracking_id } = req.params;
  const offset = Number.isNaN(Number(req.query.offset)) ? 0 : Number(req.query.offset);
  const limitParam = Number(req.query.limit);
  const limit = Number.isNaN(limitParam) ? 12 : Math.max(limitParam, 1); // Allow unlimited (no cap)

  console.log(`\n🎬 [API] GET /profiles/tracking/${tracking_id}/reels - Request received`);
  console.log(`   Offset: ${offset}, Limit: ${limit}`);

  // Find profile by tracking_id
  const { data: profile, error: profileError } = await supabase
    .from("ig_profiles")
    .select("id, username, updated_at, created_at")
    .eq("tracking_id", tracking_id)
    .maybeSingle();

  if (profileError) {
    console.error(`❌ [API] Error fetching profile:`, profileError.message);
    return res.status(500).json({ error: "Database error", details: profileError.message });
  }

  if (!profile) {
    console.error(`❌ [API] Profile not found for tracking_id: ${tracking_id}`);
    return res.status(404).json({ error: "Profile not found" });
  }

  console.log(`✅ [API] Found profile: ${profile.username} (id: ${profile.id})`);

  // Get profile's current followers count for viewer-to-follower ratio calculation
  const { data: latestSnapshot } = await supabase
    .from("ig_profile_snapshots")
    .select("followers")
    .eq("profile_id", profile.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const totalFollowers = latestSnapshot?.followers || 0;

  // Get tracking start time (for filtering metrics)
  const trackingStartTime = profile.updated_at || profile.created_at;
  const trackingStartTimeAdjusted = trackingStartTime 
    ? new Date(new Date(trackingStartTime).getTime() - 24 * 60 * 60 * 1000).toISOString() // 24 hours before
    : null;

  // Fetch ALL media items from ig_profile_reels for this profile
  const { data: allMedia, error: allMediaError } = await supabase
    .from("ig_profile_reels")
    .select("*", { count: "exact" })
    .eq("profile_id", profile.id)
    .order("taken_at", { ascending: false });

  if (allMediaError) {
    console.error(`❌ [API] Error fetching reels:`, allMediaError.message);
    return res.status(500).json({ error: allMediaError.message });
  }

  console.log(`📊 [API] Found ${allMedia?.length || 0} total media items for profile ${profile.username}`);

  // Filter to videos/reels only:
  // - Items with is_video === true OR
  // - Items with video_url (even if is_video is false/null)
  const videoReels = (allMedia || []).filter(r => {
    const isVideo = r.is_video === true;
    const hasVideoUrl = !!r.video_url;
    return isVideo || hasVideoUrl;
  });
  
  const totalCount = videoReels.length;
  const paginatedReels = videoReels.slice(offset, offset + limit);

  console.log(`✅ [API] Found ${totalCount} video reels for profile ${profile.username} (showing ${paginatedReels.length} with pagination)`);
  console.log(`   Total media items: ${allMedia?.length || 0}, Video reels: ${totalCount}`);
  
  if (allMedia && allMedia.length > 0) {
    console.log(`   Sample media items:`, allMedia.slice(0, 5).map(r => ({ 
      shortcode: r.shortcode, 
      is_video: r.is_video, 
      has_video_url: !!r.video_url,
      view_count: r.view_count 
    })));
  }

  // Handle empty reels array
  if (!paginatedReels || paginatedReels.length === 0) {
    console.log(`ℹ️  [API] No video reels found for profile ${profile.username}`);
    console.log(`   Total media items in DB: ${allMedia?.length || 0}`);
    if (allMedia && allMedia.length > 0) {
      console.log(`   ⚠️  Found ${allMedia.length} media items but none match video criteria`);
      console.log(`   Sample items:`, allMedia.slice(0, 3).map(r => ({ 
        shortcode: r.shortcode, 
        is_video: r.is_video, 
        has_video_url: !!r.video_url 
      })));
    } else {
      console.log(`   💡 No media items found in database yet. Reels will appear after the first tracking completes.`);
    }
    return res.json({ data: [], total: totalCount || 0, offset, limit });
  }

  const reels = paginatedReels;

  // Use stored deltas from ig_profile_reels table
  console.log(`📊 [API] Using stored growth deltas for ${reels.length} reels...`);
  
  const reelsWithGrowth = reels.map((reel) => {
      // Use stored deltas from ig_profile_reels table
      const viewGrowth = reel.view_delta || 0;
      const likeGrowth = reel.like_delta || 0;
      const commentGrowth = reel.comment_delta || 0;

      // Current values from the reel record (most recent)
      const currViews = reel.view_count || 0;
      const currLikes = reel.like_count || 0;
      const currComments = reel.comment_count || 0;
      
      // Demo data for metrics not available in public API
      const currShares = reel.share_count || Math.floor(currViews * 0.02);
      const currSaves = reel.save_count || Math.floor(currViews * 0.05);
      const currRetweets = 0;

      // Calculate Engagement Rate
      const totalEngagements = currLikes + currComments + currShares + currSaves + currRetweets;
      const engagementRate = currViews > 0 
        ? (totalEngagements / currViews) * 100
        : 0;
      
      // Calculate Viewer to Follower Ratio: (TOTAL VIEWS / TOTAL FOLLOWERS) × 100
      const viewerToFollowerRatio = totalFollowers > 0
        ? (currViews / totalFollowers) * 100
        : 0;
      
      return {
        ...reel,
        // Use R2 URL if available, otherwise fall back to Instagram video_url
        video_url: reel.r2_video_url || reel.video_url,
        r2_video_url: reel.r2_video_url || null,
        growth: {
          views: viewGrowth,
          likes: likeGrowth,
          comments: commentGrowth
        },
        engagement: {
          likes: currLikes,
          comments: currComments,
          shares: currShares,
          saves: currSaves,
          retweets: currRetweets,
          total: totalEngagements,
          rate: parseFloat(engagementRate.toFixed(2))
        },
        follow_rate: {
          rate: parseFloat(viewerToFollowerRatio.toFixed(2)) // Viewer to Follower Ratio as percentage
        }
      };
    });
  
  console.log(`✅ [API] Using stored growth deltas for all ${reelsWithGrowth.length} reels`);
  console.log(`📤 [API] Returning ${reelsWithGrowth.length} reels to frontend`);
  console.log(`   Sample reels:`, reelsWithGrowth.slice(0, 3).map(r => ({ 
    shortcode: r.shortcode, 
    views: r.view_count, 
    likes: r.like_count,
    has_growth: !!(r.growth && (r.growth.views || r.growth.likes || r.growth.comments))
  })));
  
  res.json({ data: reelsWithGrowth, total: totalCount || 0, offset, limit });
});

// POST /profiles/:username/reels/import - Import a single reel/post by URL or shortcode
router.post("/:username/reels/import", async (req, res) => {
  const { username } = req.params;
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Instagram URL or shortcode is required" });
  }

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    return res.status(400).json({ error: "Unable to extract Instagram shortcode from the provided input" });
  }

  try {
    // Locate profile
    const { data: profile, error: profileError } = await supabase
      .from("ig_profiles")
      .select("id, username")
      .eq("username", username)
      .single();

    if (profileError || !profile) {
      console.error(`❌ [API] Import reel: profile not found for ${username}`, profileError?.message);
      return res.status(404).json({ error: "Profile not found" });
    }

    console.log(`\n📥 [API] Importing reel ${shortcode} for @${username}...`);
    const reelData = await fetchReelData(shortcode);
    if (!reelData) {
      throw new Error("Instagram did not return any data for this shortcode.");
    }

    const takenAtIso = reelData.taken_at_timestamp
      ? new Date(reelData.taken_at_timestamp * 1000).toISOString()
      : new Date().toISOString();

    const upsertPayload = {
      profile_id: profile.id,
      shortcode: reelData.shortcode,
      caption: reelData.caption,
      taken_at: takenAtIso,
      is_video: reelData.is_video ?? true,
      video_url: reelData.video_url,
      duration: reelData.video_duration,
      average_watch_time: reelData.average_watch_time,
      view_count: reelData.view_count,
      like_count: reelData.like_count,
      comment_count: reelData.comment_count,
      display_url: reelData.display_url,
    };

    const { data: savedReel, error: reelError } = await supabase
      .from("ig_profile_reels")
      .upsert(upsertPayload, { onConflict: "profile_id,shortcode" })
      .select()
      .single();

    if (reelError) {
      console.error(`❌ [API] Failed to save imported reel ${shortcode}:`, reelError.message);
      return res.status(500).json({ error: reelError.message });
    }

    console.log(`✅ [API] Reel ${shortcode} imported for @${username} (ID: ${savedReel.id})`);

    // Capture a metrics snapshot so growth tracking has a baseline
    await supabase.from("ig_reel_metrics").insert({
      reel_id: savedReel.id,
      view_count: savedReel.view_count || 0,
      like_count: savedReel.like_count || 0,
      comment_count: savedReel.comment_count || 0,
    });

    res.json({ data: savedReel, imported: true });
  } catch (error) {
    console.error(`❌ [API] Import reel failed for ${shortcode}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /profiles/:username/daily-growth - Get daily growth breakdown (defaults to today, or use ?date=YYYY-MM-DD)
router.get("/:username/daily-growth", async (req, res) => {
  const { username } = req.params;
  const { date } = req.query; // Optional date parameter (YYYY-MM-DD format)

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) return res.status(404).json({ error: "Profile not found" });

  try {
    // Use provided date or default to today
    const targetDate = date || new Date().toISOString().split("T")[0];
    console.log(`\n📊 [API] Fetching daily growth for ${username} on date: ${targetDate}`);
    
    // 1. Get profile stats growth (from daily metrics for the target date)
    // First, try to get daily metrics for the target date
    const { data: targetDateMetrics } = await supabase
      .from("ig_profile_daily_metrics")
      .select("*")
      .eq("profile_id", profile.id)
      .eq("date", targetDate)
      .maybeSingle();
    
    // If target date not found, get the most recent daily metrics
    let dailyMetrics = targetDateMetrics;
    if (!dailyMetrics) {
      const { data: recentMetrics } = await supabase
        .from("ig_profile_daily_metrics")
        .select("*")
        .eq("profile_id", profile.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      dailyMetrics = recentMetrics;
      if (dailyMetrics) {
        console.log(`   ⚠️  Date ${targetDate} not found, using most recent: ${dailyMetrics.date}`);
      }
    }
    
    // Get latest delta as fallback
    const { data: latestDelta } = await supabase
      .from("ig_profile_deltas")
      .select("*")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. Get all reels with growth
    const { data: reels } = await supabase
      .from("ig_profile_reels")
      .select("id, shortcode, is_video, display_url, video_url")
      .eq("profile_id", profile.id);

    // 3. Calculate total reel growth for today
    let totalReelViews = 0;
    let totalReelLikes = 0;
    let totalReelComments = 0;
    const reelBreakdown = [];

    if (reels && reels.length > 0) {
      for (const reel of reels) {
        // Get metrics snapshots for this reel
        const { data: metrics } = await supabase
          .from("ig_reel_metrics")
          .select("*")
          .eq("reel_id", reel.id)
          .order("captured_at", { ascending: false })
          .limit(2);

        if (metrics && metrics.length >= 2) {
          // Compare today's metrics with previous
          const latest = metrics[0];
          const previous = metrics[1];
          
          // Calculate growth from latest metrics snapshot
          // Include all growth from the most recent refresh period
          const viewGrowth = (latest.view_count || 0) - (previous.view_count || 0);
          const likeGrowth = (latest.like_count || 0) - (previous.like_count || 0);
          const commentGrowth = (latest.comment_count || 0) - (previous.comment_count || 0);

          if (viewGrowth > 0 || likeGrowth > 0 || commentGrowth > 0) {
            totalReelViews += viewGrowth;
            totalReelLikes += likeGrowth;
            totalReelComments += commentGrowth;

            const latestDate = new Date(latest.captured_at).toISOString().split("T")[0];
            reelBreakdown.push({
              shortcode: reel.shortcode,
              is_video: reel.is_video,
              views: viewGrowth,
              likes: likeGrowth,
              comments: commentGrowth,
              date: latestDate,
              display_url: reel.display_url || null,
              video_url: reel.video_url || null
            });
          }
        }
      }
    }

    // 4. Get profile stats growth (from daily metrics for target date, or latest delta as fallback)
    let profileFollowersGrowth = 0;
    let profileFollowingGrowth = 0;
    let profileMediaGrowth = 0;
    let profileClipsGrowth = 0;
    let growthDate = targetDate;

    // Use daily metrics if available (more accurate for specific date)
    if (dailyMetrics) {
      profileFollowersGrowth = dailyMetrics.followers_delta || 0;
      growthDate = dailyMetrics.date;
      console.log(`   ✅ Using daily metrics for ${growthDate}: followers_delta=${profileFollowersGrowth}`);
    } else if (latestDelta) {
      // Fallback to latest delta
      const deltaDate = new Date(latestDelta.created_at).toISOString().split("T")[0];
      profileFollowersGrowth = latestDelta.followers_diff || 0;
      profileFollowingGrowth = latestDelta.following_diff || 0;
      profileMediaGrowth = latestDelta.media_diff || 0;
      profileClipsGrowth = latestDelta.clips_diff || 0;
      growthDate = deltaDate;
      console.log(`   ⚠️  Using latest delta as fallback for ${growthDate}`);
    }

    // 5. Calculate totals
    const totalGrowth = {
      profile: {
        followers: profileFollowersGrowth,
        following: profileFollowingGrowth,
        media: profileMediaGrowth,
        clips: profileClipsGrowth
      },
      reels: {
        views: totalReelViews,
        likes: totalReelLikes,
        comments: totalReelComments
      },
      breakdown: reelBreakdown,
      date: growthDate
    };

    console.log(`\n📊 [API] Daily growth for ${username} (${growthDate}):`);
    console.log(`   Profile: Followers=${profileFollowersGrowth}, Following=${profileFollowingGrowth}, Media=${profileMediaGrowth}, Clips=${profileClipsGrowth}`);
    console.log(`   Reels: Views=${totalReelViews}, Likes=${totalReelLikes}, Comments=${totalReelComments}`);
    console.log(`   Breakdown: ${reelBreakdown.length} reels/posts with growth`);

    res.json({ data: totalGrowth });
  } catch (error) {
    console.error(`Error calculating daily growth for ${username}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /profiles/:username/available-dates - Get list of available dates with daily metrics
router.get("/:username/available-dates", async (req, res) => {
  const { username } = req.params;

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) return res.status(404).json({ error: "Profile not found" });

  try {
    const { data: dates, error } = await supabase
      .from("ig_profile_daily_metrics")
      .select("date, followers_delta")
      .eq("profile_id", profile.id)
      .order("date", { ascending: false });

    if (error) {
      console.error(`Error fetching available dates: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }

    res.json({ data: dates || [] });
  } catch (error) {
    console.error(`Error getting available dates for ${username}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /profiles/:username/history - Time series data
// Supports: ?days=30 OR ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get("/:username/history", async (req, res) => {
  const { username } = req.params;
  const { days, start_date, end_date } = req.query;

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) return res.status(404).json({ error: "Profile not found" });

  let query = supabase
    .from("ig_profile_daily_metrics")
    .select("*")
    .eq("profile_id", profile.id);

  // If date range is provided, use it
  if (start_date || end_date) {
    if (start_date) {
      query = query.gte("date", start_date);
    }
    if (end_date) {
      query = query.lte("date", end_date);
    }
  } else {
    // Otherwise, use days parameter (default 30)
    const daysNum = Number(days) || 30;
    const since = new Date();
    since.setDate(since.getDate() - daysNum);
    query = query.gte("date", since.toISOString().split("T")[0]);
  }

  const { data: metrics, error } = await query.order("date", { ascending: true });

  if (error) {
    console.error(`Error fetching history for ${username}:`, error.message);
    return res.status(500).json({ error: error.message });
  }
  
  console.log(`\n📊 [API] History fetched for ${username}: ${metrics?.length || 0} days`);
  if (start_date || end_date) {
    console.log(`   Date range: ${start_date || 'start'} to ${end_date || 'end'}`);
  } else {
    console.log(`   Last ${days || 30} days`);
  }
  
  res.json({ data: metrics || [] });
});

// GET /profiles/:username/reels/:shortcode/metrics - Get reel growth metrics
router.get("/:username/reels/:shortcode/metrics", async (req, res) => {
  const { username, shortcode } = req.params;

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id")
    .eq("username", username)
    .single();

  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const { data: reel } = await supabase
    .from("ig_profile_reels")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("shortcode", shortcode)
    .single();

  if (!reel) return res.status(404).json({ error: "Reel not found" });

  const { data: metrics, error } = await supabase
    .from("ig_reel_metrics")
    .select("*")
    .eq("reel_id", reel.id)
    .order("captured_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data: metrics });
});

// GET /profiles/:username/analytics - Get viewer-to-follower ratio and reel conversion metrics
router.get("/:username/analytics", async (req, res) => {
  const { username } = req.params;

  try {
    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from("ig_profiles")
      .select("id")
      .eq("username", username)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Get latest snapshot for current followers
    const { data: latestSnapshot } = await supabase
      .from("ig_profile_snapshots")
      .select("followers, captured_at")
      .eq("profile_id", profile.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get first snapshot to calculate total followers gained
    const { data: firstSnapshot } = await supabase
      .from("ig_profile_snapshots")
      .select("followers, captured_at")
      .eq("profile_id", profile.id)
      .order("captured_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Get all reels with their view counts
    const { data: reels, error: reelsError } = await supabase
      .from("ig_profile_reels")
      .select("view_count, taken_at")
      .eq("profile_id", profile.id);

    if (reelsError) {
      console.error(`Error fetching reels for analytics: ${reelsError.message}`);
    }

    // Calculate metrics
    const currentFollowers = latestSnapshot?.followers || 0;
    const initialFollowers = firstSnapshot?.followers || currentFollowers;
    const totalFollowersGained = currentFollowers - initialFollowers;

    // Calculate total views across all reels
    const totalReelViews = reels?.reduce((sum, reel) => sum + (reel.view_count || 0), 0) || 0;

    // Viewer to Follower Ratio (views per follower)
    const viewerToFollowerRatio = currentFollowers > 0 
      ? (totalReelViews / currentFollowers).toFixed(2) 
      : 0;

    // Reel Conversion Rate (followers gained per 1000 views)
    // This shows how many followers are gained per 1000 views on reels
    const reelConversionRate = totalReelViews > 0 && totalFollowersGained > 0
      ? ((totalFollowersGained / totalReelViews) * 1000).toFixed(2)
      : 0;

    // Alternative: Conversion percentage (followers gained / total views * 100)
    const conversionPercentage = totalReelViews > 0 && totalFollowersGained > 0
      ? ((totalFollowersGained / totalReelViews) * 100).toFixed(4)
      : 0;

    // Get reels posted in last 30 days for recent conversion rate
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentReels = reels?.filter(reel => {
      if (!reel.taken_at) return false;
      return new Date(reel.taken_at) >= thirtyDaysAgo;
    }) || [];

    const recentReelViews = recentReels.reduce((sum, reel) => sum + (reel.view_count || 0), 0);

    // Get follower growth in last 30 days
    const { data: recentMetrics } = await supabase
      .from("ig_profile_daily_metrics")
      .select("followers_delta, date")
      .eq("profile_id", profile.id)
      .gte("date", thirtyDaysAgo.toISOString().split("T")[0])
      .order("date", { ascending: true });

    const recentFollowersGained = recentMetrics?.reduce((sum, metric) => 
      sum + (metric.followers_delta || 0), 0) || 0;

    const recentConversionRate = recentReelViews > 0 && recentFollowersGained > 0
      ? ((recentFollowersGained / recentReelViews) * 1000).toFixed(2)
      : 0;

    const analytics = {
      viewer_to_follower_ratio: parseFloat(viewerToFollowerRatio),
      total_reel_views: totalReelViews,
      current_followers: currentFollowers,
      total_followers_gained: totalFollowersGained,
      reel_conversion_rate_per_1k_views: parseFloat(reelConversionRate),
      conversion_percentage: parseFloat(conversionPercentage),
      recent_30_days: {
        reel_views: recentReelViews,
        followers_gained: recentFollowersGained,
        conversion_rate_per_1k_views: parseFloat(recentConversionRate),
        reels_count: recentReels.length
      },
      total_reels_count: reels?.length || 0
    };

    console.log(`\n📊 [Analytics] ${username}:`);
    console.log(`   Viewer to Follower Ratio: ${viewerToFollowerRatio}x`);
    console.log(`   Total Reel Views: ${totalReelViews.toLocaleString()}`);
    console.log(`   Followers Gained: ${totalFollowersGained > 0 ? '+' : ''}${totalFollowersGained.toLocaleString()}`);
    console.log(`   Conversion Rate: ${reelConversionRate} followers per 1K views`);
    console.log(`   Conversion %: ${conversionPercentage}%`);

    res.json({ data: analytics });
  } catch (error) {
    console.error(`Error calculating analytics for ${username}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /profiles/tracking/:tracking_id - Delete tracking for a user
router.delete("/tracking/:tracking_id", async (req, res) => {
  const { tracking_id } = req.params;
  // Try to get user_id from body first, then from query params as fallback
  const { user_id } = req.body || {};
  const user_id_from_query = req.query.user_id;
  const final_user_id = user_id || user_id_from_query;
  
  console.log(`\n🗑️  [API] DELETE /profiles/tracking/${tracking_id} - Request received`);
  console.log(`   Request body:`, req.body);
  console.log(`   Query params:`, req.query);
  console.log(`   User ID (from body): ${user_id || 'none'}`);
  console.log(`   User ID (from query): ${user_id_from_query || 'none'}`);
  console.log(`   Final User ID: ${final_user_id || 'none'}`);
  
  if (!final_user_id) {
    return res.status(400).json({ error: "user_id is required. Provide it in the request body or as a query parameter." });
  }
  
  try {
    // Verify the profile belongs to this user
    const { data: profile, error: profileError } = await supabase
      .from("ig_profiles")
      .select("id, username, user_id, tracking_id")
      .eq("tracking_id", tracking_id)
      .maybeSingle();
    
    if (profileError) {
      console.error(`❌ [API] Error fetching profile:`, profileError.message);
      return res.status(500).json({ error: "Database error", details: profileError.message });
    }
    
    if (!profile) {
      console.error(`❌ [API] Tracking ID not found: ${tracking_id}`);
      return res.status(404).json({ error: "Tracking not found" });
    }
    
    // Verify user owns this tracking
    if (profile.user_id && profile.user_id !== final_user_id) {
      console.error(`❌ [API] User ${final_user_id} does not own tracking ${tracking_id}`);
      return res.status(403).json({ error: "You do not have permission to delete this tracking" });
    }
    
    // Delete the profile (CASCADE will delete related snapshots, deltas, etc.)
    // If profile has user_id, require it to match. If profile.user_id is null, delete by tracking_id only.
    let deleteQuery = supabase
      .from("ig_profiles")
      .delete()
      .eq("tracking_id", tracking_id);
    
    // Only add user_id filter if the profile has a user_id set
    // If profile.user_id is null, we don't add the filter (allows deletion of profiles without user_id)
    if (profile.user_id) {
      deleteQuery = deleteQuery.eq("user_id", final_user_id);
      console.log(`   [DELETE] Filtering by user_id: ${final_user_id}`);
    } else {
      console.log(`   [DELETE] Profile has no user_id, deleting by tracking_id only`);
    }
    
    const { data: deletedData, error: deleteError } = await deleteQuery
      .select(); // Return deleted rows to verify deletion
    
    if (deleteError) {
      console.error(`❌ [API] Error deleting profile:`, deleteError.message);
      return res.status(500).json({ error: "Failed to delete tracking", details: deleteError.message });
    }
    
    // Verify deletion actually happened
    if (!deletedData || deletedData.length === 0) {
      console.error(`❌ [API] No rows deleted for tracking_id ${tracking_id} and user_id ${final_user_id}`);
      return res.status(404).json({ error: "No matching profile found to delete. It may have already been deleted." });
    }
    
    console.log(`✅ [API] Tracking ${tracking_id} deleted successfully for user ${final_user_id}`);
    console.log(`   Deleted profile: ${deletedData[0]?.username || 'unknown'}`);
    res.json({ success: true, message: "Tracking deleted successfully", deleted: deletedData[0] });
  } catch (err) {
    console.error(`❌ [API] Failed to delete tracking ${tracking_id}:`, err.message);
    console.error(`   Error stack:`, err.stack);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /profiles/tracking/:tracking_id/available-dates - Get available dates for this tracking session
router.get("/tracking/:tracking_id/available-dates", async (req, res) => {
  const { tracking_id } = req.params;

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id, updated_at, created_at")
    .eq("tracking_id", tracking_id)
    .maybeSingle();

  if (!profile) return res.status(404).json({ error: "Tracking not found" });

  try {
    // Filter by tracking session start time
    const trackingStartTime = profile.updated_at || profile.created_at;
    const trackingStartDate = new Date(trackingStartTime).toISOString().split("T")[0];

    const { data: dates, error } = await supabase
      .from("ig_profile_daily_metrics")
      .select("date, followers_delta")
      .eq("profile_id", profile.id)
      .gte("date", trackingStartDate) // Only dates from this tracking session
      .order("date", { ascending: false });

    if (error) {
      console.error(`Error fetching available dates: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }

    res.json({ data: dates || [] });
  } catch (error) {
    console.error(`Error getting available dates for tracking ${tracking_id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /profiles/tracking/:tracking_id/daily-growth - Get daily growth for this tracking session
router.get("/tracking/:tracking_id/daily-growth", async (req, res) => {
  const { tracking_id } = req.params;
  const { date } = req.query;

  const { data: profile } = await supabase
    .from("ig_profiles")
    .select("id, updated_at, created_at")
    .eq("tracking_id", tracking_id)
    .maybeSingle();

  if (!profile) return res.status(404).json({ error: "Tracking not found" });

  try {
    // Filter by tracking session start time
    const trackingStartTime = profile.updated_at || profile.created_at;
    const trackingStartDate = new Date(trackingStartTime).toISOString().split("T")[0];
    const trackingStartDateObj = new Date(trackingStartTime);
    trackingStartDateObj.setSeconds(trackingStartDateObj.getSeconds() - 1);
    const trackingStartTimeAdjusted = trackingStartDateObj.toISOString();

    const targetDate = date || new Date().toISOString().split("T")[0];
    
    // Get daily metrics for target date (only if after tracking start)
    let dailyMetrics = null;
    if (targetDate >= trackingStartDate) {
      const { data: targetDateMetrics } = await supabase
        .from("ig_profile_daily_metrics")
        .select("*")
        .eq("profile_id", profile.id)
        .eq("date", targetDate)
        .maybeSingle();
      dailyMetrics = targetDateMetrics;
    }

    // If target date not found, get the most recent daily metrics from this tracking session
    if (!dailyMetrics) {
      const { data: recentMetrics } = await supabase
        .from("ig_profile_daily_metrics")
        .select("*")
        .eq("profile_id", profile.id)
        .gte("date", trackingStartDate) // Only from this tracking session
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      dailyMetrics = recentMetrics;
    }

    // Get latest delta from this tracking session
    const { data: latestDelta } = await supabase
      .from("ig_profile_deltas")
      .select("*")
      .eq("profile_id", profile.id)
      .gte("created_at", trackingStartTimeAdjusted) // Only from this tracking session
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get reels (all reels, but growth will be calculated from tracking session start)
    const { data: reels } = await supabase
      .from("ig_profile_reels")
      .select("id, shortcode, is_video, display_url, video_url")
      .eq("profile_id", profile.id);

    // Calculate total reel growth (from tracking session start)
    let totalReelViews = 0;
    let totalReelLikes = 0;
    let totalReelComments = 0;
    const reelBreakdown = [];

    if (reels && reels.length > 0) {
      for (const reel of reels) {
        // Get metrics snapshots from this tracking session
        const { data: metrics } = await supabase
          .from("ig_reel_metrics")
          .select("*")
          .eq("reel_id", reel.id)
          .gte("captured_at", trackingStartTimeAdjusted) // Only from this tracking session
          .order("captured_at", { ascending: false })
          .limit(2);

        if (metrics && metrics.length >= 2) {
          const latest = metrics[0];
          const previous = metrics[1];
          
          const viewGrowth = (latest.view_count || 0) - (previous.view_count || 0);
          const likeGrowth = (latest.like_count || 0) - (previous.like_count || 0);
          const commentGrowth = (latest.comment_count || 0) - (previous.comment_count || 0);

          totalReelViews += viewGrowth;
          totalReelLikes += likeGrowth;
          totalReelComments += commentGrowth;

          reelBreakdown.push({
            shortcode: reel.shortcode,
            is_video: reel.is_video,
            display_url: reel.display_url,
            video_url: reel.video_url,
            views: viewGrowth,
            likes: likeGrowth,
            comments: commentGrowth,
          });
        } else if (metrics && metrics.length === 1) {
          // First tracking of this reel - show current values as growth
          const latest = metrics[0];
          const viewGrowth = latest.view_count || 0;
          const likeGrowth = latest.like_count || 0;
          const commentGrowth = latest.comment_count || 0;

          totalReelViews += viewGrowth;
          totalReelLikes += likeGrowth;
          totalReelComments += commentGrowth;

          reelBreakdown.push({
            shortcode: reel.shortcode,
            is_video: reel.is_video,
            display_url: reel.display_url,
            video_url: reel.video_url,
            views: viewGrowth,
            likes: likeGrowth,
            comments: commentGrowth,
          });
        }
      }
    }

    res.json({
      profile: {
        followers_delta: dailyMetrics?.followers_delta || latestDelta?.followers_delta || 0,
        following_delta: latestDelta?.following_delta || 0,
        posts_delta: latestDelta?.posts_delta || 0,
      },
      reels: {
        total_views: totalReelViews,
        total_likes: totalReelLikes,
        total_comments: totalReelComments,
        breakdown: reelBreakdown,
      },
    });
  } catch (error) {
    console.error(`Error fetching daily growth for tracking ${tracking_id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /profiles/tracking/:tracking_id/daily-metrics-history - Get all daily metrics history for chart
router.get("/tracking/:tracking_id/daily-metrics-history", async (req, res) => {
  const { tracking_id } = req.params;
  const { days } = req.query;
  const daysNum = Number(days) || 30;

  console.log(`\n📊 [API] GET /profiles/tracking/${tracking_id}/daily-metrics-history (last ${daysNum} days)`);

  const { data: profile, error: profileError } = await supabase
    .from("ig_profiles")
    .select("id, updated_at, created_at")
    .eq("tracking_id", tracking_id)
    .maybeSingle();

  if (profileError) {
    console.error(`❌ [API] Error fetching profile:`, profileError.message);
    return res.status(500).json({ error: "Database error", details: profileError.message });
  }

  if (!profile) {
    console.error(`❌ [API] Profile not found for tracking_id: ${tracking_id}`);
    return res.status(404).json({ error: "Profile not found" });
  }

  // ⚠️ CRITICAL: Return ALL historical daily metrics data - never filter by date
  // The 'days' parameter is only used for logging/info, but we return ALL data
  // This ensures no historical data is lost or hidden from the chart
  // Historical data is NEVER deleted from the database, so we should return it all
  
  // Get tracking start date (for reference only, not for filtering)
  const trackingStartTime = profile.updated_at || profile.created_at;
  const trackingStartDate = new Date(trackingStartTime).toISOString().split("T")[0];

  // Calculate date range (for logging only - we don't use this to filter)
  const since = new Date();
  since.setDate(since.getDate() - daysNum);
  const startDate = since.toISOString().split("T")[0];

  // ⚠️ IMPORTANT: Fetch ALL daily metrics - no date filtering
  // This ensures all historical data is returned, not just the last N days
  // Each day's data is preserved in the database and should be available
  const { data: metrics, error } = await supabase
    .from("ig_profile_daily_metrics")
    .select("*")
    .eq("profile_id", profile.id)
    // ⚠️ REMOVED: .gte("date", queryStartDate) - this was filtering out old data!
    // Now we return ALL data regardless of date
    .order("date", { ascending: true });

  if (error) {
    console.error(`❌ [API] Error fetching daily metrics:`, error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`✅ [API] Found ${metrics?.length || 0} daily metrics records (ALL historical data)`);
  console.log(`   📊 Returning ALL historical data - no date filtering applied`);
  
  if (metrics && metrics.length > 0) {
    console.log(`   📊 Date range: ${metrics[0].date} to ${metrics[metrics.length - 1].date}`);
    console.log(`   📊 Sample metrics (first record):`, {
      date: metrics[0].date,
      followers_delta: metrics[0].followers_delta,
      views_delta: metrics[0].views_delta,
      likes_delta: metrics[0].likes_delta,
      comments_delta: metrics[0].comments_delta
    });
    console.log(`   📊 Sample metrics (last record):`, {
      date: metrics[metrics.length - 1].date,
      followers_delta: metrics[metrics.length - 1].followers_delta,
      views_delta: metrics[metrics.length - 1].views_delta,
      likes_delta: metrics[metrics.length - 1].likes_delta,
      comments_delta: metrics[metrics.length - 1].comments_delta
    });
  }

  // Map metrics to chart data format - use stored values from daily_metrics table
  const metricsWithReels = (metrics || []).map((metric) => {
    return {
      date: metric.date,
      followers: metric.followers_delta || 0,
      following: metric.following_delta || 0,
      media: metric.posts_delta || metric.media_delta || 0,
      clips: metric.clips_delta || 0,
      views: metric.views_delta || 0,
      likes: metric.likes_delta || 0,
      comments: metric.comments_delta || 0,
    };
  });

  console.log(`   📈 Returning ${metricsWithReels.length} data points for chart`);
  res.json({ data: metricsWithReels });
});

// GET /profiles/tracking/:tracking_id/analytics - Get analytics for this tracking session
router.get("/tracking/:tracking_id/analytics", async (req, res) => {
  const { tracking_id } = req.params;

  try {
    const { data: profile } = await supabase
      .from("ig_profiles")
      .select("id, updated_at, created_at")
      .eq("tracking_id", tracking_id)
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ error: "Tracking not found" });
    }

    // Filter by tracking session start time
    const trackingStartTime = profile.updated_at || profile.created_at;
    const trackingStartDateObj = new Date(trackingStartTime);
    trackingStartDateObj.setSeconds(trackingStartDateObj.getSeconds() - 1);
    const trackingStartTimeAdjusted = trackingStartDateObj.toISOString();
    const trackingStartDate = new Date(trackingStartTime).toISOString().split("T")[0];

    // Get latest snapshot from this tracking session
    const { data: latestSnapshot } = await supabase
      .from("ig_profile_snapshots")
      .select("followers, captured_at")
      .eq("profile_id", profile.id)
      .gte("captured_at", trackingStartTimeAdjusted) // Only from this tracking session
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get first snapshot from this tracking session (baseline)
    const { data: firstSnapshot } = await supabase
      .from("ig_profile_snapshots")
      .select("followers, captured_at")
      .eq("profile_id", profile.id)
      .gte("captured_at", trackingStartTimeAdjusted) // Only from this tracking session
      .order("captured_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Get all reels (they're already filtered by profile_id)
    const { data: reels, error: reelsError } = await supabase
      .from("ig_profile_reels")
      .select("view_count, taken_at")
      .eq("profile_id", profile.id);

    if (reelsError) {
      console.error(`Error fetching reels for analytics: ${reelsError.message}`);
    }

    // Calculate metrics from this tracking session only
    const currentFollowers = latestSnapshot?.followers || 0;
    const initialFollowers = firstSnapshot?.followers || currentFollowers;
    const totalFollowersGained = currentFollowers - initialFollowers;

    // Calculate total views across all reels
    const totalReelViews = reels?.reduce((sum, reel) => sum + (reel.view_count || 0), 0) || 0;

    // Viewer to Follower Ratio
    const viewerToFollowerRatio = currentFollowers > 0 
      ? (totalReelViews / currentFollowers).toFixed(2) 
      : 0;

    // Reel Conversion Rate
    const reelConversionRate = totalReelViews > 0 && totalFollowersGained > 0
      ? ((totalFollowersGained / totalReelViews) * 1000).toFixed(2)
      : 0;

    const conversionPercentage = totalReelViews > 0 && totalFollowersGained > 0
      ? ((totalFollowersGained / totalReelViews) * 100).toFixed(4)
      : 0;

    // Get reels posted in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentReels = reels?.filter(reel => {
      if (!reel.taken_at) return false;
      return new Date(reel.taken_at) >= thirtyDaysAgo;
    }) || [];

    const recentReelViews = recentReels.reduce((sum, reel) => sum + (reel.view_count || 0), 0);

    // Get follower growth in last 30 days (from this tracking session)
    const { data: recentMetrics } = await supabase
      .from("ig_profile_daily_metrics")
      .select("followers_delta, date")
      .eq("profile_id", profile.id)
      .gte("date", trackingStartDate) // Only from this tracking session
      .gte("date", thirtyDaysAgo.toISOString().split("T")[0])
      .order("date", { ascending: true });

    const recentFollowersGained = recentMetrics?.reduce((sum, metric) => 
      sum + (metric.followers_delta || 0), 0) || 0;

    const recentConversionRate = recentReelViews > 0 && recentFollowersGained > 0
      ? ((recentFollowersGained / recentReelViews) * 1000).toFixed(2)
      : 0;

    const analytics = {
      viewer_to_follower_ratio: parseFloat(viewerToFollowerRatio),
      total_reel_views: totalReelViews,
      current_followers: currentFollowers,
      total_followers_gained: totalFollowersGained,
      reel_conversion_rate_per_1k_views: parseFloat(reelConversionRate),
      conversion_percentage: parseFloat(conversionPercentage),
      recent_30_days: {
        reel_views: recentReelViews,
        followers_gained: recentFollowersGained,
        conversion_rate_per_1k_views: parseFloat(recentConversionRate),
        reels_count: recentReels.length
      },
      total_reels_count: reels?.length || 0
    };

    res.json({ data: analytics });
  } catch (error) {
    console.error(`Error calculating analytics for tracking ${tracking_id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

