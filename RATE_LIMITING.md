# 🚦 Rate Limiting & Cron Jobs Guide

## 📋 Overview

This API includes **automatic cron jobs** that refresh Instagram profile data on a schedule, with built-in rate limiting to prevent getting blocked by Instagram.

## 🕐 Cron Job Options

**Two ways to run cron jobs on Railway:**

1. **node-cron (Built-in)**: Cron jobs run inside the main API service
   - ✅ Simple setup (already configured)
   - ⚠️ Requires service to stay running 24/7
   - ⚠️ Higher cost (service always awake)

2. **Railway Cron Service (Recommended)**: Separate cron service
   - ✅ More cost-effective (runs on demand)
   - ✅ Service can sleep when not in use
   - ✅ More reliable (Railway manages scheduling)
   - ⚙️ Requires separate service setup

**See `RAILWAY_CRON_SETUP.md` for Railway Cron service setup.**

## ⏰ Cron Jobs

### 1. Daily Tracking Job
- **Default Schedule**: `0 0 * * *` (Midnight daily)
- **Purpose**: Full refresh of all tracked profiles
- **Configurable**: Set `DAILY_CRON_SCHEDULE` environment variable

### 2. Periodic Refresh Job
- **Default Schedule**: `0 */12 * * *` (Every 12 hours)
- **Purpose**: Keep data fresh between daily refreshes
- **Configurable**: Set `REFRESH_CRON_SCHEDULE` environment variable
- **Note**: Changed from 6 hours to 12 hours for better rate limit safety

## 🚦 Rate Limiting System

### How It Works

1. **Queue System**: All jobs are queued and processed sequentially
2. **Minimum Delay**: Configurable delay between jobs (default: 5 minutes)
3. **Exponential Backoff**: Automatically increases delays after rate limit errors
4. **Error Handling**: Detects Instagram rate limit errors (429, 401) and handles them gracefully

### Rate Limit Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MIN_TIME_BETWEEN_JOBS_MS` | `300000` (5 min) | Minimum time between Instagram API calls |

**Recommended Settings:**
- **Conservative (Safe)**: `600000` (10 minutes) - Recommended for production
- **Moderate**: `300000` (5 minutes) - Default, good balance
- **Aggressive (Risky)**: `180000` (3 minutes) - May trigger rate limits

### Exponential Backoff

When rate limit errors are detected:
- **1st error**: Wait time doubles (e.g., 5 min → 10 min)
- **2nd error**: Wait time doubles again (10 min → 20 min)
- **Max backoff**: 30 minutes maximum
- **Auto-reset**: Backoff resets after 1 hour without errors

## 📊 Monitoring

### Queue Status Endpoint

Check queue status and rate limiting:

```bash
GET /queue/status
```

Response includes:
- Queue size and pending jobs
- Current processing job
- Rate limit configuration
- Rate limit error status
- Time until next job

### Example Response:
```json
{
  "queueSize": 5,
  "isProcessing": true,
  "processingJob": "username123",
  "lastJobTime": "2024-01-15T10:30:00.000Z",
  "timeSinceLastJob": 120000,
  "nextJobWaitTime": 180000,
  "rateLimitConfig": {
    "minTimeBetweenJobs": 300000,
    "minTimeBetweenJobsMinutes": 5
  },
  "rateLimitStatus": {
    "consecutiveErrors": 0,
    "lastErrorTime": null,
    "backoffActive": false
  },
  "pendingJobs": [...]
}
```

## 🚨 Rate Limit Error Handling

### Automatic Detection

The system automatically detects:
- HTTP 429 (Too Many Requests)
- HTTP 401 with rate limit messages
- Instagram error messages containing "rate limit" or "wait"

### What Happens on Rate Limit Error

1. **Error Detected**: System identifies rate limit error
2. **Job Re-queued**: Failed job is re-added to queue
3. **Backoff Applied**: Exponential backoff delay is applied
4. **Logging**: Error is logged with details
5. **Retry**: Job will retry after backoff period

### Manual Recovery

If you hit rate limits:
1. Check `/queue/status` to see current status
2. Wait for backoff period to expire
3. System will automatically resume processing
4. Consider increasing `MIN_TIME_BETWEEN_JOBS_MS` if errors persist

## ⚙️ Configuration Examples

### Conservative Setup (Recommended)
```env
MIN_TIME_BETWEEN_JOBS_MS=600000      # 10 minutes
DAILY_CRON_SCHEDULE=0 2 * * *        # 2 AM daily
REFRESH_CRON_SCHEDULE=0 */12 * * *   # Every 12 hours
```

### Moderate Setup (Default)
```env
MIN_TIME_BETWEEN_JOBS_MS=300000      # 5 minutes
DAILY_CRON_SCHEDULE=0 0 * * *        # Midnight daily
REFRESH_CRON_SCHEDULE=0 */12 * * *   # Every 12 hours
```

### Aggressive Setup (Use with Caution)
```env
MIN_TIME_BETWEEN_JOBS_MS=180000      # 3 minutes
DAILY_CRON_SCHEDULE=0 0 * * *        # Midnight daily
REFRESH_CRON_SCHEDULE=0 */6 * * *    # Every 6 hours
```

## 📝 Best Practices

1. **Start Conservative**: Begin with 10-minute delays, reduce if no errors
2. **Monitor Regularly**: Check `/queue/status` endpoint frequently
3. **Watch for Errors**: If you see rate limit errors, increase delays
4. **Respect Limits**: Instagram's limits are strict - better safe than blocked
5. **Use Backoff**: Let exponential backoff handle temporary issues

## 🔍 Troubleshooting

### Issue: Getting rate limited frequently
**Solution**: Increase `MIN_TIME_BETWEEN_JOBS_MS` to 600000 (10 minutes) or higher

### Issue: Jobs taking too long
**Solution**: This is normal - rate limiting ensures you don't get blocked. Be patient.

### Issue: Cron jobs not running
**Solution**: 
- Check Railway logs for cron job messages
- Verify environment variables are set correctly
- Check that server is running (not sleeping)

### Issue: Queue stuck
**Solution**: 
- Check `/queue/status` for details
- Look for rate limit errors in logs
- Wait for backoff period to expire
- Restart service if needed

## 📚 Additional Resources

- [Cron Schedule Generator](https://crontab.guru/)
- [Instagram Rate Limits](https://developers.facebook.com/docs/instagram-api/overview#rate-limiting)
- [Node Cron Documentation](https://www.npmjs.com/package/node-cron)

