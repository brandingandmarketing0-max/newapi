
const { chromium } = require("playwright");

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

// Instagram cookies for Playwright scraping - MUST be set in .env file
// Format: "mid=xxx; sessionid=xxx; ig_did=xxx; csrftoken=xxx; datr=xxx; ig_nrcb=xxx"
// IMPORTANT: You MUST include 'sessionid' cookie for authentication!
// Get cookies from: Chrome DevTools > Application > Cookies > instagram.com
const INSTAGRAM_COOKIES = process.env.INSTAGRAM_COOKIES || "";

// Helper function to validate cookies
const validateCookies = (cookieString) => {
  if (!cookieString || cookieString.trim() === '') {
    return { valid: false, missing: ['all'], message: 'No cookies provided' };
  }
  
  const requiredCookies = ['sessionid']; // Most critical
  const recommendedCookies = ['mid', 'csrftoken', 'datr', 'ig_did'];
  const missing = [];
  const recommended = [];
  
  requiredCookies.forEach(cookie => {
    if (!cookieString.includes(`${cookie}=`)) {
      missing.push(cookie);
    }
  });
  
  recommendedCookies.forEach(cookie => {
    if (!cookieString.includes(`${cookie}=`)) {
      recommended.push(cookie);
    }
  });
  
  if (missing.length > 0) {
    return {
      valid: false,
      missing,
      recommended,
      message: `Missing required cookies: ${missing.join(', ')}`
    };
  }
  
  return {
    valid: true,
    missing: [],
    recommended,
    message: recommended.length > 0 
      ? `Cookies valid but missing recommended: ${recommended.join(', ')}`
      : 'Cookies appear valid'
  };
};

// Rate limiting configuration for GraphQL requests
const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests (base delay)
const RATE_LIMIT_RETRY_DELAY = 5000; // 5 seconds if rate limited
const MAX_RETRIES = 3; // Maximum retry attempts for rate limited requests

// Function to get instagram post ID from URL string
const getId = (url) => {
  const regex = /instagram.com\/(?:[A-Za-z0-9_.]+\/)?(p|reels|reel|stories)\/([A-Za-z0-9-_]+)/;
  const match = url.match(regex);
  return match && match[2] ? match[2] : null;
};

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

