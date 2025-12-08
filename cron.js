#!/usr/bin/env node

/**
 * Railway Cron Service - Instagram Profile Refresh
 * 
 * This script is designed to run as a Railway Cron service.
 * Railway Cron services should:
 * - Complete their task and exit
 * - Not run a long-lived server
 * - Use crontab expressions for scheduling
 * 
 * Usage in Railway:
 * 1. Add a new "Cron" service in Railway
 * 2. Set the schedule (e.g., "0 0 * * *" for daily at midnight)
 * 3. Set the command: "node cron.js"
 * 4. Share environment variables with main service
 */

// Load .env file only if it exists (for local development)
const fs = require("fs");
if (fs.existsSync(".env")) {
  require("dotenv").config();
  console.log("✅ Loaded .env file for local development");
}

const supabase = require("./services/supabase");
const { addJob, processQueue } = require("./services/queue");

// Get cron schedule type from environment (daily or refresh)
const CRON_TYPE = process.env.CRON_TYPE || "daily"; // "daily" or "refresh"

async function runCronJob() {
  console.log(`\n⏰ [RAILWAY CRON] ${CRON_TYPE === "daily" ? "Daily" : "Periodic"} tracking job started...`);
  console.log(`📅 [RAILWAY CRON] Time: ${new Date().toISOString()}`);
  
  try {
    // Get all tracked profiles
    const { data: profiles, error } = await supabase
      .from("ig_profiles")
      .select("username");
    
    if (error) {
      console.error("❌ [RAILWAY CRON] Error fetching profiles:", error.message);
      process.exit(1);
    }
    
    if (!profiles || profiles.length === 0) {
      console.log("ℹ️  [RAILWAY CRON] No profiles to track");
      process.exit(0);
    }
    
    console.log(`📊 [RAILWAY CRON] Found ${profiles.length} profile(s) to track`);
    
    // Add all profiles to queue
    let addedCount = 0;
    for (const profile of profiles) {
      try {
        await addJob(profile.username, false);
        addedCount++;
        console.log(`📋 [RAILWAY CRON] Added ${profile.username} to queue (${addedCount}/${profiles.length})`);
      } catch (err) {
        console.error(`❌ [RAILWAY CRON] Failed to add ${profile.username} to queue:`, err.message);
      }
    }
    
    console.log(`\n✅ [RAILWAY CRON] Added ${addedCount}/${profiles.length} profiles to queue`);
    console.log(`🔄 [RAILWAY CRON] Queue will process jobs with rate limiting`);
    console.log(`\n✅ [RAILWAY CRON] Cron job completed successfully`);
    
    // Note: We don't call processQueue() here because:
    // 1. The main API service should be running and processing the queue
    // 2. If the main service is down, jobs will be processed when it comes back up
    // 3. Railway Cron services should exit quickly
    
    process.exit(0);
  } catch (err) {
    console.error("❌ [RAILWAY CRON] Fatal error in cron job:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run the cron job
runCronJob();


