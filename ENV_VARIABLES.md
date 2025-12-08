# 🔑 Environment Variables Setup

## 📍 Where to Put Environment Variables

### 🚂 On Railway (Production)

**DO NOT create a `.env` file!** Railway doesn't use `.env` files.

Instead, set environment variables in the Railway dashboard:

1. Go to your Railway project
2. Click on your service
3. Go to **Variables** tab
4. Click **+ New Variable**
5. Add each variable:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_key
PORT=3001
NODE_ENV=production
RAILWAY_API_URL=https://newapi-production-a8b3.up.railway.app
```

**Important**: 
- Railway automatically sets `PORT` - you don't need to set it manually
- Use your **Supabase Service Role Key** (not anon key) for full database access
- Variables are encrypted and secure on Railway

### 💻 Local Development

For local development, create a `.env` file in the `src-backup-railway/` folder:

```bash
cd src-backup-railway
```

Create `.env` file (or copy from `.env.example`):
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_key
PORT=3001
NODE_ENV=development
RAILWAY_API_URL=https://newapi-production-a8b3.up.railway.app
```

**Important**: 
- Add `.env` to `.gitignore` (already done) - **NEVER commit .env to git!**
- Use your Supabase Service Role Key for local testing

## 📋 Required Variables

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard → Settings → API |
| `SUPABASE_KEY` | Service role key (full access) | Supabase Dashboard → Settings → API → service_role key |
| `PORT` | Server port | Railway sets automatically (optional to override) |
| `NODE_ENV` | Environment | `production` for Railway, `development` for local |
| `RAILWAY_API_URL` | Your Railway API URL | Railway Dashboard → Settings → Domains (default: `https://newapi-production-a8b3.up.railway.app`) |

## 🔐 Optional Variables

### Instagram Cookies (for Playwright scraping)

**⚠️ REQUIRED for scraping reels pages.** Get cookies from Chrome DevTools:

```
INSTAGRAM_COOKIES="mid=xxx; sessionid=xxx; ig_did=xxx; csrftoken=xxx; datr=xxx; ig_nrcb=xxx"
```

**⚠️ IMPORTANT: You MUST include the `sessionid` cookie for authentication!** Without it, Instagram will redirect to the login page.

**How to get cookies:**
1. Open Chrome and **log into Instagram** (instagram.com)
2. Press **F12** to open DevTools
3. Go to **Application** tab → **Storage** → **Cookies** → `https://www.instagram.com`
4. Copy the values for (right-click → Copy):
   - **`sessionid`** (REQUIRED - most important!)
   - `mid`
   - `csrftoken`
   - `datr`
   - `ig_did`
   - `ig_nrcb`
5. Format: `name1=value1; name2=value2; name3=value3`

**Example:**
```
INSTAGRAM_COOKIES="mid=aTWpkwALAAGNrS5VWDp3XLkvTyKs; sessionid=78008627449:qvWgKbVeJDfB30:26:AYjz9UKXsrWakkpQ2xkBjlX9fmtL6y9PIKl8rFphxW8; ig_did=2612B2C8-FA74-4AE2-BB32-88737E2AEC82; csrftoken=a80jwHWaDK-5n8J9RACM9L; datr=kqk1adXxib2X2pEdhCDk3muw; ig_nrcb=1"
```

**Note:** Cookies expire after some time. If you get redirected to login, get fresh cookies and update `INSTAGRAM_COOKIES`.

### R2 Storage (for reel downloads)

If you're using Cloudflare R2 for reel storage:

```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_key
CLOUDFLARE_R2_BUCKET_NAME=your_bucket_name
CLOUDFLARE_R2_PUBLIC_URL=https://your-bucket.r2.dev
DOWNLOAD_REELS_TO_R2=true
```

## ⏱️ Rate Limiting Configuration (Recommended)

To avoid getting blocked by Instagram, configure these variables:

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `MIN_TIME_BETWEEN_JOBS_MS` | `300000` (5 minutes) | Minimum time between Instagram API calls in milliseconds | `300000` = 5 min, `600000` = 10 min |
| `DAILY_CRON_SCHEDULE` | `0 0 * * *` (midnight) | Cron schedule for daily tracking job | `0 2 * * *` = 2 AM daily |
| `REFRESH_CRON_SCHEDULE` | `0 */12 * * *` (every 12 hours) | Cron schedule for periodic refresh | `0 */6 * * *` = every 6 hours |

**Important Rate Limiting Notes:**
- ⚠️ **Instagram has strict rate limits** - Default 5 minutes between jobs is safer than 3 minutes
- 🚫 **Rate limit errors trigger exponential backoff** - System automatically increases delays after errors
- 📊 **Monitor `/queue/status` endpoint** - Check rate limit status and queue health
- 🔄 **Cron jobs respect rate limits** - All jobs go through the queue system automatically

**Example Configuration (Conservative - Recommended):**
```env
MIN_TIME_BETWEEN_JOBS_MS=600000  # 10 minutes between jobs (very safe)
DAILY_CRON_SCHEDULE=0 2 * * *    # Run daily at 2 AM
REFRESH_CRON_SCHEDULE=0 */12 * * *  # Refresh every 12 hours
```

**Example Configuration (Aggressive - Use with Caution):**
```env
MIN_TIME_BETWEEN_JOBS_MS=180000  # 3 minutes between jobs (risky)
DAILY_CRON_SCHEDULE=0 0 * * *    # Run daily at midnight
REFRESH_CRON_SCHEDULE=0 */6 * * *   # Refresh every 6 hours (risky)
```

**Cron Schedule Format:**
```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, Sunday = 0 or 7)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

Examples:
- `0 0 * * *` = Every day at midnight (00:00)
- `0 */6 * * *` = Every 6 hours (00:00, 06:00, 12:00, 18:00)
- `0 */12 * * *` = Every 12 hours (00:00, 12:00)
- `0 2 * * *` = Every day at 2 AM

## ✅ Quick Checklist

### Railway:
- [ ] Go to Railway dashboard
- [ ] Service → Variables tab
- [ ] Add `SUPABASE_URL`
- [ ] Add `SUPABASE_KEY`
- [ ] Add `NODE_ENV=production`
- [ ] Deploy/restart service

### Local:
- [ ] Create `.env` file in `src-backup-railway/`
- [ ] Add all required variables
- [ ] Run `npm start`
- [ ] Verify it works

## 🚨 Common Mistakes

❌ **Don't commit `.env` to git** - It's already in `.gitignore`
❌ **Don't create `.env` on Railway** - Use dashboard variables
❌ **Don't use anon key** - Use service role key for full access
✅ **Do set variables in Railway dashboard** - That's the correct way
✅ **Do use `.env` locally** - For development only

## 🔍 How to Get Supabase Keys

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (secret) → `SUPABASE_KEY`

**Warning**: The service_role key has full database access. Keep it secret!

