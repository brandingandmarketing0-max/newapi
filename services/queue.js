const supabase = require("./supabase");
const { trackProfile } = require("./tracking");

// Rate limiting: Minimum time between Instagram API calls (in milliseconds)
const MIN_TIME_BETWEEN_JOBS = 3 * 60 * 1000; // 3 minutes
const MAX_CONCURRENT_JOBS = 1; // Only process one at a time to avoid rate limits

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

  // If immediate and not processing, try to process immediately
  if (immediate && !isProcessing) {
    processQueue();
  }

  return jobPromise;
};

/**
 * Process the queue with rate limiting
 */
const processQueue = async () => {
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
    console.log(`✅ [QUEUE] No pending jobs`);
    return;
  }

  // Check rate limiting
  const timeSinceLastJob = Date.now() - lastJobTime;
  const waitTime = Math.max(0, MIN_TIME_BETWEEN_JOBS - timeSinceLastJob);

  if (waitTime > 0) {
    console.log(`⏳ [QUEUE] Rate limit: Waiting ${Math.round(waitTime / 1000)}s before processing ${nextJob.username} (last job was ${Math.round(timeSinceLastJob / 1000)}s ago)`);
    
    // Schedule job for later
    setTimeout(() => {
      processQueue();
    }, waitTime);
    return;
  }

  // Process the job
  isProcessing = true;
  processingJob = nextJob;
  nextJob.completed = true;

  console.log(`🚀 [QUEUE] Processing job for ${nextJob.username} (queue size: ${jobQueue.length - 1} remaining)`);

  try {
    const startTime = Date.now();
    lastJobTime = startTime;

    // Track the profile (pass custom tracking_id and user_id if provided)
    const result = await trackProfile(nextJob.username, nextJob.customTrackingId, nextJob.userId);
    
    const duration = Date.now() - startTime;
    console.log(`✅ [QUEUE] Job completed for ${nextJob.username} in ${Math.round(duration / 1000)}s`);
    
    // Resolve the promise
    nextJob.resolve(result);
  } catch (error) {
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
  return {
    queueSize: jobQueue.filter(job => !job.completed).length,
    isProcessing,
    processingJob: processingJob ? processingJob.username : null,
    lastJobTime: lastJobTime ? new Date(lastJobTime).toISOString() : null,
    timeSinceLastJob: lastJobTime ? Date.now() - lastJobTime : null,
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

