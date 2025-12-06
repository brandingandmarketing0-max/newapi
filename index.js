require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const supabase = require("./services/supabase");
const { trackProfile } = require("./services/tracking");
const { addJob, processQueue, getQueueStatus } = require("./services/queue");
const profilesRouter = require("./routes/profiles");
const reelsRouter = require("./routes/reels");

// Import rate limit constant for logging
const MIN_TIME_BETWEEN_JOBS = 3 * 60 * 1000; // 3 minutes

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

// Cron job: Track all profiles every 24 hours (daily at midnight)
// Uses queue system to handle rate limiting
cron.schedule("0 0 * * *", async () => {
  console.log("\n⏰ [CRON] Daily tracking job started...");
  
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

// Also run every 6 hours to keep data fresh (optional - can be adjusted)
cron.schedule("0 */6 * * *", async () => {
  console.log("\n⏰ [CRON] 6-hour refresh job started...");
  
  try {
    const { data: profiles, error } = await supabase
      .from("ig_profiles")
      .select("username");
    
    if (error || !profiles || profiles.length === 0) {
      return;
    }
    
    console.log(`📊 [CRON] Adding ${profiles.length} profile(s) to queue for 6-hour refresh...`);
    
    for (const profile of profiles) {
      try {
        await addJob(profile.username, false);
      } catch (err) {
        console.error(`❌ [CRON] Failed to add ${profile.username} to queue:`, err.message);
      }
    }
    
    processQueue();
    console.log(`\n✅ [CRON] 6-hour refresh: All profiles added to queue.`);
  } catch (err) {
    console.error("❌ [CRON] Fatal error in 6-hour cron job:", err.message);
  }
});

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
    console.log(`   - Daily tracking: Runs at midnight (00:00)`);
    console.log(`   - 6-hour refresh: Runs every 6 hours`);
    console.log(`\n🔄 Queue system: Active with ${MIN_TIME_BETWEEN_JOBS / 1000 / 60} minute rate limiting`);
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
