const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { downloadAndUploadReel, downloadMultipleReels } = require('../services/reel-downloader');

// POST /reels/download/:shortcode - Download a single reel to R2
router.post('/download/:shortcode', async (req, res) => {
  const { shortcode } = req.params;
  const { username, tracking_id } = req.body;

  if (!username || !tracking_id) {
    return res.status(400).json({ 
      error: 'username and tracking_id are required in request body' 
    });
  }

  try {
    console.log(`\n📥 [API] Download reel request: ${shortcode} for user ${username}`);
    
    const result = await downloadAndUploadReel(shortcode, username, tracking_id);
    
    // Update database with R2 URL
    const { data: profile } = await supabase
      .from('ig_profiles')
      .select('id')
      .eq('username', username)
      .eq('tracking_id', tracking_id)
      .maybeSingle();

    if (profile) {
      const { error: updateError } = await supabase
        .from('ig_profile_reels')
        .update({ r2_video_url: result.url })
        .eq('profile_id', profile.id)
        .eq('shortcode', shortcode);

      if (updateError) {
        console.error(`❌ [API] Failed to update R2 URL in database:`, updateError.message);
      } else {
        console.log(`✅ [API] Updated database with R2 URL for ${shortcode}`);
      }
    }

    res.json({
      success: true,
      shortcode,
      r2Url: result.url,
      r2Key: result.key,
      cached: result.cached
    });
  } catch (error) {
    console.error(`❌ [API] Failed to download reel ${shortcode}:`, error.message);
    res.status(500).json({ 
      error: 'Failed to download reel', 
      details: error.message 
    });
  }
});

// POST /reels/download-batch - Download multiple reels to R2
router.post('/download-batch', async (req, res) => {
  const { reels, username, tracking_id, concurrency = 3 } = req.body;

  if (!reels || !Array.isArray(reels) || !username || !tracking_id) {
    return res.status(400).json({ 
      error: 'reels (array), username, and tracking_id are required in request body' 
    });
  }

  try {
    console.log(`\n📥 [API] Batch download request: ${reels.length} reels for user ${username}`);
    
    const results = await downloadMultipleReels(reels, username, tracking_id, concurrency);
    
    // Update database with R2 URLs
    const { data: profile } = await supabase
      .from('ig_profiles')
      .select('id')
      .eq('username', username)
      .eq('tracking_id', tracking_id)
      .maybeSingle();

    if (profile) {
      for (const result of results) {
        if (result.r2Url) {
          await supabase
            .from('ig_profile_reels')
            .update({ r2_video_url: result.r2Url })
            .eq('profile_id', profile.id)
            .eq('shortcode', result.shortcode);
        }
      }
      console.log(`✅ [API] Updated database with R2 URLs for ${results.filter(r => r.r2Url).length} reels`);
    }

    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        success: results.filter(r => r.r2Url).length,
        errors: results.filter(r => r.error).length,
        cached: results.filter(r => r.cached).length
      }
    });
  } catch (error) {
    console.error(`❌ [API] Failed to download reels:`, error.message);
    res.status(500).json({ 
      error: 'Failed to download reels', 
      details: error.message 
    });
  }
});

module.exports = router;

