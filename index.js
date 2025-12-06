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
// Daily cron: Runs at 2:15 AM IST every night - "15 2 * * *" (when TZ=Asia/Kolkata)
// Refresh cron: Optional periodic refresh (default: every 12 hours)
const DAILY_CRON_SCHEDULE = process.env.DAILY_CRON_SCHEDULE || "15 2 * * *"; // 2:15 AM IST daily
const REFRESH_CRON_SCHEDULE = process.env.REFRESH_CRON_SCHEDULE || "0 */12 * * *"; // Every 12 hours (optional - can disable by setting to empty)

// Timezone: Set to IST (Indian Standard Time) by default
// IST = UTC+5:30 (Asia/Kolkata)
const TIMEZONE = process.env.TZ || "Asia/Kolkata";

/**
 * Calculate next execution time for a cron schedule
 * Simple parser for common cron patterns
 */
function getNextCronExecution(cronSchedule) {
  if (!cronSchedule || cronSchedule.trim() === "") return null;
  
  const now = new Date();
  const parts = cronSchedule.trim().split(/\s+/);
  
  if (parts.length !== 5) return null;
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  // For "0 0 * * *" (daily at midnight), "0 1 * * *" (daily at 1 AM), or "XX Y * * *" (daily at specific time)
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && !hour.includes("/") && !hour.includes("-") && !hour.includes(",")) {
    const cronMinute = parseInt(minute, 10);
    const cronHour = parseInt(hour, 10);
    
    // Get current time in IST
    const nowIST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const nowUTC = new Date(now);
    
    // Create target time in IST (HH:MM AM)
    const targetIST = new Date(nowIST);
    targetIST.setHours(cronHour, cronMinute, 0, 0);
    
    // If target time has passed today, set for tomorrow
    if (targetIST <= nowIST) {
      targetIST.setDate(targetIST.getDate() + 1);
    }
    
    // Convert IST time to UTC
    // IST is UTC+5:30, so subtract 5:30 to get UTC
    const istHours = targetIST.getHours();
    const istMinutes = targetIST.getMinutes();
    
    // Calculate UTC time: IST - 5:30
    let utcHours = istHours - 5;
    let utcMinutes = istMinutes - 30;
    
    if (utcMinutes < 0) {
      utcMinutes += 60;
      utcHours -= 1;
    }
    if (utcHours < 0) {
      utcHours += 24;
    }
    
    const nextUTC = new Date(nowUTC);
    nextUTC.setUTCHours(utcHours, utcMinutes, 0, 0);
    
    // If the UTC time is in the past, it means we need the next day
    if (nextUTC <= nowUTC) {
      nextUTC.setUTCDate(nextUTC.getUTCDate() + 1);
    }
    
    return nextUTC;
  }
  
  // For "0 */12 * * *" (every 12 hours)
  if (minute === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const interval = parseInt(hour.substring(2), 10);
    const next = new Date(now);
    const currentHour = next.getUTCHours();
    const nextHour = Math.ceil((currentHour + 1) / interval) * interval;
    
    if (nextHour >= 24) {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0, 0, 0, 0);
    } else {
      next.setUTCHours(nextHour, 0, 0, 0);
    }
    return next;
  }
  
  // Default: return next day at same time (fallback)
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Format date with timezone info
 */
function formatDateWithTimezone(date, timezone = TIMEZONE) {
  if (!date) return null;
  
  const utcDate = new Date(date);
  
  return {
    utc: utcDate.toISOString(),
    local: utcDate.toLocaleString("en-US", { 
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long"
    }),
    timestamp: utcDate.getTime(),
    timezone: timezone,
    relative: getRelativeTime(utcDate)
  };
}

/**
 * Get relative time string (e.g., "in 5 hours")
 */
