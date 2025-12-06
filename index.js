// Load .env file only if it exists (for local development)
// On Railway, environment variables are set in the dashboard
const fs = require("fs");
if (fs.existsSync(".env")) {
  require("dotenv").config();
  console.log("✅ Loaded .env file for local development");
} else if (!process.env.RAILWAY_ENVIRONMENT) {
  console.log("ℹ️  No .env file found. Using environment variables from system.");
}

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const supabase = require("./services/supabase");
const { trackProfile } = require("./services/tracking");
const { addJob, processQueue, getQueueStatus } = require("./services/queue");
const profilesRouter = require("./routes/profiles");
const reelsRouter = require("./routes/reels");

// Import rate limit constant for logging
const MIN_TIME_BETWEEN_JOBS = parseInt(process.env.MIN_TIME_BETWEEN_JOBS_MS || "300000", 10); // 5 minutes default (configurable)

// Configurable cron schedules
// Daily cron: Runs at 12 AM (midnight) every night - "0 0 * * *"
// Refresh cron: Optional periodic refresh (default: every 12 hours)
const DAILY_CRON_SCHEDULE = process.env.DAILY_CRON_SCHEDULE || "0 0 * * *"; // 12 AM (midnight) daily
const REFRESH_CRON_SCHEDULE = process.env.REFRESH_CRON_SCHEDULE || "0 */12 * * *"; // Every 12 hours (optional - can disable by setting to empty)

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/profiles", profilesRouter);
app.use("/reels", reelsRouter);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Queue status endpoint
app.get("/queue/status", (req, res) => {
  const status = getQueueStatus();
  res.json(status);
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Instagram Profile Tracking API",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      profiles: "/profiles"
    }
  });
});

// Cron job: Track all profiles daily at 12 AM (midnight) every night
// Uses queue system to handle rate limiting
cron.schedule(DAILY_CRON_SCHEDULE, async () => {
  console.log("\n⏰ [CRON] Daily tracking job started at 12 AM (midnight)...");
  
  try {
    // Get all tracked profiles
    const { data: profiles, error } = await supabase
      .from("ig_profiles")
      .select("username");
    
    if (error) {
      console.error("❌ [CRON] Error fetching profiles:", error.message);
      return;
    }
    
    if (!profiles || profiles.length === 0) {
      console.log("ℹ️  [CRON] No profiles to track");
      return;
    }
    
    console.log(`📊 [CRON] Adding ${profiles.length} profile(s) to queue...`);
    
    // Add all profiles to queue (not immediate - will be processed in order with rate limiting)
    for (const profile of profiles) {
      try {
        await addJob(profile.username, false);
        console.log(`📋 [CRON] Added ${profile.username} to queue`);
      } catch (err) {
        console.error(`❌ [CRON] Failed to add ${profile.username} to queue:`, err.message);
      }
    }
    
    // Start processing the queue
    processQueue();
    
    console.log(`\n✅ [CRON] All profiles added to queue. Queue will process with rate limiting.`);
  } catch (err) {
    console.error("❌ [CRON] Fatal error in cron job:", err.message);
  }
});

// Optional periodic refresh job to keep data fresh (configurable schedule, default: every 12 hours)
// Can be disabled by setting REFRESH_CRON_SCHEDULE to empty string or a far future date
// More conservative than 6 hours to avoid rate limits
if (REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== "") {
  cron.schedule(REFRESH_CRON_SCHEDULE, async () => {
  const scheduleHours = REFRESH_CRON_SCHEDULE.includes("*/") 
    ? REFRESH_CRON_SCHEDULE.match(/\*\/(\d+)/)?.[1] || "12"
    : "12";
  console.log(`\n⏰ [CRON] ${scheduleHours}-hour refresh job started...`);
  
  try {
    const { data: profiles, error } = await supabase
      .from("ig_profiles")
      .select("username");
    
    if (error || !profiles || profiles.length === 0) {
      if (error) {
        console.error(`❌ [CRON] Error fetching profiles:`, error.message);
      } else {
        console.log(`ℹ️  [CRON] No profiles to refresh`);
      }
      return;
    }
    
    console.log(`📊 [CRON] Adding ${profiles.length} profile(s) to queue for ${scheduleHours}-hour refresh...`);
    
    for (const profile of profiles) {
      try {
        await addJob(profile.username, false);
      } catch (err) {
        console.error(`❌ [CRON] Failed to add ${profile.username} to queue:`, err.message);
      }
    }
    
    processQueue();
    console.log(`\n✅ [CRON] ${scheduleHours}-hour refresh: All profiles added to queue.`);
  } catch (err) {
    console.error(`❌ [CRON] Fatal error in ${scheduleHours}-hour cron job:`, err.message);
  }
  });
} else {
  console.log(`ℹ️  [CRON] Periodic refresh job disabled (REFRESH_CRON_SCHEDULE not set or empty)`);
}

// Handle command line arguments
const args = process.argv.slice(2);
const command = args[0];

if (command === "serve") {
  // Start the server
  const port = args[1] ? parseInt(args[1], 10) : PORT;
  
  // Railway requires listening on 0.0.0.0, not localhost
  const host = process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : 'localhost';
  
  app.listen(port, host, () => {
    console.log(`\n🚀 Server running on http://${host}:${port}`);
    console.log(`📡 Health check: http://${host}:${port}/health`);
    console.log(`📋 Queue status: http://${host}:${port}/queue/status`);
    console.log(`📋 API docs: http://${host}:${port}/`);
    console.log(`\n⏰ Cron jobs scheduled:`);
    console.log(`   - Daily tracking: ${DAILY_CRON_SCHEDULE} (12 AM / midnight every night)`);
    if (REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== "") {
      console.log(`   - Periodic refresh: ${REFRESH_CRON_SCHEDULE} (configurable via REFRESH_CRON_SCHEDULE env var)`);
    } else {
      console.log(`   - Periodic refresh: DISABLED (only daily at midnight will run)`);
    }
    console.log(`\n🔄 Queue system: Active with ${MIN_TIME_BETWEEN_JOBS / 1000 / 60} minute rate limiting`);
    console.log(`   - Rate limit configurable via MIN_TIME_BETWEEN_JOBS_MS env var (default: 300000ms = 5 minutes)`);
    console.log(`   - Exponential backoff enabled for rate limit errors`);
    console.log(`   - Jobs run immediately when created (respects rate limits)`);
    console.log(`   - Queue processes automatically in background`);
    console.log(`\n✅ Server ready!`);
    if (process.env.RAILWAY_ENVIRONMENT) {
      console.log(`🌐 Railway deployment detected - listening on 0.0.0.0:${port}\n`);
    } else {
      console.log(`💻 Local development - listening on localhost:${port}\n`);
    }
    
    // Start processing queue on server start (in case there are pending jobs)
    processQueue();
  });
} else {
  // Default: just scrape a profile if username provided
  const username = args[0];
  if (username) {
    console.log(`\n🔍 Scraping profile: ${username}\n`);
    trackProfile(username)
      .then(() => {
        console.log(`\n✅ Scraping completed for ${username}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(`\n❌ Scraping failed:`, err.message);
        process.exit(1);
      });
  } else {
    console.log("Usage:");
    console.log("  node src/index.js serve [port]  - Start the API server");
    console.log("  node src/index.js <username>    - Scrape a single profile");
    process.exit(1);
  }
}
