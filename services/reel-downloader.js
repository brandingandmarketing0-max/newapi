const { uploadBufferToR2, checkR2ObjectExists } = require('./r2-upload');
const { fetchReelData } = require('./instagram');

/**
 * Download Instagram reel video and upload to Cloudflare R2
 * @param {string} shortcode - Instagram reel shortcode
 * @param {string} username - Instagram username (for folder organization)
 * @param {string} trackingId - Tracking ID (for folder organization)
 * @returns {Promise<{url: string, key: string, bucket: string, cached: boolean}>}
 */
async function downloadAndUploadReel(shortcode, username, trackingId) {
  try {
    console.log(`\n📥 [Reel Downloader] Starting download for reel: ${shortcode}`);
    
    // Check if reel already exists in R2
    const r2Key = `reels/${username}/${trackingId}/${shortcode}.mp4`;
    const existingUrl = await checkR2ObjectExists(r2Key);
    
    if (existingUrl) {
      console.log(`✅ [Reel Downloader] Reel ${shortcode} already exists in R2: ${existingUrl}`);
      return {
        url: existingUrl,
        key: r2Key,
        bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'linkng-storage',
        cached: true
      };
    }

    // Fetch reel data to get video_url
    console.log(`🔍 [Reel Downloader] Fetching reel data for ${shortcode}...`);
    const reelData = await fetchReelData(shortcode);
    
    if (!reelData.video_url) {
      throw new Error(`No video_url found for reel ${shortcode}`);
    }

    console.log(`📥 [Reel Downloader] Downloading video from Instagram...`);
    console.log(`   Video URL: ${reelData.video_url.substring(0, 100)}...`);
    
    // Download video from Instagram
    const videoResponse = await fetch(reelData.video_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.instagram.com/',
      }
    });

    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`);
    }

    // Get video as buffer
    const arrayBuffer = await videoResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
    
    console.log(`✅ [Reel Downloader] Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📤 [Reel Downloader] Uploading to Cloudflare R2...`);

    // Upload to R2
    const uploadResult = await uploadBufferToR2(buffer, r2Key, contentType);
    
    console.log(`✅ [Reel Downloader] Successfully uploaded reel ${shortcode} to R2`);
    console.log(`   R2 URL: ${uploadResult.url}`);
    console.log(`   R2 Key: ${uploadResult.key}`);
    
    return {
      ...uploadResult,
      cached: false
    };
  } catch (error) {
    console.error(`❌ [Reel Downloader] Failed to download/upload reel ${shortcode}:`, error.message);
    throw error;
  }
}

/**
 * Download multiple reels in parallel (with concurrency limit)
 * @param {Array<{shortcode: string}>} reels - Array of reel objects with shortcode
 * @param {string} username - Instagram username
 * @param {string} trackingId - Tracking ID
 * @param {number} concurrency - Max concurrent downloads (default: 3)
 * @returns {Promise<Array<{shortcode: string, r2Url: string | null, error: string | null}>>}
 */
async function downloadMultipleReels(reels, username, trackingId, concurrency = 3) {
  const results = [];
  const queue = [...reels];
  const inProgress = new Set();
  
  console.log(`\n📥 [Reel Downloader] Starting batch download of ${reels.length} reels (concurrency: ${concurrency})`);
  
  async function processNext() {
    if (queue.length === 0) return;
    
    const reel = queue.shift();
    if (!reel || !reel.shortcode) return;
    
    inProgress.add(reel.shortcode);
    
    try {
      const result = await downloadAndUploadReel(reel.shortcode, username, trackingId);
      results.push({
        shortcode: reel.shortcode,
        r2Url: result.url,
        r2Key: result.key,
        cached: result.cached,
        error: null
      });
      console.log(`✅ [Reel Downloader] Completed ${reel.shortcode} (${results.length}/${reels.length})`);
    } catch (error) {
      results.push({
        shortcode: reel.shortcode,
        r2Url: null,
        r2Key: null,
        cached: false,
        error: error.message
      });
      console.error(`❌ [Reel Downloader] Failed ${reel.shortcode}: ${error.message}`);
    } finally {
      inProgress.delete(reel.shortcode);
      // Process next in queue
      await processNext();
    }
  }
  
  // Start concurrent downloads
  const promises = Array(Math.min(concurrency, reels.length))
    .fill(null)
    .map(() => processNext());
  
  await Promise.all(promises);
  
  const successCount = results.filter(r => r.r2Url).length;
  const cachedCount = results.filter(r => r.cached).length;
  const errorCount = results.filter(r => r.error).length;
  
  console.log(`\n📊 [Reel Downloader] Batch download complete:`);
  console.log(`   Total: ${results.length}`);
  console.log(`   Success: ${successCount} (${cachedCount} cached, ${successCount - cachedCount} new)`);
  console.log(`   Errors: ${errorCount}`);
  
  return results;
}

module.exports = {
  downloadAndUploadReel,
  downloadMultipleReels
};


