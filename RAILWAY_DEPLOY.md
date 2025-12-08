# 🚂 Railway Deployment Guide

## Step-by-Step Deployment

### 1. Prepare Your Code

Make sure all files are in `src-backup-railway/` folder:
- ✅ `index.js` (main server file)
- ✅ `package.json` (with start script)
- ✅ `routes/` folder
- ✅ `services/` folder

### 2. Push to GitHub

```bash
git add src-backup-railway/
git commit -m "Add Railway-compatible API"
git push
```

### 3. Deploy on Railway

1. Go to **https://railway.app**
2. Sign in with **GitHub**
3. Click **"New Project"**
4. Select **"Deploy from GitHub repo"**
5. Choose your repository

### 4. Configure Service

1. Click on your service
2. Go to **Settings** tab
3. Set **Root Directory**: `src-backup-railway`
4. **Start Command**: `npm start` (should auto-detect)

### 5. Add Environment Variables

Go to **Variables** tab, click **+ New Variable**, add:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_key
PORT=3001
NODE_ENV=production
```

**Important**: 
- Use your **Supabase Service Role Key** (not anon key) for full database access
- Railway sets PORT automatically, but you can override it

### 6. Deploy

- Railway will auto-deploy when you push to GitHub
- Or click **"Deploy"** button manually
- **Wait 2-3 minutes for build to complete** (Playwright browser installation takes extra time)
- The build will automatically install Playwright Chromium browser and system dependencies

### 7. Get Your URL

1. Go to **Settings** → **Domains**
2. Copy your Railway URL: `https://your-app.up.railway.app`
3. Test it: `curl https://your-app.up.railway.app/health`

### 8. Update Frontend

Update your Next.js app's `.env.local`:
```env
NEXT_PUBLIC_API_URL=https://your-app.up.railway.app
```

## ✅ Verification

Test these endpoints:

```bash
# Health check
curl https://your-app.up.railway.app/health

# Queue status
curl https://your-app.up.railway.app/queue/status

# API info
curl https://your-app.up.railway.app/
```

## 🔧 Troubleshooting

### Build Fails
- Check **Root Directory** is `src-backup-railway`
- Verify `package.json` has `"start": "node index.js serve"`
- Check build logs in Railway dashboard
- **Playwright Installation**: If Playwright browser installation fails, check build logs for errors. The `postinstall` script should automatically install Chromium with system dependencies.

### Service Not Responding
- Check environment variables are set
- Verify Supabase credentials
- Check logs for errors

### Port Issues
- Railway sets PORT automatically
- Don't hardcode port in code
- Use `process.env.PORT || 3001`

### Playwright Issues
- **Browser not found**: The `postinstall` script should install Chromium automatically. If it fails, check build logs.
- **System dependencies missing (libglib-2.0.so.0 error)**: 
  - ✅ **FIXED**: A `Dockerfile` is included that installs all required system dependencies
  - Railway will automatically use the Dockerfile if present
  - The Dockerfile installs: libglib2.0-0, libnss3, libnspr4, and all other Chromium dependencies
  - If Railway is using nixpacks instead, you can force Docker by adding a `railway.json` or setting the buildpack in Railway settings
- **Build time**: Playwright installation adds ~1-2 minutes to build time (this is normal).
- **Memory**: Playwright headless browser runs fine on Railway's default memory limits.

## 💰 Cost

- **Free Tier**: $5 credit/month (usually enough for small apps)
- **Hobby**: $5/month if you exceed free credit
- **No credit card needed** for free tier

## 🎉 Done!

Your API is now:
- ✅ Live 24/7 on Railway
- ✅ HTTPS enabled automatically
- ✅ Auto-deploys on git push
- ✅ No timeout issues (unlike Cloudflare Workers)
- ✅ Playwright Chromium browser installed and ready for Instagram scraping