// Function to scrape reels page using Playwright (headless) - extracts reel shortcodes
// Follows exact flow: instagram.com -> set cookies -> username/reels -> extract shortcodes
const scrapeReelsPageWithPlaywright = async (username) => {
  const url = `https://www.instagram.com/${username}/reels/`;
  console.log(`\n🔍 [Playwright] Scraping reels page: ${url}`);
  
  let browser;
  let page;
  
  try {
    // Launch browser (headless by default, can be overridden with env var)
    const headlessMode = process.env.HEADLESS !== 'false';
    console.log(`🚀 [Playwright] Launching browser (${headlessMode ? 'headless' : 'visible'})...`);
    if (!headlessMode) {
      console.log(`   💡 [Playwright] Running in visible mode - useful for debugging cookie issues`);
    }
    browser = await chromium.launch({
      headless: headlessMode,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    // Create a new context with realistic settings
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: USER_AGENT,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation'],
      geolocation: { longitude: -74.006, latitude: 40.7128 },
      colorScheme: 'light',
      // Add extra headers to look more like a real browser
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      }
    });

    page = await context.newPage();

    // Enhanced stealth: Override multiple properties to avoid detection
    await page.addInitScript(() => {
      // Hide webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Mock chrome object
      window.chrome = {
        runtime: {},
      };
      
      // Override toString methods
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    // STEP 1: Navigate to instagram.com first to set cookies
    console.log(`🍪 [Playwright] Step 1: Navigating to instagram.com to set cookies...`);
    await page.goto('https://www.instagram.com', { 
      waitUntil: 'domcontentloaded', // Changed from 'networkidle' for faster loading
      timeout: 30000
    });
    
    const currentUrl = page.url();
    console.log(`   [Playwright] Current URL after navigation: ${currentUrl}`);
    
    // STEP 2: Set cookies (from env var)
    if (INSTAGRAM_COOKIES && INSTAGRAM_COOKIES.trim() !== '') {
      console.log(`🍪 [Playwright] Step 2: Setting cookies...`);
      
      // Validate cookies before using them
      const validation = validateCookies(INSTAGRAM_COOKIES);
      if (!validation.valid) {
        console.log(`   ❌ [Playwright] ${validation.message}`);
        console.log(`   ⚠️  [Playwright] Without 'sessionid', Instagram will redirect to login.`);
        console.log(`\n   📖 [Playwright] HOW TO GET COOKIES:`);
        console.log(`   1. Open Chrome and log into Instagram (instagram.com)`);
        console.log(`   2. Press F12 to open DevTools`);
        console.log(`   3. Go to: Application tab > Storage > Cookies > https://www.instagram.com`);
        console.log(`   4. Copy these cookies (right-click > Copy):`);
        console.log(`      - sessionid (REQUIRED)`);
        console.log(`      - mid`);
        console.log(`      - csrftoken`);
        console.log(`      - datr`);
        console.log(`      - ig_did`);
        console.log(`   5. Format: 'name1=value1; name2=value2; ...'`);
        console.log(`   6. Add to .env: INSTAGRAM_COOKIES='your_cookies_here'`);
      } else if (validation.recommended.length > 0) {
        console.log(`   ⚠️  [Playwright] ${validation.message}`);
      } else {
        console.log(`   ✅ [Playwright] ${validation.message}`);
      }
      
      try {
        const cookieArray = INSTAGRAM_COOKIES.split('; ').map(cookie => {
          const [name, ...valueParts] = cookie.split('=');
          const value = valueParts.join('=');
          const cookieObj = {
            name: name.trim(),
            value: value.trim(),
            domain: '.instagram.com',
            path: '/',
            secure: true,
            sameSite: 'Lax', // Changed from 'None' to 'Lax' for better compatibility
            httpOnly: name.trim() === 'sessionid' // sessionid should be httpOnly
          };
          
          // Some cookies need different domains
          if (name.trim() === 'datr') {
            cookieObj.domain = 'instagram.com';
          }
          
          return cookieObj;
        }).filter(cookie => cookie.name && cookie.value); // Filter out empty cookies
        
        console.log(`   📋 [Playwright] Parsed ${cookieArray.length} cookies`);
        cookieArray.forEach(cookie => {
          console.log(`      - ${cookie.name}${cookie.name === 'sessionid' ? ' (AUTH)' : ''}`);
        });
        
        await context.addCookies(cookieArray);
        await page.waitForTimeout(3000); // Increased wait time for cookies to settle
        
        // Verify cookies were set
        const cookiesAfter = await context.cookies();
        const sessionCookie = cookiesAfter.find(c => c.name === 'sessionid');
        if (sessionCookie) {
          console.log(`   ✅ [Playwright] Cookies set (including sessionid)`);
        } else {
          console.log(`   ⚠️  [Playwright] Cookies set but sessionid not found - may still redirect to login`);
        }
      } catch (cookieError) {
        console.warn(`   ⚠️  [Playwright] Cookie setting failed: ${cookieError.message}`);
        console.log(`   [Playwright] Continuing anyway...`);
      }
      
      // Reload page to ensure cookies are applied
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    } else {
      console.log(`   ⚠️  [Playwright] No cookies provided - will likely get redirected to login`);
    }

    // STEP 3: Navigate to username/reels page
    console.log(`📡 [Playwright] Step 3: Navigating to reels page: ${url}`);
    
    // Use a more realistic navigation pattern
    await page.goto(url, {
      waitUntil: 'domcontentloaded', // Faster than networkidle
      timeout: 60000,
      referer: 'https://www.instagram.com/' // Add referer header
    });
    
    // Wait a bit for any redirects
    await page.waitForTimeout(3000);

    // Check what page we're actually on
    const finalUrl = page.url();
    const pageTitle = await page.title();
    
    console.log(`   [Playwright] Page loaded:`);
    console.log(`      URL: ${finalUrl}`);
    console.log(`      Title: ${pageTitle}`);
    
    // Check if we're on a login page
    if (finalUrl.includes('accounts/login') || pageTitle.toLowerCase().includes('login')) {
      console.log(`\n⚠️  [Playwright] Instagram redirected to login page!`);
      console.log(`   [Playwright] This usually means:`);
      console.log(`   1. Cookies are expired or invalid`);
      console.log(`   2. Missing 'sessionid' cookie (most critical)`);
      console.log(`   3. Instagram detected automation`);
      console.log(`\n   💡 [Playwright] SOLUTION:`);
      console.log(`   1. Open Instagram in Chrome (logged in)`);
      console.log(`   2. Open DevTools (F12) > Application > Cookies > instagram.com`);
      console.log(`   3. Copy ALL cookies, especially 'sessionid'`);
      console.log(`   4. Update INSTAGRAM_COOKIES in .env file`);
      console.log(`   5. Format: 'mid=xxx; sessionid=xxx; csrftoken=xxx; datr=xxx; ...'`);
      
      // Try to continue anyway - sometimes the page still loads content
      console.log(`\n   🔄 [Playwright] Attempting to continue anyway (sometimes content loads despite redirect)...`);
      await page.waitForTimeout(5000);
      
      // Check again after waiting
      const retryUrl = page.url();
      const retryTitle = await page.title();
      
      if (retryUrl.includes('accounts/login') || retryTitle.toLowerCase().includes('login')) {
        await browser.close();
        return {
          error: "Login required",
          shortcodes: []
        };
      } else {
        console.log(`   ✅ [Playwright] Page loaded successfully after retry!`);
      }
    }

    // Wait for content to appear - look for reel links
    console.log(`⏳ [Playwright] Waiting for reel content to load...`);
    let reelLinksFound = false;
    
    try {
      // Wait for any link containing /reel/ to appear
      await page.waitForSelector('a[href*="/reel/"]', { timeout: 30000 });
      reelLinksFound = true;
      console.log(`✅ [Playwright] Found reel links on page!`);
    } catch (e) {
      console.log(`⚠️  [Playwright] No reel links found immediately, waiting longer...`);
      await page.waitForTimeout(10000);
      
      // Check again
      const reelLinks = await page.locator('a[href*="/reel/"]');
      const count = await reelLinks.count();
      if (count > 0) {
        reelLinksFound = true;
        console.log(`✅ [Playwright] Found ${count} reel links after waiting!`);
      }
    }

    // Scroll down once to load more content (Instagram lazy loads)
    if (reelLinksFound) {
      console.log(`📜 [Playwright] Scrolling once to load more content...`);
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await page.waitForTimeout(3000); // Wait 3 seconds for content to load

      // Scroll back to top
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(2000);
    }

    // Extract reel shortcodes directly from the page using Playwright
    console.log(`📄 [Playwright] Extracting reel links from page...`);
    
    // Get all reel links using Playwright's locator
    const reelLinks = await page.locator('a[href*="/reel/"]');
    const linkCount = await reelLinks.count();
    
    const reelShortcodes = new Set();
    
    // Extract shortcodes from href attributes
    for (let i = 0; i < linkCount; i++) {
      try {
        const href = await reelLinks.nth(i).getAttribute('href');
        if (href) {
          const match = href.match(/\/(?:[^\/]+\/)?reel\/([A-Za-z0-9-_]+)/);
          if (match && match[1]) {
            reelShortcodes.add(match[1]);
          }
        }
      } catch (e) {
        // Skip if element is not available
      }
    }
    
    // Also search in page content for any missed shortcodes
    const pageContent = await page.content();
    
    // Search for reel patterns in HTML
    const reelPatterns = [
      /href=["']([^"']*\/reel\/([A-Za-z0-9-_]+)[^"']*)["']/g,
      /\/(?:[^\/]+\/)?reel\/([A-Za-z0-9-_]+)/g,
      /"shortcode":"([A-Za-z0-9-_]+)"/g,
      /'shortcode':'([A-Za-z0-9-_]+)'/g
    ];
    
    reelPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(pageContent)) !== null) {
        const shortcode = match[2] || match[1];
        if (shortcode && shortcode.length > 5 && shortcode.length < 20) {
          reelShortcodes.add(shortcode);
        }
      }
    });
    
    // Search in script tags for JSON data
    const scripts = await page.locator('script').all();
    for (const script of scripts) {
      try {
        const scriptContent = await script.textContent();
        if (scriptContent && (scriptContent.includes('reel') || scriptContent.includes('shortcode'))) {
          const reelUrlRegex = /\/(?:[^\/]+\/)?reel\/([A-Za-z0-9-_]+)/g;
          let match;
          while ((match = reelUrlRegex.exec(scriptContent)) !== null) {
            reelShortcodes.add(match[1]);
          }
          
          const shortcodeRegex = /["']shortcode["']\s*:\s*["']([A-Za-z0-9-_]+)["']/g;
          while ((match = shortcodeRegex.exec(scriptContent)) !== null) {
            reelShortcodes.add(match[1]);
          }
        }
      } catch (e) {
        // Skip if can't read script
      }
    }
    
    // Search for window._sharedData
    try {
      const sharedData = await page.evaluate(() => {
        if (window._sharedData) {
          return window._sharedData;
        }
        return null;
      });
      
      if (sharedData) {
        const searchForShortcodes = (obj) => {
          if (typeof obj === 'object' && obj !== null) {
            if (obj.shortcode) {
              reelShortcodes.add(obj.shortcode);
            }
            if (obj.url && typeof obj.url === 'string') {
              const urlMatch = obj.url.match(/\/(?:[^\/]+\/)?reel\/([A-Za-z0-9-_]+)/);
              if (urlMatch) {
                reelShortcodes.add(urlMatch[1]);
              }
            }
            Object.values(obj).forEach(val => {
              if (typeof val === 'object') {
                searchForShortcodes(val);
              }
            });
          }
        };
        searchForShortcodes(sharedData);
      }
    } catch (e) {
      // Ignore errors
    }

    await browser.close();
    
    const shortcodesArray = Array.from(reelShortcodes);
    console.log(`✅ [Playwright] Found ${shortcodesArray.length} unique reel shortcodes`);

    return {
      shortcodes: shortcodesArray,
      count: shortcodesArray.length
    };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    console.error(`❌ [Playwright] Error scraping page:`, error.message);
    throw error;
  }
};


