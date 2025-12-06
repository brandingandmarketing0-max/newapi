
const {
  USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  X_IG_APP_ID = "936619743392459",
  IG_GRAPHQL_DOC_ID = "10015901848480474",
  IG_LSD = "AVqbxe3J_YA",
  IG_ASBD_ID = "129477",
  IG_GRAPHQL_ENDPOINT = "https://www.instagram.com/api/graphql",
  IG_WEB_PROFILE_ENDPOINT = "https://www.instagram.com/api/v1/users/web_profile_info/",
  IG_USER_MEDIA_QUERY_HASH = "69cba40317214236af40e7efa697781d", // For user media pagination
  IG_USER_CLIPS_QUERY_HASH = "bc78b344a68ed16dd5d7f264681c2fd8" // For clips pagination
} = process.env;

const formatProfileResponse = (user) => {
  if (!user) return null;

  const extractEdges = (edge) =>
    edge?.edges?.map(({ node }) => ({
      id: node?.id,
      shortcode: node?.shortcode,
      caption: node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? null,
      display_url: node?.display_url ?? node?.thumbnail_src ?? null,
      thumbnail_src: node?.thumbnail_src ?? null,
      is_video: node?.is_video ?? false,
      video_url: node?.video_url ?? null, // Ensure video_url is captured if available in edges
      video_duration: node?.video_duration ?? null,
      video_view_count: node?.video_view_count ?? null,
      like_count: node?.edge_media_preview_like?.count ?? null,
      comment_count: node?.edge_media_to_comment?.count ?? null,
      taken_at_timestamp: node?.taken_at_timestamp ?? null,
      accessibility_caption: node?.accessibility_caption ?? null
    })) ?? [];

  const timelineMedia = user.edge_owner_to_timeline_media ?? {};
  const clipsMedia = user.edge_felix_video_timeline ?? {};

  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    biography: user.biography,
    external_url: user.external_url,
    category_name: user.category_name,
    is_verified: user.is_verified,
    is_private: user.is_private,
    profile_pic_url: user.profile_pic_url_hd ?? user.profile_pic_url ?? null,
    followers: user.edge_followed_by?.count ?? null,
    following: user.edge_follow?.count ?? null,
    media_count: timelineMedia.count ?? user.media_count ?? null,
    clips_count: clipsMedia.count ?? null,
    highlight_reel_count: user.highlight_reel_count ?? null,
    total_clips: clipsMedia.count ?? null,
    clips: extractEdges(clipsMedia),
    recent_media: extractEdges(timelineMedia),
    edge_mutual_followed_by: user.edge_mutual_followed_by?.count ?? null,
    connected_fb_page: user.connected_fb_page ?? null
  };
};

const fetchInstagramProfileData = async (username, retries = 3) => {
  if (!username) throw new Error("Username is required.");

  const url = new URL(IG_WEB_PROFILE_ENDPOINT);
  url.searchParams.set("username", username);

  const headers = {
    "User-Agent": USER_AGENT,
    "X-IG-App-ID": X_IG_APP_ID,
    "X-FB-LSD": IG_LSD,
    "X-ASBD-ID": IG_ASBD_ID,
    "Sec-Fetch-Site": "same-origin",
    Referer: "https://www.instagram.com/"
  };

  let response;
  let json;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Add delay between requests to avoid rate limiting
      if (attempt > 0) {
        const delayMs = 60000 * attempt; // Wait 1min, 2min, 3min for rate limits
        console.log(`Rate limited, waiting ${delayMs/1000}s before retry ${attempt + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      response = await fetch(url, { headers });
      
      // Handle rate limiting (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delayMs;
        console.warn(`🚫 [Instagram] Rate limit (429) for ${username}. Retry-After: ${retryAfter || 'not specified'}s`);
        if (attempt < retries - 1) {
          console.warn(`⏳ [Instagram] Waiting ${waitTime/1000}s before retry ${attempt + 2}/${retries}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error(`Instagram rate limit (429): Too many requests. Please wait before trying again.`);
      }
      
      // Handle 401 (authentication/rate limit related)
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.message?.includes("wait a few minutes") || errorData.require_login) {
          if (attempt < retries - 1) {
            console.warn(`⚠️  [Instagram] Rate limited by Instagram for ${username}. Will retry after delay...`);
            continue;
          }
          throw new Error(`Instagram rate limit: ${errorData.message || 'Please wait a few minutes before trying again'}`);
        }
      }

      if (!response.ok) {
        const text = await response.text();
        // Check if response indicates rate limiting
        if (response.status === 403 || (text.includes('rate limit') || text.includes('too many'))) {
          throw new Error(`Instagram rate limit: ${text.substring(0, 200)}`);
        }
        throw new Error(`Instagram profile lookup failed with ${response.status}: ${text.substring(0, 200)}`);
      }
      
      // Success - parse JSON and break out of retry loop
      json = await response.json();
      break;
    } catch (err) {
      if (attempt === retries - 1) {
        throw err;
      }
      // Continue to retry
    }
  }

  if (!json) {
    throw new Error('Failed to fetch Instagram profile data after retries');
  }
  const user = json?.data?.user;
  if (!user) {
    throw new Error("Unable to locate user profile data in response.");
  }

  // Get initial data - just use what Instagram gives us, no pagination
  const initialData = formatProfileResponse(user);
  
  // Combine clips and recent_media, deduplicate, sort by date, take last 12 total
  const allMedia = [...(initialData.clips || []), ...(initialData.recent_media || [])];
  
  // Deduplicate by shortcode
  const uniqueMedia = Array.from(
    new Map(allMedia.map(m => [m.shortcode, m])).values()
  );
  
  // Sort by taken_at_timestamp (newest first)
  uniqueMedia.sort((a, b) => (b.taken_at_timestamp || 0) - (a.taken_at_timestamp || 0));
  
  // Take only the last 12 items total
  const last12 = uniqueMedia.slice(0, 12);
  
  // Separate back into clips and recent_media for compatibility
  const clips = last12.filter(m => m.is_video && initialData.clips?.some(c => c.shortcode === m.shortcode));
  const recent_media = last12.filter(m => !clips.some(c => c.shortcode === m.shortcode));
  
  console.log(`Fetched ${last12.length} total items (${clips.length} clips, ${recent_media.length} posts)`);

  return {
    ...initialData,
    recent_media: recent_media,
    clips: clips
  };
};

