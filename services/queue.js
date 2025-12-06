const supabase = require("./supabase");
const { trackProfile } = require("./tracking");

// Rate limiting: Minimum time between Instagram API calls (in milliseconds)
// Configurable via environment variable (default: 5 minutes for safety)
// Instagram's rate limits are strict - 5 minutes is safer than 3 minutes
const MIN_TIME_BETWEEN_JOBS = parseInt(process.env.MIN_TIME_BETWEEN_JOBS_MS || "300000", 10); // 5 minutes default
const MAX_CONCURRENT_JOBS = 1; // Only process one at a time to avoid rate limits

// Rate limit error tracking
let consecutiveRateLimitErrors = 0;
let lastRateLimitErrorTime = 0;
const RATE_LIMIT_BACKOFF_MULTIPLIER = 2; // Double wait time after rate limit errors
const MAX_BACKOFF_TIME = 30 * 60 * 1000; // Max 30 minutes backoff

// In-memory queue and state
let jobQueue = [];
let isProcessing = false;
let lastJobTime = 0;
let processingJob = null;

/**
 * Add a job to the queue
 * @param {string} username - Instagram username to track
 * @param {boolean} immediate - If true, try to run immediately (still respects rate limits)
 * @returns {Promise} Promise that resolves when job is queued
 */
const addJob = async (username, immediate = false, customTrackingId = null, userId = null) => {
  // Check if job already exists in queue
  const existingJob = jobQueue.find(job => job.username === username && !job.completed);
  if (existingJob) {
    console.log(`📋 [QUEUE] Job for ${username} already in queue, skipping duplicate`);
    return existingJob.promise;
  }

  // Create job promise
  let resolveJob, rejectJob;
  const jobPromise = new Promise((resolve, reject) => {
    resolveJob = resolve;
    rejectJob = reject;
  });

  const job = {
    id: `${username}-${Date.now()}`,
    username,
    customTrackingId, // Store custom tracking_id for user-specific tracking
    userId, // Store user_id to link profile to user
    addedAt: Date.now(),
    immediate,
    completed: false,
    promise: jobPromise,
    resolve: resolveJob,
    reject: rejectJob,
  };

  jobQueue.push(job);
  console.log(`📋 [QUEUE] Added job for ${username} to queue (immediate: ${immediate}, queue size: ${jobQueue.length})`);

  // Auto-start processing if:
  // 1. Job is marked as immediate, OR
  // 2. Queue was empty before this job (first job) and not currently processing
  const wasEmpty = jobQueue.length === 1; // This is the first job
  
  if (immediate || (wasEmpty && !isProcessing)) {
    console.log(`🔄 [QUEUE] Auto-starting queue processing (immediate: ${immediate}, wasEmpty: ${wasEmpty})`);
    // Use setImmediate to ensure it runs after the current execution
    setImmediate(() => {
      processQueue();
    });
  }

  return jobPromise;
};

/**
 * Process the queue with rate limiting
 */