function getRelativeTime(date) {
  const now = new Date();
  const diff = date - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `in ${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    return "now";
  }
}

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

// Manual queue trigger endpoint (for debugging/stuck queues)
app.post("/queue/process", (req, res) => {
  console.log(`🔄 [API] Manual queue process triggered`);
  processQueue();
  const status = getQueueStatus();
  res.json({
    message: "Queue processing triggered",
    status: status
  });
});

// Manual cron job trigger endpoint (for testing)
app.post("/cron/trigger", async (req, res) => {
  console.log(`\n🔧 [API] Manual cron job trigger requested`);
  
  try {
    // Get all tracked profiles
    const { data: profiles, error } = await supabase
      .from("ig_profiles")
      .select("username");
    
    if (error) {
      console.error("❌ [API] Error fetching profiles:", error.message);
      return res.status(500).json({ error: error.message });
    }
    
    if (!profiles || profiles.length === 0) {
      console.log("ℹ️  [API] No profiles to track");
      return res.json({ message: "No profiles to track", profiles: 0 });
    }
    
    console.log(`📊 [API] Adding ${profiles.length} profile(s) to queue...`);
    
    // Add all profiles to queue
    let addedCount = 0;
    for (const profile of profiles) {
      try {
        await addJob(profile.username, false);
        addedCount++;
        console.log(`📋 [API] Added ${profile.username} to queue`);
      } catch (err) {
        console.error(`❌ [API] Failed to add ${profile.username} to queue:`, err.message);
      }
    }
    
    // Start processing the queue
    console.log(`🔄 [API] Calling processQueue() to start processing...`);
    processQueue();
    
    res.json({
      message: "Cron job triggered manually",
      profilesAdded: addedCount,
      totalProfiles: profiles.length,
      queueStatus: getQueueStatus()
    });
  } catch (err) {
    console.error("❌ [API] Error in manual cron trigger:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cron schedule info endpoint - shows next refresh times
app.get("/cron/schedule", (req, res) => {
  const now = new Date();
  const nextDaily = getNextCronExecution(DAILY_CRON_SCHEDULE);
  const nextRefresh = REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== "" 
    ? getNextCronExecution(REFRESH_CRON_SCHEDULE) 
    : null;
  
  res.json({
    timezone: TIMEZONE,
    timezoneInfo: "IST (Indian Standard Time) = UTC+5:30",
    currentTime: formatDateWithTimezone(now),
    currentTimeIST: now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "long" }),
    schedules: {
      daily: {
        cron: DAILY_CRON_SCHEDULE,
        description: "Daily refresh at 1:55 AM IST",
        nextExecution: formatDateWithTimezone(nextDaily),
        nextExecutionIST: nextDaily ? new Date(nextDaily).toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "long" }) : null,
        enabled: true
      },
      refresh: {
        cron: REFRESH_CRON_SCHEDULE || "disabled",
        description: "Periodic refresh",
        nextExecution: nextRefresh ? formatDateWithTimezone(nextRefresh) : null,
        enabled: REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== ""
      }
    },
    note: "Timezone is set to IST (Asia/Kolkata = UTC+5:30). Cron runs at 1:55 AM IST daily."
  });
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

// Cron job: Track all profiles daily at 1:55 AM IST every night
// Uses queue system to handle rate limiting
// NOTE: Timezone is set to IST (Asia/Kolkata) = UTC+5:30
const dailyCronTask = cron.schedule(DAILY_CRON_SCHEDULE, async () => {
  const now = new Date();
  console.log(`\n⏰ [CRON] Daily tracking job started at 1:55 AM IST...`);
  console.log(`📅 [CRON] Current time: ${now.toISOString()} (UTC)`);
  console.log(`📅 [CRON] Current time IST: ${now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })}`);
  console.log(`🌍 [CRON] Timezone: ${TIMEZONE} (IST = UTC+5:30)`);
  
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
    let addedCount = 0;
    let failedCount = 0;
    
    console.log(`📋 [CRON] Starting to add ${profiles.length} profiles to queue...`);
    
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      try {
        console.log(`📋 [CRON] Attempting to add profile ${i + 1}/${profiles.length}: ${profile.username}`);
        await addJob(profile.username, false);
        addedCount++;
        console.log(`✅ [CRON] Successfully added ${profile.username} to queue (${addedCount}/${profiles.length})`);
      } catch (err) {
        failedCount++;
        console.error(`❌ [CRON] Failed to add ${profile.username} to queue:`, err.message);
        console.error(err.stack);
      }
    }
    
    console.log(`📊 [CRON] Summary: ${addedCount} added, ${failedCount} failed out of ${profiles.length} total`);
    
    // Get current queue status BEFORE processing
    const queueStatusBefore = getQueueStatus();
    console.log(`📊 [CRON] Queue status BEFORE processing: ${queueStatusBefore.queueSize} jobs pending, isProcessing: ${queueStatusBefore.isProcessing}`);
    console.log(`📊 [CRON] Pending jobs: ${queueStatusBefore.pendingJobs.map(j => j.username).join(', ')}`);
    
    // CRITICAL: Start processing the queue immediately
    console.log(`🔄 [CRON] Ensuring queue processing starts...`);
    
    // Force processQueue to run - use multiple methods to ensure it works
    const startProcessing = () => {
      const status = getQueueStatus();
      if (status.queueSize > 0 && !status.isProcessing) {
        console.log(`🚀 [CRON] Starting queue processing (${status.queueSize} jobs pending)...`);
        processQueue().catch(err => {
          console.error(`❌ [CRON] processQueue() error:`, err.message);
        });
      } else if (status.isProcessing) {
        console.log(`✅ [CRON] Queue is already processing`);
      } else {
        console.log(`⚠️  [CRON] Queue is empty - no jobs to process`);
      }
    };
    
    // Call immediately
    startProcessing();
    
    // Also call in next tick (setImmediate)
    setImmediate(startProcessing);
    
    // Backup call after 500ms
    setTimeout(startProcessing, 500);
    
    // Final backup after 2 seconds
    setTimeout(() => {
      const status = getQueueStatus();
      if (status.queueSize > 0 && !status.isProcessing) {
        console.log(`⚠️  [CRON] Queue still stuck after 2s - FORCING processQueue()...`);
        processQueue().catch(err => {
          console.error(`❌ [CRON] Forced processQueue() error:`, err.message);
        });
      }
    }, 2000);
    
    console.log(`\n✅ [CRON] All profiles added to queue. Queue will process with rate limiting.`);
    
    // Log next execution time
    const nextExecution = getNextCronExecution(DAILY_CRON_SCHEDULE);
    if (nextExecution) {
      const nextTime = formatDateWithTimezone(nextExecution);
      console.log(`📅 [CRON] Next daily refresh: ${nextTime.utc} (${nextTime.relative})`);
    }
  } catch (err) {
    console.error("❌ [CRON] Fatal error in cron job:", err.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

// Optional periodic refresh job to keep data fresh (configurable schedule, default: every 12 hours)
// Can be disabled by setting REFRESH_CRON_SCHEDULE to empty string or a far future date
// More conservative than 6 hours to avoid rate limits
if (REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== "") {
  const refreshCronTask = cron.schedule(REFRESH_CRON_SCHEDULE, async () => {
  const scheduleHours = REFRESH_CRON_SCHEDULE.includes("*/") 
    ? REFRESH_CRON_SCHEDULE.match(/\*\/(\d+)/)?.[1] || "12"
    : "12";
  const now = new Date();
  console.log(`\n⏰ [CRON] ${scheduleHours}-hour refresh job started...`);
  console.log(`📅 [CRON] Current time: ${now.toISOString()} (UTC)`);
  console.log(`🌍 [CRON] Timezone: ${TIMEZONE}`);
  
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
    
    // Log next execution time
    const nextExecution = getNextCronExecution(REFRESH_CRON_SCHEDULE);
    if (nextExecution) {
      const nextTime = formatDateWithTimezone(nextExecution);
      console.log(`📅 [CRON] Next ${scheduleHours}-hour refresh: ${nextTime.utc} (${nextTime.relative})`);
    }
  } catch (err) {
    console.error(`❌ [CRON] Fatal error in ${scheduleHours}-hour cron job:`, err.message);
  }
  }, {
    scheduled: true,
    timezone: TIMEZONE
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
    console.log(`   - Daily tracking: ${DAILY_CRON_SCHEDULE} (1:55 AM IST every night)`);
    if (REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== "") {
      console.log(`   - Periodic refresh: ${REFRESH_CRON_SCHEDULE} (configurable via REFRESH_CRON_SCHEDULE env var)`);
    } else {
      console.log(`   - Periodic refresh: DISABLED (only daily at 1:55 AM IST will run)`);
    }
    
    // Show next execution times
    console.log(`\n📅 Next execution times (${TIMEZONE} timezone - IST = UTC+5:30):`);
    const nextDaily = getNextCronExecution(DAILY_CRON_SCHEDULE);
    if (nextDaily) {
      const dailyTime = formatDateWithTimezone(nextDaily);
      const istTime = new Date(nextDaily).toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      console.log(`   - Daily refresh: ${istTime} IST (${dailyTime.utc} UTC) - ${dailyTime.relative}`);
    }
    if (REFRESH_CRON_SCHEDULE && REFRESH_CRON_SCHEDULE.trim() !== "") {
      const nextRefresh = getNextCronExecution(REFRESH_CRON_SCHEDULE);
      if (nextRefresh) {
        const refreshTime = formatDateWithTimezone(nextRefresh);
        const istTime = new Date(nextRefresh).toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        console.log(`   - Periodic refresh: ${istTime} IST (${refreshTime.utc} UTC) - ${refreshTime.relative}`);
      }
    }
    console.log(`\n💡 Check /cron/schedule endpoint for detailed schedule info`);
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
    // Use setTimeout to ensure server is fully started before processing
    setTimeout(() => {
      console.log(`🔄 [QUEUE] Starting queue processor on server startup...`);
      processQueue();
    }, 1000);
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
    console.log("  node index.js serve [port]  - Start the API server");
    console.log("  node index.js <username>    - Scrape a single profile");
    console.log("  npm start                   - Start the API server (recommended)");
    process.exit(1);
  }
}
