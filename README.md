# Instagram Tracking API - Railway Deployment

This is a Railway.app-compatible version of the Instagram Tracking API.

## 🚂 Railway Deployment

### Quick Deploy Steps:

1. **Push to GitHub** (if not already):
   ```bash
   git add .
   git commit -m "Ready for Railway deployment"
   git push
   ```

2. **Deploy on Railway**:
   - Go to https://railway.app
   - Sign in with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will auto-detect Node.js

3. **Configure Service**:
   - Click on your service → **Settings**
   - Set **Root Directory**: `src-backup-railway`
   - **Start Command**: `npm start` (auto-detected)

4. **Add Environment Variables**:
   Go to **Variables** tab and add:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_supabase_service_role_key
   PORT=3001
   NODE_ENV=production
   RAILWAY_API_URL=https://newapi-production-a8b3.up.railway.app
   ```

5. **Get Your URL**:
   - Railway auto-deploys (1-2 minutes)
   - Go to **Settings** → **Domains**
   - Your API URL: `https://newapi-production-a8b3.up.railway.app`

6. **Test**:
   ```bash
   curl https://your-app.up.railway.app/health
   ```

## 📋 Environment Variables

Required:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_KEY` - Your Supabase service role key (or anon key)
- `PORT` - Port to run on (Railway sets this automatically, but you can override)
- `NODE_ENV` - Set to `production` for Railway
- `RAILWAY_API_URL` - Your Railway API URL (default: `https://newapi-production-a8b3.up.railway.app`)

Optional:
- `CLOUDFLARE_R2_*` - If using R2 for reel storage (see services/r2-upload.js)

## 🎯 API Endpoints

- `GET /health` - Health check
- `GET /queue/status` - Queue status
- `POST /profiles` - Register and track profile
- `GET /profiles/:username` - Get profile data
- `GET /profiles/tracking/:tracking_id` - Get profile by tracking ID
- `POST /profiles/:username/refresh` - Refresh profile data
- `GET /profiles/:username/reels` - Get profile reels
- And more... (see routes/profiles.js and routes/reels.js)

## ✅ Differences from Cloudflare Workers

- ✅ **No 30-second timeout** - Railway allows 5-10 minute requests
- ✅ **Traditional Node.js** - Full Express.js server
- ✅ **Cron jobs work** - Both node-cron (in service) and Railway Cron service supported
- ✅ **File system access** - Can download/upload files

## ⏰ Cron Jobs

**Two options for cron jobs:**

1. **node-cron (Current)**: Built into main service, requires service to stay running
2. **Railway Cron Service (Recommended)**: Separate service, more cost-effective

See `RAILWAY_CRON_SETUP.md` for Railway Cron service setup.

## 🔧 Local Development

```bash
npm install
npm start
```

Server runs on `http://localhost:3001` (or PORT env var)

## 📝 Notes

- This version is optimized for Railway.app
- No Cloudflare Workers-specific code
- Uses Express.js directly (no worker wrapper)
- Cron jobs run automatically on Railway