const processQueue = async () => {
  console.log(`🔍 [QUEUE] processQueue() called - isProcessing: ${isProcessing}, queue size: ${jobQueue.length}, lastJobTime: ${lastJobTime}`);
  
  if (isProcessing) {
    console.log(`⏸️  [QUEUE] Already processing, skipping`);
    return;
  }

  if (jobQueue.length === 0) {
    console.log(`✅ [QUEUE] Queue is empty`);
    return;
  }

  // Sort queue: immediate jobs first, then by addedAt
  jobQueue.sort((a, b) => {
    if (a.immediate && !b.immediate) return -1;
    if (!a.immediate && b.immediate) return 1;
    return a.addedAt - b.addedAt;
  });

  // Get next job
  const nextJob = jobQueue.find(job => !job.completed);
  if (!nextJob) {
    console.log(`✅ [QUEUE] No pending jobs (all completed)`);
    return;
  }
  
  console.log(`📋 [QUEUE] Found next job: ${nextJob.username}, completed: ${nextJob.completed}, immediate: ${nextJob.immediate}`);

  // Check rate limiting with exponential backoff if we've hit rate limits recently
  const timeSinceLastJob = lastJobTime > 0 ? Date.now() - lastJobTime : Infinity; // If never ran, allow immediate start
  let baseWaitTime = MIN_TIME_BETWEEN_JOBS;
  
  // Apply exponential backoff if we've had recent rate limit errors
  if (consecutiveRateLimitErrors > 0) {
    const timeSinceLastError = Date.now() - lastRateLimitErrorTime;
    const backoffTime = Math.min(
      MIN_TIME_BETWEEN_JOBS * Math.pow(RATE_LIMIT_BACKOFF_MULTIPLIER, consecutiveRateLimitErrors),
      MAX_BACKOFF_TIME
    );
    
    // Use the larger of base wait time or backoff time
    baseWaitTime = Math.max(baseWaitTime, backoffTime);
    
    if (timeSinceLastError < 60 * 60 * 1000) { // Within last hour
      console.log(`⚠️  [QUEUE] Rate limit backoff active: ${consecutiveRateLimitErrors} consecutive errors, using ${Math.round(baseWaitTime / 1000 / 60)} minute delay`);
    } else {
      // Reset if it's been more than an hour since last error
      consecutiveRateLimitErrors = 0;
    }
  }
  
  const waitTime = Math.max(0, baseWaitTime - timeSinceLastJob);
  
  console.log(`⏱️  [QUEUE] Rate limit check: baseWaitTime=${baseWaitTime}ms, timeSinceLastJob=${timeSinceLastJob}ms, waitTime=${waitTime}ms, lastJobTime=${lastJobTime}`);

  if (waitTime > 0 && lastJobTime > 0) {
    console.log(`⏳ [QUEUE] Rate limit: Waiting ${Math.round(waitTime / 1000)}s before processing ${nextJob.username} (last job was ${Math.round(timeSinceLastJob / 1000)}s ago)`);
    
    // Schedule job for later
    setTimeout(() => {
      console.log(`⏰ [QUEUE] Scheduled timeout completed, calling processQueue() again`);
      processQueue();
    }, waitTime);
    return;
  } else {
    if (lastJobTime === 0) {
      console.log(`🚀 [QUEUE] First job in queue - starting immediately (no rate limit delay needed)`);
    } else {
      console.log(`🚀 [QUEUE] Rate limit satisfied - starting job immediately (waited enough time)`);
    }
  }

  // Process the job
  console.log(`▶️  [QUEUE] About to process job for ${nextJob.username}...`);
  isProcessing = true;
  processingJob = nextJob;
  nextJob.completed = true;

  console.log(`🚀 [QUEUE] Processing job for ${nextJob.username} (queue size: ${jobQueue.filter(j => !j.completed).length} remaining)`);

  try {
    const startTime = Date.now();
    lastJobTime = startTime;

    // Track the profile (pass custom tracking_id and user_id if provided)
    const result = await trackProfile(nextJob.username, nextJob.customTrackingId, nextJob.userId);
    
    const duration = Date.now() - startTime;
    console.log(`✅ [QUEUE] Job completed for ${nextJob.username} in ${Math.round(duration / 1000)}s`);
    
    // Reset rate limit error counter on success
    if (consecutiveRateLimitErrors > 0) {
      console.log(`✅ [QUEUE] Rate limit errors reset - job succeeded`);
      consecutiveRateLimitErrors = 0;
    }
    
    // Resolve the promise
    nextJob.resolve(result);
  } catch (error) {
    // Check if this is a rate limit error
    const isRateLimitError = 
      error.message?.toLowerCase().includes('rate limit') ||
      error.message?.toLowerCase().includes('429') ||
      error.message?.toLowerCase().includes('too many requests') ||
      error.message?.toLowerCase().includes('wait a few minutes');
    
    if (isRateLimitError) {
      consecutiveRateLimitErrors++;
      lastRateLimitErrorTime = Date.now();
      const backoffTime = Math.min(
        MIN_TIME_BETWEEN_JOBS * Math.pow(RATE_LIMIT_BACKOFF_MULTIPLIER, consecutiveRateLimitErrors),
        MAX_BACKOFF_TIME
      );
      
      console.error(`🚫 [QUEUE] Rate limit error for ${nextJob.username} (error #${consecutiveRateLimitErrors}):`, error.message);
      console.error(`⏸️  [QUEUE] Applying ${Math.round(backoffTime / 1000 / 60)} minute backoff before next job`);
      
      // Re-queue the job with a delay
      nextJob.completed = false;
      setTimeout(() => {
        processQueue();
      }, backoffTime);
      
      // Don't reject immediately - let it retry
      return;
    } else {
      // Non-rate-limit error - reset counter
      if (consecutiveRateLimitErrors > 0) {
        consecutiveRateLimitErrors = 0;
      }
    }
    
    console.error(`❌ [QUEUE] Job failed for ${nextJob.username}:`, error.message);
    nextJob.reject(error);
  } finally {
    isProcessing = false;
    processingJob = null;

    // Remove completed job from queue
    jobQueue = jobQueue.filter(job => job.id !== nextJob.id);

    // Process next job if any
    if (jobQueue.length > 0) {
      // Wait a bit before processing next job (rate limiting)
      setTimeout(() => {
        processQueue();
      }, MIN_TIME_BETWEEN_JOBS);
    }
  }
};

/**
 * Get queue status
 */
const getQueueStatus = () => {
  const timeSinceLastJob = lastJobTime ? Date.now() - lastJobTime : null;
  const nextJobWaitTime = timeSinceLastJob ? Math.max(0, MIN_TIME_BETWEEN_JOBS - timeSinceLastJob) : 0;
  
  return {
    queueSize: jobQueue.filter(job => !job.completed).length,
    isProcessing,
    processingJob: processingJob ? processingJob.username : null,
    lastJobTime: lastJobTime ? new Date(lastJobTime).toISOString() : null,
    timeSinceLastJob: timeSinceLastJob,
    nextJobWaitTime: nextJobWaitTime,
    rateLimitConfig: {
      minTimeBetweenJobs: MIN_TIME_BETWEEN_JOBS,
      minTimeBetweenJobsMinutes: Math.round(MIN_TIME_BETWEEN_JOBS / 1000 / 60),
    },
    rateLimitStatus: {
      consecutiveErrors: consecutiveRateLimitErrors,
      lastErrorTime: lastRateLimitErrorTime ? new Date(lastRateLimitErrorTime).toISOString() : null,
      backoffActive: consecutiveRateLimitErrors > 0,
    },
    pendingJobs: jobQueue.filter(job => !job.completed).map(job => ({
      username: job.username,
      addedAt: new Date(job.addedAt).toISOString(),
      immediate: job.immediate,
    })),
  };
};

/**
 * Clear the queue (useful for testing or reset)
 */
const clearQueue = () => {
  jobQueue = [];
  isProcessing = false;
  processingJob = null;
  console.log(`🗑️  [QUEUE] Queue cleared`);
};

module.exports = {
  addJob,
  processQueue,
  getQueueStatus,
  clearQueue,
};

