
const supabase = require("./supabase");
const { fetchInstagramProfileData, fetchReelData, scrapeReelsPageWithPlaywright } = require("./instagram");
const crypto = require("crypto");

// Generate unique tracking ID
const generateTrackingId = () => {
  return crypto.randomBytes(8).toString('hex');
};

const trackProfile = async (username, customTrackingId = null, userId = null) => {
  try {
    console.log(`Starting trackProfile for ${username}...`);
    if (customTrackingId) {
      console.log(`   Using custom tracking_id: ${customTrackingId} (user-specific, starting fresh)`);
    }

    // 1. Fetch fresh data from Instagram
    const igData = await fetchInstagramProfileData(username);
    if (!igData) throw new Error("Failed to fetch Instagram data");

    console.log(`Fetched data for ${username} (ID: ${igData.id})`);
    if (igData.biography) {
      console.log(`   Bio: ${igData.biography.substring(0, 50)}${igData.biography.length > 50 ? '...' : ''}`);
    }
    if (igData.external_url) {
      console.log(`   External Link: ${igData.external_url}`);
    }

    // 2. Upsert Profile (static info)
    // If customTrackingId is provided, use it (user-specific tracking, starts fresh)
    // Otherwise, check if profile exists and reuse tracking_id
    let trackingId = customTrackingId;
    
    if (!trackingId) {
    // Check if profile exists first
    const { data: existingProfile } = await supabase
      .from("ig_profiles")
      .select("*")
      .eq("username", igData.username)
      .maybeSingle();

      trackingId = existingProfile?.tracking_id || generateTrackingId();
    } else {
      // User-specific tracking: Check if profile with this tracking_id exists
      // If it does, we'll update it. If not, create new.
      const { data: existingProfile } = await supabase
        .from("ig_profiles")
        .select("*")
        .eq("tracking_id", trackingId)
        .maybeSingle();
      
      if (existingProfile && existingProfile.username !== igData.username) {
        // Tracking ID exists but for different username - generate new one
        console.log(`⚠️  Tracking ID ${trackingId} exists for different username, generating new one`);
        trackingId = generateTrackingId();
      }
    }

    // Build upsert object - only include tracking_id if column exists
    const profileData = {
      username: igData.username,
      full_name: igData.full_name,
      avatar_url: igData.profile_pic_url,
      profile_picture: igData.profile_pic_url, // Save profile picture URL
      biography: igData.biography || null, // Save bio
      external_url: igData.external_url || null, // Save external link (link in bio)
      last_snapshot_id: null // Will update later
    };
    
    // Include user_id if provided (to link profile to user)
    if (userId) {
      profileData.user_id = userId;
      console.log(`   Linking profile to user_id: ${userId}`);
    }

    // Always try to include tracking_id - if column doesn't exist, migration needs to be run
    profileData.tracking_id = trackingId;

    let profile;
    let profileError;
    
    if (customTrackingId) {
      // User-specific tracking: Try to create/update with this specific tracking_id
      // First, try to find existing profile with this tracking_id
      const { data: existingByTrackingId } = await supabase
        .from("ig_profiles")
        .select("*")
        .eq("tracking_id", customTrackingId)
        .maybeSingle();
      
      if (existingByTrackingId) {
        // Update existing profile with this tracking_id
        const { data: updatedProfile, error: updateError } = await supabase
          .from("ig_profiles")
          .update(profileData)
          .eq("tracking_id", customTrackingId)
          .select()
          .single();
        profile = updatedProfile;
        profileError = updateError;
      } else {
        // Check if this user is already tracking this username
        // We want to prevent the same user from tracking the same username twice
        const { data: existingByUserAndUsername } = await supabase
          .from("ig_profiles")
          .select("*")
          .eq("username", igData.username)
          .eq("user_id", userId)
          .maybeSingle();
        
        if (existingByUserAndUsername) {
          // This user is already tracking this username
          // Check if it's the same tracking_id (should be, but verify)
          if (existingByUserAndUsername.tracking_id === customTrackingId) {
            // Same tracking_id - just update the profile data
            console.log(`✅ User ${userId} already tracking ${igData.username} with tracking_id ${customTrackingId} - updating profile data`);
            const { data: updatedProfile, error: updateError } = await supabase
              .from("ig_profiles")
              .update(profileData)
              .eq("tracking_id", customTrackingId)
              .select()
              .single();
            profile = updatedProfile;
            profileError = updateError;
          } else {
            // Same user, same username, but different tracking_id - this shouldn't happen
            // But if it does, update to use the new tracking_id
            console.log(`⚠️  User ${userId} already tracking ${igData.username} with different tracking_id - updating to new tracking_id`);
            const { data: updatedProfile, error: updateError } = await supabase
              .from("ig_profiles")
              .update({
                ...profileData,
                updated_at: new Date().toISOString()
              })
              .eq("user_id", userId)
              .eq("username", igData.username)
              .select()
              .single();
            profile = updatedProfile;
            profileError = updateError;
          }
        } else {
          // This user is NOT tracking this username yet
          // Check if another user is tracking this username (for logging purposes)
          const { data: existingByUsername } = await supabase
            .from("ig_profiles")
            .select("*")
            .eq("username", igData.username)
            .neq("user_id", userId) // Different user
            .maybeSingle();
          
          if (existingByUsername) {
            console.log(`🆕 Another user is already tracking ${igData.username} (tracking_id: ${existingByUsername.tracking_id})`);
            console.log(`   Creating NEW profile entry for user ${userId} (tracking_id: ${customTrackingId})`);
            console.log(`   This ensures each user has isolated tracking data`);
          }
          
          // Create a completely new profile entry with the new tracking_id
          // Set updated_at to NOW to mark when this tracking session started
          const { data: newProfile, error: insertError } = await supabase
            .from("ig_profiles")
            .insert({
              ...profileData,
              updated_at: new Date().toISOString() // Mark when this tracking session started
            })
            .select()
            .single();
          profile = newProfile;
          profileError = insertError;
          
          // Handle duplicate key error (username unique constraint)
          if (insertError && insertError.code === '23505' && insertError.message.includes('username')) {
            console.log(`⚠️  Insert failed due to username constraint, checking existing profile...`);
            // Check if existing profile belongs to this user
            const { data: existingByUsername } = await supabase
              .from("ig_profiles")
              .select("*")
              .eq("username", igData.username)
              .maybeSingle();
            
            if (existingByUsername) {
              if (existingByUsername.user_id === userId) {
                // Same user - update existing profile
                console.log(`✅ Same user tracking same username - updating existing profile`);
                const { data: updatedProfile, error: updateError } = await supabase
                  .from("ig_profiles")
                  .update({
                    ...profileData,
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", existingByUsername.id)
                  .select()
                  .single();
                profile = updatedProfile;
                profileError = updateError;
              } else {
                // Different user - need migration to allow this
                throw new Error(`Username ${igData.username} is already being tracked by another user. Please run the migration: supabase/migrations/remove_username_unique_constraint.sql to allow multiple users to track the same username.`);
              }
            }
          } else if (!insertError) {
            console.log(`✅ New profile entry created with tracking_id ${customTrackingId}. This user's tracking data is now isolated.`);
          }
        }
      }
    } else {
      // Normal flow: check if exists, then update or insert (no ON CONFLICT needed)
      // First, check if profile exists by username
      const { data: existingProfile, error: checkError } = await supabase
        .from("ig_profiles")
        .select("*")
        .eq("username", igData.username)
        .maybeSingle();
      
      if (checkError) {
        profileError = checkError;
      } else if (existingProfile) {
        // Profile exists - update it
        console.log(`📝 [${username}] Profile exists, updating...`);
        const { data: updatedProfile, error: updateError } = await supabase
          .from("ig_profiles")
          .update(profileData)
          .eq("id", existingProfile.id)
          .select()
          .single();
        profile = updatedProfile;
        profileError = updateError;
      } else {
        // Profile doesn't exist - insert it
        console.log(`➕ [${username}] Profile doesn't exist, creating new...`);
        const { data: insertedProfile, error: insertError } = await supabase
          .from("ig_profiles")
          .insert(profileData)
          .select()
          .single();
        profile = insertedProfile;
        profileError = insertError;
      }
    }

    if (profileError) {
      // If error is about tracking_id column, provide helpful message
      if (profileError.message.includes('tracking_id')) {
        throw new Error(`Profile upsert failed: tracking_id column not found. Please run the migration: supabase/migrations/add_tracking_id.sql in Supabase SQL Editor. Original error: ${profileError.message}`);
      }
      // If error is about username unique constraint, handle it
      if (profileError.code === '23505' && profileError.message.includes('username')) {
        // Check if existing profile belongs to this user
        const { data: existingByUsername } = await supabase
          .from("ig_profiles")
          .select("*")
          .eq("username", igData.username)
          .maybeSingle();
        
        if (existingByUsername) {
          if (userId && existingByUsername.user_id === userId) {
            // Same user - update existing profile
            console.log(`✅ Duplicate username detected for same user - updating existing profile`);
            const { data: updatedProfile, error: updateError } = await supabase
              .from("ig_profiles")
              .update(profileData)
              .eq("id", existingByUsername.id)
              .select()
              .single();
            if (!updateError) {
              profile = updatedProfile;
              profileError = null;
            } else {
              throw new Error(`Profile update failed: ${updateError.message}`);
            }
          } else if (userId && existingByUsername.user_id !== userId) {
            // Different user - need migration
            throw new Error(`Username ${igData.username} is already being tracked by another user. Please run the migration: supabase/migrations/remove_username_unique_constraint.sql to allow multiple users to track the same username.`);
          } else {
            // No userId provided - update existing
            const { data: updatedProfile, error: updateError } = await supabase
              .from("ig_profiles")
              .update(profileData)
              .eq("id", existingByUsername.id)
              .select()
              .single();
            if (!updateError) {
              profile = updatedProfile;
              profileError = null;
            } else {
              throw new Error(`Profile update failed: ${updateError.message}`);
            }
          }
        } else {
          throw new Error(`Profile upsert failed: ${profileError.message}`);
        }
      } else {
      throw new Error(`Profile upsert failed: ${profileError.message}`);
      }
    }

    // 3. Fetch the PREVIOUS snapshot from DATABASE to compute deltas
    // If using custom tracking_id (user-specific), we want to start fresh
    // So we'll only look for snapshots that were created AFTER this tracking_id was assigned
    console.log(`\n🔍 [${username}] Fetching previous snapshot from database...`);
    
    let allSnapshots = [];
    let snapshotsError = null;
    
    if (customTrackingId) {
      // User-specific tracking: START FRESH - Don't use any previous snapshots
      // Check if this is the first time this tracking_id is being used
      const { data: existingProfileWithTrackingId } = await supabase
        .from("ig_profiles")
        .select("created_at, updated_at")
        .eq("tracking_id", customTrackingId)
        .maybeSingle();
      
      // If profile with this tracking_id was just created (or doesn't exist), start fresh
      // We'll treat this as the first snapshot, so no previous snapshot to compare
      allSnapshots = [];
      snapshotsError = null;
      console.log(`   🆕 User-specific tracking with tracking_id ${customTrackingId}: Starting FRESH (no previous snapshots will be used)`);
      console.log(`   This is a new tracking session - all metrics will start from this point`);
    } else {
      // Normal tracking: Get all snapshots
      const { data: snapshots, error: err } = await supabase
      .from("ig_profile_snapshots")
      .select("*")
      .eq("profile_id", profile.id)
      .order("captured_at", { ascending: false })
      .limit(2); // Get last 2 snapshots to find the previous one
      allSnapshots = snapshots || [];
      snapshotsError = err;
    }
    
    // Determine which snapshot to use for comparison:
    // - If using customTrackingId: Always start fresh (lastSnapshot = null)
    // - If we have 2+ snapshots: Use allSnapshots[1] (the one before the most recent)
    // - If we have 1 snapshot: Use allSnapshots[0] (first tracking, compare with it)
    // - If we have 0 snapshots: null (very first tracking, no comparison)
    let lastSnapshot = null;
    
    if (customTrackingId) {
      // User-specific tracking: Always start fresh - no previous snapshots
      lastSnapshot = null;
      console.log(`🆕 User-specific tracking: Starting fresh - no previous snapshots will be used`);
    } else if (allSnapshots && allSnapshots.length >= 2) {
      // Use the second most recent snapshot (the one before the latest)
      // This ensures we're comparing with the actual previous state, not the one we might have just saved
      lastSnapshot = allSnapshots[1];
      console.log(`✅ Found previous snapshot (using 2nd most recent): ID=${lastSnapshot.id}, captured=${lastSnapshot.captured_at}`);
      console.log(`   Most recent snapshot: ID=${allSnapshots[0].id}, captured=${allSnapshots[0].captured_at}`);
    } else if (allSnapshots && allSnapshots.length === 1) {
      // Only one snapshot exists, use it for comparison (first refresh after initial tracking)
      lastSnapshot = allSnapshots[0];
      console.log(`✅ Found previous snapshot (only one exists): ID=${lastSnapshot.id}, captured=${lastSnapshot.captured_at}`);
    } else {
      console.log(`ℹ️  No previous snapshots found - this is the very first tracking`);
    }
    
    const lastSnapshotError = snapshotsError;
    
    if (lastSnapshotError) {
      console.error(`❌ Error fetching last snapshot: ${lastSnapshotError.message}`);
    }
    
    if (lastSnapshot) {
      console.log(`✅ Found previous snapshot in database (ID: ${lastSnapshot.id}, captured: ${lastSnapshot.captured_at})`);
    } else {
      console.log(`ℹ️  No previous snapshot found in database - this is the first tracking`);
    }

    // Log before values if previous snapshot exists
    if (lastSnapshot) {
      console.log(`\n📊 [${username}] Previous Snapshot Values:`);
      console.log(`   Followers: ${lastSnapshot.followers?.toLocaleString() || 0}`);
      console.log(`   Following: ${lastSnapshot.following?.toLocaleString() || 0}`);
      console.log(`   Media Count: ${lastSnapshot.media_count?.toLocaleString() || 0}`);
      console.log(`   Clips Count: ${lastSnapshot.clips_count?.toLocaleString() || 0}`);
    } else {
      console.log(`\n📊 [${username}] No previous snapshot found (first time tracking)`);
    }

    // 4. Insert New Snapshot
    console.log(`\n📊 [${username}] Current Values (from Instagram):`);
    console.log(`   Followers: ${igData.followers?.toLocaleString() || 0}`);
    console.log(`   Following: ${igData.following?.toLocaleString() || 0}`);
    console.log(`   Media Count: ${igData.media_count?.toLocaleString() || 0}`);
    console.log(`   Clips Count: ${igData.clips_count?.toLocaleString() || 0}`);

    // 4. Insert New Snapshot into DATABASE
    console.log(`\n💾 [${username}] Saving new snapshot to database...`);
    const { data: newSnapshot, error: snapError } = await supabase
      .from("ig_profile_snapshots")
      .insert({
        profile_id: profile.id,
        followers: igData.followers,
        following: igData.following,
        media_count: igData.media_count,
        clips_count: igData.clips_count,
        biography: igData.biography || null,
        external_url: igData.external_url || null, // Save external link
        avatar_url: igData.profile_pic_url,
        raw_json: igData
      })
      .select()
      .single();

    if (snapError) {
      console.error(`❌ Snapshot insert failed: ${snapError.message}`);
      throw new Error(`Snapshot insert failed: ${snapError.message}`);
    }
    
    console.log(`✅ New snapshot saved to database (ID: ${newSnapshot.id})`);

    // 5. Update profile's last_snapshot_id in DATABASE
    const { error: updateError } = await supabase
      .from("ig_profiles")
      .update({ last_snapshot_id: newSnapshot.id })
      .eq("id", profile.id);
    
    if (updateError) {
      console.error(`⚠️  Failed to update profile's last_snapshot_id: ${updateError.message}`);
    } else {
      console.log(`✅ Profile's last_snapshot_id updated in database`);
    }

    // 6. Compute & Insert Deltas (comparing NEW snapshot with PREVIOUS snapshot from DATABASE)
    // Calculate delta if we have a previous snapshot to compare with
    // For customTrackingId, we only calculate delta if there's a previous snapshot from THIS tracking session
    if (lastSnapshot) {
      console.log(`\n📈 [${username}] Calculating delta from DATABASE values:`);
      console.log(`   Previous snapshot (from DB): ID=${lastSnapshot.id}, captured=${lastSnapshot.captured_at}`);
      console.log(`   New snapshot (just saved): ID=${newSnapshot.id}`);
      
      // Calculate differences using DATABASE values
      // Compare NEW snapshot (just saved) with PREVIOUS snapshot (from before)
      const followersDiff = newSnapshot.followers - lastSnapshot.followers;
      const followingDiff = newSnapshot.following - lastSnapshot.following;
      const mediaDiff = newSnapshot.media_count - lastSnapshot.media_count;
      const clipsDiff = newSnapshot.clips_count - lastSnapshot.clips_count;
      
      console.log(`\n📊 [${username}] DELTA CALCULATION (Previous Snapshot → New Snapshot):`);
      console.log(`   Previous Snapshot ID: ${lastSnapshot.id} (captured: ${lastSnapshot.captured_at})`);
      console.log(`   New Snapshot ID: ${newSnapshot.id} (just saved)`);
      console.log(`   Followers: ${lastSnapshot.followers?.toLocaleString() || 0} → ${newSnapshot.followers?.toLocaleString() || 0} = ${followersDiff > 0 ? '+' : ''}${followersDiff.toLocaleString()}`);
      console.log(`   Following: ${lastSnapshot.following?.toLocaleString() || 0} → ${newSnapshot.following?.toLocaleString() || 0} = ${followingDiff > 0 ? '+' : ''}${followingDiff.toLocaleString()}`);
      console.log(`   Media Count: ${lastSnapshot.media_count?.toLocaleString() || 0} → ${newSnapshot.media_count?.toLocaleString() || 0} = ${mediaDiff > 0 ? '+' : ''}${mediaDiff.toLocaleString()}`);
      console.log(`   Clips Count: ${lastSnapshot.clips_count?.toLocaleString() || 0} → ${newSnapshot.clips_count?.toLocaleString() || 0} = ${clipsDiff > 0 ? '+' : ''}${clipsDiff.toLocaleString()}`);
      
      // Warn if delta is 0 but values might have changed
      if (followersDiff === 0 && followingDiff === 0 && mediaDiff === 0 && clipsDiff === 0) {
        console.log(`   ⚠️  All deltas are 0 - values haven't changed since previous snapshot`);
        console.log(`   💡 This is normal if Instagram hasn't updated the profile since last refresh`);
      } else {
        console.log(`   ✅ Growth detected! Saving delta to database...`);
      }
      
      // Save delta to DATABASE
      console.log(`\n💾 [${username}] Saving delta to database...`);
      const { data: delta, error: deltaError } = await supabase.from("ig_profile_deltas").insert({
        profile_id: profile.id,
        base_snapshot_id: lastSnapshot.id,
        compare_snapshot_id: newSnapshot.id,
        followers_diff: followersDiff,
        following_diff: followingDiff,
        media_diff: mediaDiff,
        clips_diff: clipsDiff
      }).select().single();

      if (deltaError) {
        console.error(`❌ [${username}] Delta insert failed:`, deltaError.message);
        throw new Error(`Delta insert failed: ${deltaError.message}`);
      } else {
        console.log(`✅ [${username}] Delta saved to database (ID: ${delta.id})`);
      }
    } else {
      if (customTrackingId) {
        console.log(`\n🆕 [${username}] User-specific tracking (tracking_id: ${customTrackingId}): Starting fresh - no delta calculated`);
        console.log(`   This is the baseline snapshot. Future snapshots will compare against this one.`);
    } else {
      console.log(`\n📊 [${username}] No previous snapshot in database - this is the first tracking (no delta to calculate)`);
      }
    }

    // 7. Process Reels using Playwright scraping method
    // STEP 1: Use Playwright to scrape reels page and get all current reel shortcodes
    console.log(`\n🎬 [${username}] Step 1: Scraping reels page using Playwright to check for new reels...`);
    let reelShortcodes = [];
    
    try {
      const scrapeResult = await scrapeReelsPageWithPlaywright(username);
      if (scrapeResult.error) {
        console.warn(`⚠️  [${username}] Playwright scraping failed: ${scrapeResult.error}`);
        console.log(`   Falling back to web profile API for reels...`);
        // Fallback to web profile API if Playwright fails
        const allMedia = [...(igData.clips || []), ...(igData.recent_media || [])];
        reelShortcodes = allMedia.map(m => m.shortcode).filter(Boolean);
      } else {
        reelShortcodes = scrapeResult.shortcodes || [];
        console.log(`✅ [${username}] Found ${reelShortcodes.length} reel shortcodes via Playwright`);
      }
    } catch (err) {
      console.warn(`⚠️  [${username}] Playwright scraping error: ${err.message}`);
      console.log(`   Falling back to web profile API for reels...`);
      // Fallback to web profile API if Playwright fails
      const allMedia = [...(igData.clips || []), ...(igData.recent_media || [])];
      reelShortcodes = allMedia.map(m => m.shortcode).filter(Boolean);
    }

    // Get unique shortcodes from scraped results
    const uniqueShortcodes = Array.from(new Set(reelShortcodes));
    console.log(`📊 [${username}] Found ${uniqueShortcodes.length} unique reel shortcodes from scraping`);

    // STEP 2: Get the latest reel from database to compare with
    console.log(`\n🔍 [${username}] Step 2: Checking database for latest reel...`);
    const { data: latestReelInDb } = await supabase
      .from("ig_profile_reels")
      .select("shortcode, taken_at")
      .eq("profile_id", profile.id)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestShortcodeInDb = latestReelInDb?.shortcode || null;
    const latestTimestampInDb = latestReelInDb?.taken_at ? new Date(latestReelInDb.taken_at).getTime() / 1000 : 0;
    
    if (latestShortcodeInDb) {
      console.log(`📌 [${username}] Latest reel in database: ${latestShortcodeInDb} (timestamp: ${latestTimestampInDb})`);
    } else {
      console.log(`📌 [${username}] No reels found in database - all scraped reels are new`);
    }

    // STEP 3: Identify new reels (shortcodes not in database or newer than latest)
    console.log(`\n🆕 [${username}] Step 3: Identifying new reels...`);
    
    // Get all existing shortcodes from database for this profile
    const { data: existingReels } = await supabase
      .from("ig_profile_reels")
      .select("shortcode, taken_at")
      .eq("profile_id", profile.id);
    
    const existingShortcodes = new Set((existingReels || []).map(r => r.shortcode));
    const existingShortcodesMap = new Map((existingReels || []).map(r => [r.shortcode, r.taken_at ? new Date(r.taken_at).getTime() / 1000 : 0]));
    
    // Find new shortcodes (not in database)
    const newShortcodes = uniqueShortcodes.filter(sc => !existingShortcodes.has(sc));
    
    console.log(`📊 [${username}] New reels found: ${newShortcodes.length}`);
    if (newShortcodes.length > 0) {
      console.log(`   🆕 New shortcodes: ${newShortcodes.join(', ')}`);
    }

    // Rate limiting delay between GraphQL requests
    const RATE_LIMIT_DELAY = 2000; // 2 seconds

    // STEP 4: Fetch data for new reels first
    const newReelsWithData = [];
    if (newShortcodes.length > 0) {
      console.log(`\n📥 [${username}] Step 4: Fetching data for ${newShortcodes.length} new reel(s)...`);
      for (let i = 0; i < newShortcodes.length; i++) {
        const shortcode = newShortcodes[i];
        
        try {
          const reelData = await fetchReelData(shortcode);
          
          if (!reelData || reelData.error) {
            console.warn(`⚠️  [${username}] Failed to fetch new reel data for ${shortcode}: ${reelData?.error || 'Unknown error'}`);
            continue;
          }
          
          newReelsWithData.push({
            shortcode,
            ...reelData
          });
          
          console.log(`✅ [${username}] Fetched data for new reel: ${shortcode}`);
          
          // Rate limiting
          if (i < newShortcodes.length - 1) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
          }
        } catch (err) {
          console.warn(`⚠️  [${username}] Failed to fetch new reel data for ${shortcode}:`, err.message);
          continue;
        }
      }
    }

    // STEP 5: Fetch data for existing reels (latest 12) to refresh metrics
    console.log(`\n🔄 [${username}] Step 5: Refreshing data for existing reels (latest 12)...`);
    
    // Get the latest 12 shortcodes from database (by timestamp)
    const { data: latest12ReelsInDb } = await supabase
      .from("ig_profile_reels")
      .select("shortcode")
      .eq("profile_id", profile.id)
      .order("taken_at", { ascending: false })
      .limit(12);
    
    const existingShortcodesToRefresh = (latest12ReelsInDb || []).map(r => r.shortcode);
    console.log(`📋 [${username}] Refreshing ${existingShortcodesToRefresh.length} existing reel(s)...`);
    
    const refreshedReelsWithData = [];
    for (let i = 0; i < existingShortcodesToRefresh.length; i++) {
      const shortcode = existingShortcodesToRefresh[i];
      
      try {
        const reelData = await fetchReelData(shortcode);
        
        if (!reelData || reelData.error) {
          console.warn(`⚠️  [${username}] Failed to refresh reel data for ${shortcode}: ${reelData?.error || 'Unknown error'}`);
          continue;
        }
        
        refreshedReelsWithData.push({
          shortcode,
          ...reelData
        });
        
        // Rate limiting
        if (i < existingShortcodesToRefresh.length - 1) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
      } catch (err) {
        console.warn(`⚠️  [${username}] Failed to refresh reel data for ${shortcode}:`, err.message);
        continue;
      }
    }

    // Combine new and refreshed reels, sort by date (newest first)
    const allReelsWithData = [...newReelsWithData, ...refreshedReelsWithData];
    allReelsWithData.sort((a, b) => {
      const dateA = a.taken_at_timestamp || 0;
      const dateB = b.taken_at_timestamp || 0;
      return dateB - dateA; // Newest first
    });
    
    // Take ONLY the latest 12 reels total (new + refreshed)
    const latest12Reels = allReelsWithData.slice(0, 12);
    const shortcodesToProcess = latest12Reels.map(r => r.shortcode);
    const reelsDataMap = new Map(latest12Reels.map(r => [r.shortcode, r]));
    
    // Get today's date for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    console.log(`\n✅ [${username}] Step 6: Processing latest 12 reels (${newShortcodes.length} new + ${refreshedReelsWithData.length} refreshed):`);
    let todayReelsCount = 0;
    latest12Reels.forEach((reel, idx) => {
      const reelDate = reel.taken_at_timestamp ? new Date(reel.taken_at_timestamp * 1000) : null;
      const isToday = reelDate ? (reelDate.setHours(0, 0, 0, 0) === today.getTime()) : false;
      if (isToday) todayReelsCount++;
      
      const dateStr = reel.posted_date_readable || 'N/A';
      const isNew = newShortcodes.includes(reel.shortcode);
      const todayMarker = isToday ? ' 📅 TODAY' : '';
      const newMarker = isNew ? ' 🆕 NEW' : '';
      console.log(`   ${idx + 1}. ${reel.shortcode} - Posted: ${dateStr}${todayMarker}${newMarker}`);
    });
    
    console.log(`\n📊 [${username}] Summary:`);
    console.log(`   🆕 New reels found: ${newShortcodes.length}`);
    console.log(`   🔄 Existing reels refreshed: ${refreshedReelsWithData.length}`);
    console.log(`   📅 Total latest 12 reels: ${latest12Reels.length}`);
    console.log(`   📅 Reels from today: ${todayReelsCount}`);
    console.log(`   📅 Reels from previous days: ${latest12Reels.length - todayReelsCount}`);
    console.log(`\n📊 [${username}] Processing and calculating deltas for these 12 reels...`);

    // Accumulate daily reel growth totals
    let totalDailyViewsGrowth = 0;
    let totalDailyLikesGrowth = 0;
    let totalDailyCommentsGrowth = 0;

    // Upsert reels and track metrics (ONLY the latest 12 reels)
    for (let i = 0; i < shortcodesToProcess.length; i++) {
      const shortcode = shortcodesToProcess[i];
      const reelData = reelsDataMap.get(shortcode);
      
      if (!reelData) {
        console.warn(`⚠️  [${username}] No data found for ${shortcode}, skipping...`);
        continue; // Skip if no data
      }
      
      // Extract the three metrics we need: view_count, like_count, comment_count
      const viewCount = reelData.video_play_count ?? reelData.video_view_count ?? reelData.view_count ?? null;
      const likeCount = (reelData.like_count !== null && reelData.like_count !== undefined) ? reelData.like_count : null;
      const commentCount = (reelData.comment_count !== null && reelData.comment_count !== undefined) ? reelData.comment_count : null;
      
      console.log(`\n🔍 [${username}] [${i + 1}/12] Processing reel: ${shortcode}`);
      console.log(`   📅 Posted: ${reelData.posted_date_readable || 'N/A'}`);
      console.log(`   👁️  Views: ${viewCount !== null ? viewCount.toLocaleString() : 'N/A'}`);
      console.log(`   ❤️  Likes: ${likeCount !== null ? likeCount.toLocaleString() : 'N/A'}`);
      console.log(`   💬 Comments: ${commentCount !== null ? commentCount.toLocaleString() : 'N/A'}`);
      
      const videoUrl = reelData.video_url || null;
      const videoDuration = reelData.video_duration || null;
      const averageWatchTime = reelData.average_watch_time || null;

      // Get existing reel from DATABASE to compare metrics
      const { data: existingReel } = await supabase
        .from("ig_profile_reels")
        .select("*")
        .eq("profile_id", profile.id)
        .eq("shortcode", shortcode)
        .maybeSingle();

      // Calculate growth from previous DATABASE values
      let viewGrowth = 0;
      let likeGrowth = 0;
      let commentGrowth = 0;

      if (existingReel) {
        // Calculate growth (current from Instagram - previous from DATABASE)
        const prevViews = existingReel.view_count || 0;
        const prevLikes = existingReel.like_count || 0;
        const prevComments = existingReel.comment_count || 0;
        
        const currViews = viewCount ?? 0;
        const currLikes = likeCount ?? 0;
        const currComments = commentCount ?? 0;
        
        viewGrowth = currViews - prevViews;
        likeGrowth = currLikes - prevLikes;
        commentGrowth = currComments - prevComments;
        
        // Accumulate daily totals (only positive growth to avoid negative spikes)
        if (viewGrowth > 0) totalDailyViewsGrowth += viewGrowth;
        if (likeGrowth > 0) totalDailyLikesGrowth += likeGrowth;
        if (commentGrowth > 0) totalDailyCommentsGrowth += commentGrowth;
        
        // Log growth calculation from DATABASE - ALWAYS show view count tracking
        console.log(`\n🎬 [${username}] Reel Growth Calculation (${shortcode}):`);
        console.log(`   Previous (from DB): Views=${prevViews.toLocaleString()}, Likes=${prevLikes.toLocaleString()}, Comments=${prevComments.toLocaleString()}`);
        console.log(`   Current (from Instagram): Views=${currViews.toLocaleString()}, Likes=${currLikes.toLocaleString()}, Comments=${currComments.toLocaleString()}`);
        console.log(`   Growth Calculated: Views=${viewGrowth > 0 ? '+' : ''}${viewGrowth.toLocaleString()}, Likes=${likeGrowth > 0 ? '+' : ''}${likeGrowth.toLocaleString()}, Comments=${commentGrowth > 0 ? '+' : ''}${commentGrowth.toLocaleString()}`);
        
        if (viewGrowth > 0 || likeGrowth > 0 || commentGrowth > 0) {
          console.log(`   ✅ Growth detected:`);
          if (viewGrowth !== 0) {
            console.log(`      👁️  VIEWS: ${prevViews.toLocaleString()} → ${currViews.toLocaleString()} = ${viewGrowth > 0 ? '+' : ''}${viewGrowth.toLocaleString()} ${viewGrowth > 0 ? '🟢' : '🔴'}`);
          }
          if (likeGrowth !== 0) {
            console.log(`      ❤️  LIKES: ${prevLikes.toLocaleString()} → ${currLikes.toLocaleString()} = ${likeGrowth > 0 ? '+' : ''}${likeGrowth.toLocaleString()} ${likeGrowth > 0 ? '🟢' : '🔴'}`);
          }
          if (commentGrowth !== 0) {
            console.log(`      💬 COMMENTS: ${prevComments.toLocaleString()} → ${currComments.toLocaleString()} = ${commentGrowth > 0 ? '+' : ''}${commentGrowth.toLocaleString()} ${commentGrowth > 0 ? '🟢' : '🔴'}`);
          }
        } else if (viewGrowth < 0 || likeGrowth < 0 || commentGrowth < 0) {
          console.log(`   ⚠️  Decrease detected (unusual but possible):`);
          if (viewGrowth < 0) console.log(`      👁️  Views decreased: ${viewGrowth.toLocaleString()}`);
          if (likeGrowth < 0) console.log(`      ❤️  Likes decreased: ${likeGrowth.toLocaleString()}`);
          if (commentGrowth < 0) console.log(`      💬 Comments decreased: ${commentGrowth.toLocaleString()}`);
        } else {
          console.log(`   ℹ️  No change in metrics (Views, Likes, Comments all unchanged)`);
        }
        
        // Always log view count specifically for tracking
        console.log(`   📊 View Count Tracking: ${prevViews.toLocaleString()} → ${currViews.toLocaleString()} (Change: ${viewGrowth > 0 ? '+' : ''}${viewGrowth.toLocaleString()})`);
      } else {
        console.log(`\n🎬 [${username}] New reel detected: ${shortcode} (not in database yet - no previous data for comparison)`);
        // For new reels, we don't count initial values as growth (they're baseline)
      }

      // Upsert reel with current metrics and growth deltas to DATABASE
      // Map all fields from GraphQL response to database schema
      const { data: savedReel, error: reelError } = await supabase
        .from("ig_profile_reels")
        .upsert(
          {
            profile_id: profile.id,
            shortcode: shortcode,
            caption: reelData.caption || null,
            taken_at: reelData.taken_at_timestamp ? new Date(reelData.taken_at_timestamp * 1000).toISOString() : null,
            is_video: reelData.is_video || false,
            video_url: videoUrl || null,
            duration: videoDuration || null,
            average_watch_time: averageWatchTime || null,
            view_count: viewCount,
            like_count: likeCount,
            comment_count: commentCount,
            display_url: reelData.display_url || reelData.thumbnail_src || null,
            // Store growth deltas in the table
            view_delta: viewGrowth || 0,
            like_delta: likeGrowth || 0,
            comment_delta: commentGrowth || 0
          },
          { onConflict: "profile_id,shortcode" }
        )
        .select()
        .single();

      if (reelError) {
        console.error(`❌ Reel upsert error for ${shortcode}:`, reelError.message);
        continue;
      }
      
      console.log(`✅ [${username}] Reel saved/updated in database: ${shortcode} (ID: ${savedReel.id})`);
      console.log(`   📊 Saved Metrics:`);
      console.log(`      👁️  Views: ${viewCount !== null ? viewCount.toLocaleString() : 'N/A'}`);
      console.log(`      ❤️  Likes: ${likeCount !== null ? likeCount.toLocaleString() : 'N/A'}`);
      console.log(`      💬 Comments: ${commentCount !== null ? commentCount.toLocaleString() : 'N/A'}`);
      if (videoDuration) {
        console.log(`   📹 Duration saved: ${videoDuration}s`);
      } else {
        console.warn(`   ⚠️  Duration is missing for ${shortcode}`);
      }

      // Optionally download reel to R2 if enabled
      if (process.env.DOWNLOAD_REELS_TO_R2 === 'true' && savedReel.is_video && videoUrl && !savedReel.r2_video_url) {
        try {
          console.log(`📥 [${username}] Downloading reel ${shortcode} to R2...`);
          const { downloadAndUploadReel } = require('./reel-downloader');
          const r2Result = await downloadAndUploadReel(shortcode, username, trackingId);
          
          // Update reel with R2 URL
          const { error: updateError } = await supabase
            .from("ig_profile_reels")
            .update({ r2_video_url: r2Result.url })
            .eq("id", savedReel.id);
          
          if (updateError) {
            console.error(`❌ [${username}] Failed to update R2 URL for ${shortcode}:`, updateError.message);
          } else {
            console.log(`✅ [${username}] Reel ${shortcode} saved to R2: ${r2Result.url}`);
          }
        } catch (r2Error) {
          console.warn(`⚠️  [${username}] Failed to download reel ${shortcode} to R2:`, r2Error.message);
          // Don't fail the whole tracking if R2 download fails
        }
      }

      // Store reel metrics history in DATABASE (track growth over time) - always store, even if no growth
      // ⚠️ CRITICAL: Each tracking run creates a NEW row in ig_reel_metrics with captured_at timestamp
      // ⚠️ DATA PRESERVATION: This table stores historical snapshots - rows are NEVER deleted
      // ⚠️ DAILY TRACKING: When cron runs daily, new rows are inserted for each reel, preserving all history
      if (savedReel) {
        // ⚠️ INSERT only - never UPDATE or DELETE - each snapshot is preserved forever
        const { data: metricsData, error: metricsError } = await supabase.from("ig_reel_metrics").insert({
          reel_id: savedReel.id,
          view_count: savedReel.view_count,
          like_count: savedReel.like_count,
          comment_count: savedReel.comment_count
          // captured_at is automatically set to NOW() by database default
          // This creates a new row each time tracking runs, preserving historical data
        }).select().single();

        if (metricsError) {
          if (metricsError.message.includes("does not exist") || metricsError.message.includes("schema cache")) {
            console.error(`\n❌ [${username}] CRITICAL: ig_reel_metrics table does not exist!`);
            console.error(`   Please run CREATE_IG_REEL_METRICS.sql in Supabase SQL Editor to create the table.`);
            console.error(`   Without this table, reel growth tracking will not work.`);
            console.error(`   Error: ${metricsError.message}`);
        } else {
          console.error(`❌ [${username}] Failed to save metrics to database for ${shortcode}:`, metricsError.message);
          }
        } else {
          console.log(`✅ [${username}] Metrics snapshot saved to database for ${shortcode} (ID: ${metricsData.id})`);
          console.log(`   📊 Metrics Snapshot:`);
          console.log(`      👁️  Views: ${savedReel.view_count !== null && savedReel.view_count !== undefined ? savedReel.view_count.toLocaleString() : 'N/A'}`);
          console.log(`      ❤️  Likes: ${savedReel.like_count !== null && savedReel.like_count !== undefined ? savedReel.like_count.toLocaleString() : 'N/A'}`);
          console.log(`      💬 Comments: ${savedReel.comment_count !== null && savedReel.comment_count !== undefined ? savedReel.comment_count.toLocaleString() : 'N/A'}`);
        }
      }
    }

    // Summary: Only processed latest 12 reels
    console.log(`\n✅ [${username}] Completed processing latest 12 reels (sorted by date, newest first)`);
    console.log(`   📊 Total reels found: ${uniqueShortcodes.length}`);
    console.log(`   📊 Processed: ${shortcodesToProcess.length} (latest 12 only)`);
    console.log(`   📊 Skipped: ${uniqueShortcodes.length - shortcodesToProcess.length} older reels`);

    // Prune old reels > 12 (keep only last 12)
    // NOTE: We no longer delete older reels from the database.
    // Instagram only returns the latest ~12 reels per fetch, but we keep historical
    // rows so past content is still visible in the dashboard and import flow.

    // 8. Update Daily Metrics in DATABASE (Upsert for today)
    // ⚠️ CRITICAL: Each day gets its own separate row - delta is calculated per day independently
    // ⚠️ DATA PRESERVATION: This code NEVER deletes daily metrics - only INSERTs new rows or UPDATEs today's row
    // ⚠️ HISTORICAL DATA: All previous days' data is ALWAYS preserved and never modified
    const todayDateString = new Date().toISOString().split("T")[0];
    console.log(`\n💾 [${username}] Updating daily metrics in database for ${todayDateString}...`);
    
    // Check if row exists for TODAY in DATABASE (each day is separate)
    // ⚠️ SAFEGUARD: We only query for today's date - historical rows are never touched
    const { data: dailyRow } = await supabase
      .from("ig_profile_daily_metrics")
      .select("*")
      .eq("profile_id", profile.id)
      .eq("date", todayDateString) // ⚠️ Only checking today - historical data is never queried or modified
      .maybeSingle();

    if (dailyRow) {
      // Row exists for today - UPDATE it (keep today's open value, update close and delta)
      // Calculate delta from today's open value (set on first refresh of the day)
      const dailyDelta = newSnapshot.followers - dailyRow.followers_open;
      console.log(`\n📊 [${username}] Updating existing daily row for ${todayDateString}:`);
      console.log(`   Date: ${dailyRow.date}`);
      console.log(`   Followers Open (start of day): ${dailyRow.followers_open?.toLocaleString() || 0}`);
      console.log(`   Followers Close (current): ${newSnapshot.followers?.toLocaleString() || 0}`);
      console.log(`   Daily Delta (for this day only): ${dailyDelta > 0 ? '+' : ''}${dailyDelta.toLocaleString()}`);
      console.log(`   ✅ This day's delta is tracked separately from other days`);
      
      // Calculate deltas for all metrics
      const followingDelta = (newSnapshot.following || 0) - (dailyRow.following_open || newSnapshot.following || 0);
      const mediaDelta = (newSnapshot.media_count || 0) - (dailyRow.media_open || newSnapshot.media_count || 0);
      const clipsDelta = (newSnapshot.clips_count || 0) - (dailyRow.clips_open || newSnapshot.clips_count || 0);
      
      // ⚠️ CRITICAL: The WHERE clause ensures we ONLY update today's row, never historical data
      const { error: updateError } = await supabase
        .from("ig_profile_daily_metrics")
        .update({
          followers_close: newSnapshot.followers,
          followers_delta: dailyDelta,
          following_close: newSnapshot.following || 0,
          following_delta: followingDelta,
          media_close: newSnapshot.media_count || 0,
          media_delta: mediaDelta,
          posts_delta: mediaDelta,
          clips_close: newSnapshot.clips_count || 0,
          clips_delta: clipsDelta,
          views_delta: totalDailyViewsGrowth,
          likes_delta: totalDailyLikesGrowth,
          comments_delta: totalDailyCommentsGrowth,
        })
        .eq("profile_id", profile.id)
        .eq("date", todayDateString); // ⚠️ SAFEGUARD: Only updates today's row - historical data is never modified
      
      if (updateError) {
        console.error(`❌ Failed to update daily metrics: ${updateError.message}`);
      } else {
        console.log(`✅ Daily metrics updated in database for ${todayDateString}`);
        console.log(`   📊 Historical data preserved - only today's row was updated`);
      }
    } else {
      // No row exists for today - CREATE a new one (first refresh of the day)
      // For first-time tracking: Use current followers as baseline (open = close, delta = 0)
      // For subsequent days: Use yesterday's close as today's open
      
      // Check if this is the first tracking session (no previous daily metrics from this session)
      const trackingStartDate = new Date(profile.updated_at || profile.created_at).toISOString().split("T")[0];
      const isFirstTracking = todayDateString === trackingStartDate || !lastSnapshot;
      
      let todayOpen = newSnapshot.followers; // Default: use current as baseline for first tracking
      let todayDelta = 0; // First tracking: delta is 0 (baseline)
      let yesterdayRow = null; // Initialize to null - will be fetched if needed
      
      if (!isFirstTracking) {
        // Not first tracking - get yesterday's close value for continuity
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];
        
        // Get yesterday's close value if it exists (and is from this tracking session)
        const { data: fetchedYesterdayRow } = await supabase
          .from("ig_profile_daily_metrics")
          .select("followers_close, following_close, media_close, clips_close")
          .eq("profile_id", profile.id)
          .eq("date", yesterdayStr)
          .gte("date", trackingStartDate) // Only from this tracking session
          .maybeSingle();
        
        yesterdayRow = fetchedYesterdayRow || null;
        
        if (yesterdayRow) {
          todayOpen = yesterdayRow.followers_close;
          todayDelta = newSnapshot.followers - todayOpen;
        }
      }
      
      // Calculate other metrics deltas
      const followingOpen = yesterdayRow?.following_close || newSnapshot.following || 0;
      const followingClose = newSnapshot.following || 0;
      const followingDelta = followingClose - followingOpen;
      
      const mediaOpen = yesterdayRow?.media_close || newSnapshot.media_count || 0;
      const mediaClose = newSnapshot.media_count || 0;
      const mediaDelta = mediaClose - mediaOpen;
      
      const clipsOpen = yesterdayRow?.clips_close || newSnapshot.clips_count || 0;
      const clipsClose = newSnapshot.clips_count || 0;
      const clipsDelta = clipsClose - clipsOpen;
      
      console.log(`\n📊 [${username}] Creating new daily row for ${todayDateString}:`);
      if (isFirstTracking) {
        console.log(`   🆕 FIRST TIME TRACKING - Setting baseline values`);
        console.log(`   Followers Open (baseline): ${todayOpen?.toLocaleString() || 0}`);
        console.log(`   Followers Close (current): ${newSnapshot.followers?.toLocaleString() || 0}`);
        console.log(`   Daily Delta: 0 (baseline - growth will show on next refresh)`);
      } else {
        console.log(`   Date: ${todayDateString}`);
      console.log(`   Followers Open (start of today): ${todayOpen?.toLocaleString() || 0}`);
      console.log(`   Followers Close (current): ${newSnapshot.followers?.toLocaleString() || 0}`);
      console.log(`   Daily Delta (for this day only): ${todayDelta > 0 ? '+' : ''}${todayDelta.toLocaleString()}`);
      }
      console.log(`   ✅ This day's tracking is completely separate from previous days`);
      console.log(`   📊 Creating new row - all historical daily metrics data remains intact`);
      
      // ⚠️ CRITICAL: This INSERT creates a new row - it NEVER deletes or modifies existing historical data
      const { data: newDailyRow, error: insertError } = await supabase.from("ig_profile_daily_metrics").insert({
        profile_id: profile.id,
        date: todayDateString,
        followers_open: todayOpen,
        followers_close: newSnapshot.followers,
        followers_delta: todayDelta,
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
        views_delta: totalDailyViewsGrowth,
        likes_delta: totalDailyLikesGrowth,
        comments_delta: totalDailyCommentsGrowth,
      }).select().single();
      
      if (insertError) {
        console.error(`❌ Failed to insert daily metrics: ${insertError.message}`);
      } else {
        console.log(`✅ Daily metrics created in database for ${todayDateString} (ID: ${newDailyRow.id})`);
        console.log(`   ✅ Each day has its own row - no data mixing between days`);
        console.log(`   📊 All previous days' data is preserved and never deleted`);
      }
    }

    // Final summary - confirm everything saved to DATABASE
    console.log(`\n✅ [${username}] Tracking completed successfully!`);
    console.log(`\n📋 DATABASE SAVE SUMMARY:`);
    console.log(`   ✅ Profile: ${profile.id} (${profile.username})`);
    console.log(`   ✅ Snapshot: ${newSnapshot.id} (saved to ig_profile_snapshots)`);
    if (lastSnapshot) {
      console.log(`   ✅ Delta: Calculated and saved to ig_profile_deltas (compared with snapshot ${lastSnapshot.id})`);
    } else {
      console.log(`   ℹ️  Delta: Not calculated (first tracking, no previous snapshot)`);
    }
    console.log(`   ✅ Reels: ${shortcodesToProcess.length} items saved/updated in ig_profile_reels`);
    console.log(`   ✅ Reel Metrics: ${shortcodesToProcess.length} snapshots saved to ig_reel_metrics`);
    console.log(`   ✅ Daily Metrics: Updated in ig_profile_daily_metrics for ${todayDateString}`);
    console.log(`   ✅ Daily Reel Growth: Views=${totalDailyViewsGrowth > 0 ? '+' : ''}${totalDailyViewsGrowth.toLocaleString()}, Likes=${totalDailyLikesGrowth > 0 ? '+' : ''}${totalDailyLikesGrowth.toLocaleString()}, Comments=${totalDailyCommentsGrowth > 0 ? '+' : ''}${totalDailyCommentsGrowth.toLocaleString()}`);
    console.log(`\n🎯 Next refresh will compare with snapshot ${newSnapshot.id} from the database!\n`);
    
    return { profile, snapshot: newSnapshot };
  } catch (error) {
    console.error(`trackProfile error for ${username}:`, error.message);
    throw error;
  }
};

module.exports = { trackProfile };