// Fetch individual reel/post data using GraphQL with rate limiting and retry logic
// Uses the EXACT format from user's reference code
const fetchReelData = async (shortcode, retryCount = 0) => {
  if (!shortcode) throw new Error("Shortcode is required.");

  try {
    // Use URL format EXACTLY as user specified in reference code (matching new/index.js)
    const graphql = new URL(`https://www.instagram.com/api/graphql`);
    graphql.searchParams.set("variables", JSON.stringify({ shortcode }));
    graphql.searchParams.set("doc_id", IG_GRAPHQL_DOC_ID);
    graphql.searchParams.set("lsd", IG_LSD);

    const headers = {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-IG-App-ID": X_IG_APP_ID,
      "X-FB-LSD": IG_LSD,
      "X-ASBD-ID": IG_ASBD_ID,
      "Sec-Fetch-Site": "same-origin"
    };

    // Use URL directly with searchParams (no body) - matching new/index.js exactly
    const response = await fetch(graphql, {
      method: "POST",
      headers
    });

    // Handle rate limiting (429 Too Many Requests)
    if (response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        const waitTime = RATE_LIMIT_RETRY_DELAY * (retryCount + 1); // Exponential backoff
        console.log(`   ⚠️  [GraphQL] Rate limited for ${shortcode}! Waiting ${waitTime / 1000}s before retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchReelData(shortcode, retryCount + 1);
      } else {
        throw new Error(`Rate limited (HTTP 429) - Max retries exceeded for ${shortcode}`);
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Instagram reel lookup failed with ${response.status}: ${text.substring(0, 200)}`);
    }

    const json = await response.json();
    const items = json?.data?.xdt_shortcode_media;
    
    if (!items) {
      // Log the response structure for debugging
      console.warn(`   ⚠️  [GraphQL] Response structure for ${shortcode}:`, JSON.stringify(json, null, 2).substring(0, 1000));
      throw new Error("Unable to locate reel data in response.");
    }

    // Format timestamp to readable date
    const timestamp = items.taken_at_timestamp;
    let postedDate = null;
    let postedDateFormatted = null;
    
    if (timestamp) {
      postedDate = new Date(timestamp * 1000); // Convert Unix timestamp to Date
      postedDateFormatted = postedDate.toISOString();
    }

    // Extract analytics data - use EXACT same format as new/index.js with optional chaining
    // Views and duration - use optional chaining exactly like reference code
    const videoViewCount = items?.video_view_count ?? null;
    const videoPlayCount = items?.video_play_count ?? null;
    const videoDuration = items?.video_duration ?? null;
    
    // Likes - check multiple paths with optional chaining (Instagram can have likes in different places)
    // For reels, likes might be in edge_media_preview_like or edge_liked_by
    let likeCount = null;
    
    // Check edge_media_preview_like first (most common for posts/reels)
    if (items?.edge_media_preview_like) {
      if (typeof items.edge_media_preview_like === 'object' && items.edge_media_preview_like.count !== undefined) {
        likeCount = items.edge_media_preview_like.count;
      } else if (typeof items.edge_media_preview_like === 'number') {
        likeCount = items.edge_media_preview_like;
      }
    }
    
    // Check edge_liked_by (alternative location)
    if (likeCount === null && items?.edge_liked_by) {
      if (typeof items.edge_liked_by === 'object' && items.edge_liked_by.count !== undefined) {
        likeCount = items.edge_liked_by.count;
      } else if (typeof items.edge_liked_by === 'number') {
        likeCount = items.edge_liked_by;
      }
    }
    
    // Check direct like_count field
    if (likeCount === null && items?.like_count !== undefined && items?.like_count !== null) {
      likeCount = items.like_count;
    }
    
    // Ensure likeCount is a valid number (not negative, unless Instagram actually returns negative)
    if (likeCount !== null && (typeof likeCount !== 'number' || likeCount < 0)) {
      // If it's negative or not a number, set to null (Instagram shouldn't return negative likes)
      if (likeCount < 0) {
        console.warn(`   ⚠️  [GraphQL] Invalid like count (negative) for ${shortcode}: ${likeCount}, setting to null`);
      }
      likeCount = null;
    }
    
    // Comments - check multiple paths (similar to likes)
    let commentCount = null;
    
    // Check edge_media_to_comment first (most common)
    if (items?.edge_media_to_comment) {
      if (typeof items.edge_media_to_comment === 'object' && items.edge_media_to_comment.count !== undefined) {
        commentCount = items.edge_media_to_comment.count;
      } else if (typeof items.edge_media_to_comment === 'number') {
        commentCount = items.edge_media_to_comment;
      }
    }
    
    // Check direct comment_count field
    if (commentCount === null && items?.comment_count !== undefined && items?.comment_count !== null) {
      commentCount = items.comment_count;
    }
    
    // Ensure commentCount is a valid number (not negative)
    if (commentCount !== null && (typeof commentCount !== 'number' || commentCount < 0)) {
      if (commentCount < 0) {
        console.warn(`   ⚠️  [GraphQL] Invalid comment count (negative) for ${shortcode}: ${commentCount}, setting to null`);
      }
      commentCount = null;
    }
    
    // Debug logging if likes/comments are missing - log the actual response structure
    if (likeCount === null) {
      const likeFields = Object.keys(items).filter(k => k.toLowerCase().includes('like'));
      console.warn(`   ⚠️  [GraphQL] Like count not found for ${shortcode}`);
      if (likeFields.length > 0) {
        console.warn(`   📋 Available like-related fields: ${likeFields.join(', ')}`);
        // Log the actual structure of like fields
        likeFields.forEach(field => {
          console.warn(`      ${field}:`, JSON.stringify(items[field]).substring(0, 200));
        });
      }
    } else {
      console.log(`   ✅ [GraphQL] Like count found for ${shortcode}: ${likeCount}`);
    }

    // Return data matching user's EXACT format from new/index.js + database fields
    return {
      __typename: items?.__typename,
      shortcode: items?.shortcode,
      dimensions: items?.dimensions,
      display_url: items?.display_url,
      display_resources: items?.display_resources,
      has_audio: items?.has_audio,
      video_url: items?.video_url,
      video_view_count: videoViewCount, // Use extracted value
      video_play_count: videoPlayCount, // Use extracted value
      is_video: items?.is_video,
      caption: items?.edge_media_to_caption?.edges?.[0]?.node?.text || null,
      is_paid_partnership: items?.is_paid_partnership,
      location: items?.location,
      owner: items?.owner,
      product_type: items?.product_type,
      video_duration: videoDuration, // Use extracted value
      thumbnail_src: items?.thumbnail_src,
      clips_music_attribution_info: items?.clips_music_attribution_info,
      sidecar: items?.edge_sidecar_to_children?.edges,
      // Additional fields for database (using extracted values)
      taken_at_timestamp: timestamp,
      posted_date: postedDateFormatted,
      posted_date_readable: postedDate ? postedDate.toLocaleString() : null,
      view_count: videoPlayCount ?? videoViewCount, // Use video_play_count (more accurate for reels)
      like_count: likeCount,
      comment_count: commentCount,
      average_watch_time: null // Not available in public API
    };
  } catch (error) {
    if (retryCount < MAX_RETRIES && error.message.includes('429')) {
      // Will be handled by retry logic above
      throw error;
    }
    throw error;
  }
};

module.exports = {
  fetchInstagramProfileData,
  fetchReelData,
  scrapeReelsPageWithPlaywright
};
