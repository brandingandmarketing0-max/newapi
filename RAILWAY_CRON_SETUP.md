# 🕐 Railway Cron Service Setup

## Overview

Railway supports **native cron jobs** that run independently of your main service. This is better than using `node-cron` in your main service because:

✅ **Service doesn't need to stay awake** - Cron runs independently  
✅ **More cost-effective** - Main service can sleep when not in use  
✅ **More reliable** - Railway manages the scheduling  
✅ **Better separation** - Cron tasks separate from API service  

## 🚀 Setup Instructions

### Option 1: Railway Cron Service (Recommended)

1. **In Railway Dashboard:**
   - Go to your project
   - Click **"+ New"** → **"Cron"**
   - Railway will create a new cron service

2. **Configure the Cron Service:**
   - **Root Directory**: `src-backup-railway`
   - **Command**: `node cron.js`
   - **Schedule**: `30 22 * * *` (daily at 4:30 AM IST / 22:30 UTC)
     - Note: IST is UTC+5:30, so 4:30 AM IST = 22:30 UTC (10:30 PM UTC previous day)
   - **Environment Variables**: Share variables from your main service

3. **Add Environment Variable:**
   - `CRON_TYPE=daily` (for daily tracking)
   - Or create a second cron service with `CRON_TYPE=refresh` and schedule `0 */12 * * *`

4. **Share Environment Variables:**
   - In Railway, go to your Cron service
   - Click **"Variables"** tab
   - Click **"Reference Variable"**
   - Select variables from your main service:
     - `SUPABASE_URL`
     - `SUPABASE_KEY`
     - `MIN_TIME_BETWEEN_JOBS_MS`
     - Any other needed variables

### Option 2: Multiple Cron Services

Create **two separate cron services** for different schedules:

#### Daily Cron Service:
- **Schedule**: `30 22 * * *` (4:30 AM IST / 22:30 UTC daily)
  - IST is UTC+5:30, so 4:30 AM IST = 22:30 UTC (10:30 PM UTC previous day)
- **Command**: `node cron.js`
- **Environment**: `CRON_TYPE=daily`

#### Refresh Cron Service:
- **Schedule**: `0 */12 * * *` (every 12 hours)
- **Command**: `node cron.js`
- **Environment**: `CRON_TYPE=refresh`

## 📋 Cron Schedule Examples

| Schedule | Description | Example |
|----------|-------------|---------|
| `30 22 * * *` | Daily at 4:30 AM IST | Every day at 4:30 AM IST (22:30 UTC) |
| `0 0 * * *` | Daily at midnight UTC | Every day at 00:00 UTC |
| `0 2 * * *` | Daily at 2 AM UTC | Every day at 02:00 UTC |
| `0 */6 * * *` | Every 6 hours | 00:00, 06:00, 12:00, 18:00 UTC |
| `0 */12 * * *` | Every 12 hours | 00:00, 12:00 UTC |
| `0 0 * * 0` | Weekly on Sunday | Every Sunday at midnight UTC |
| `0 0 1 * *` | Monthly on 1st | First day of month at midnight UTC |

## ⚙️ How It Works

1. **Railway triggers the cron** at the scheduled time
2. **cron.js runs** and adds all profiles to the queue
3. **cron.js exits** (Railway expects quick completion)
4. **Main API service** processes the queue with rate limiting
5. **Queue system** handles rate limits automatically

## 🔄 Queue Processing

**Important**: The cron job only **adds jobs to the queue**. The **main API service** must be running to process the queue.

- If main service is running: Jobs process immediately
- If main service is sleeping: Jobs wait in queue until service wakes up
- Queue persists in memory (main service must stay running for queue processing)

## 🚨 Important Notes

### Main Service Must Stay Running

The cron service only **adds jobs to the queue**. Your **main API service** must be running to:
- Process the queue
- Handle rate limiting
- Execute the actual Instagram API calls

**Solution**: Keep your main API service running 24/7, or use Railway's "Always On" feature.

### Environment Variables

Make sure to **share environment variables** from your main service to the cron service:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `MIN_TIME_BETWEEN_JOBS_MS` (optional)
- Any other variables your cron script needs

### Testing

Test the cron service locally:
```bash
cd src-backup-railway
CRON_TYPE=daily node cron.js
```

## 🔍 Monitoring

### Check Cron Logs

1. Go to Railway dashboard
2. Click on your Cron service
3. View **"Deployments"** → **"Logs"**
4. Look for `[RAILWAY CRON]` log messages

### Check Queue Status

After cron runs, check if jobs were added:
```bash
curl https://your-api.up.railway.app/queue/status
```

Look for:
- `queueSize`: Number of pending jobs
- `pendingJobs`: List of usernames in queue

## 🆚 Comparison: Railway Cron vs node-cron

| Feature | Railway Cron | node-cron (Current) |
|---------|--------------|---------------------|
| **Service must stay awake** | ❌ No | ✅ Yes |
| **Cost** | 💰 Lower (runs on demand) | 💰 Higher (always running) |
| **Reliability** | ✅ Railway manages it | ⚠️ Depends on service staying up |
| **Setup** | ⚙️ Separate service | ✅ Built into main service |
| **Flexibility** | ✅ Multiple schedules easy | ⚠️ All in one service |

## 🎯 Recommendation

**Use Railway Cron Service** for production:
- More cost-effective
- More reliable
- Better separation of concerns
- Main service can sleep when not in use

Keep `node-cron` as a fallback or for development/testing.

## 📚 Railway Cron Documentation

- [Railway Cron Jobs](https://docs.railway.com/reference/cron-jobs)
- [Cron Schedule Examples](https://crontab.guru/)