// Fetch individual reel/post data to get video_url
const fetchReelData = async (shortcode) => {
  if (!shortcode) throw new Error("Shortcode is required.");

  const params = new URLSearchParams();
  params.set("variables", JSON.stringify({ shortcode }));
  params.set("doc_id", IG_GRAPHQL_DOC_ID);
  params.set("lsd", IG_LSD);

  const headers = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/x-www-form-urlencoded",
    "X-IG-App-ID": X_IG_APP_ID,
    "X-FB-LSD": IG_LSD,
    "X-ASBD-ID": IG_ASBD_ID,
    "Sec-Fetch-Site": "same-origin"
  };

  const response = await fetch(IG_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers,
    body: params.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instagram reel lookup failed with ${response.status}: ${text}`);
  }

  const json = await response.json();
  const media = json?.data?.xdt_shortcode_media;
  if (!media) {
    throw new Error("Unable to locate reel data in response.");
  }

  // Log all available fields to check for watch time metrics
  console.log(`\n🔍 [Instagram API] Available fields for reel ${media.shortcode}:`);
  console.log(`   video_duration: ${media.video_duration} (total video length in seconds)`);
  console.log(`   video_view_count: ${media.video_view_count}`);
  console.log(`   Available fields: ${Object.keys(media).join(', ')}`);
  
  // Check for any watch time related fields
  const watchTimeFields = Object.keys(media).filter(key => 
    key.toLowerCase().includes('watch') || 
    key.toLowerCase().includes('average') || 
    key.toLowerCase().includes('retention') ||
    key.toLowerCase().includes('playback')
  );
  if (watchTimeFields.length > 0) {
    console.log(`   ⚠️  Found potential watch time fields: ${watchTimeFields.join(', ')}`);
    watchTimeFields.forEach(field => {
      console.log(`      ${field}: ${JSON.stringify(media[field])}`);
    });
  } else {
    console.log(`   ❌ NO average watch time fields found in API response`);
    console.log(`   ℹ️  Only video_duration (total length) is available, not average watch time`);
  }

  // Check for average watch time (not available in public API, but check anyway)
  const averageWatchTime = media.average_watch_time || 
                          media.avg_watch_time || 
                          media.watch_time || 
                          media.view_duration || 
                          null;

  return {
    shortcode: media.shortcode,
    is_video: media.is_video,
    product_type: media.product_type,
    caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || null,
    taken_at_timestamp: media.taken_at_timestamp || null,
    video_url: media.video_url || null,
    video_duration: media.video_duration || null,
    average_watch_time: averageWatchTime, // Will be null - not available in public API
    view_count: media.video_view_count || media.video_play_count || null,
    like_count: media.edge_media_preview_like?.count || media.edge_liked_by?.count || null,
    comment_count: media.edge_media_to_comment?.count || null,
    display_url: media.display_url || media.thumbnail_src || null,
    thumbnail_src: media.thumbnail_src || null,
    dimensions: media.dimensions || null,
    owner: media.owner || null,
    location: media.location || null,
    has_audio: media.has_audio || false,
    clips_music_attribution_info: media.clips_music_attribution_info || null
  };
};

module.exports = {
  fetchInstagramProfileData,
  fetchReelData
};

