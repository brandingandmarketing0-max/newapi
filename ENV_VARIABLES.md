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

Create `.env` file:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_key
PORT=3001
NODE_ENV=development
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

## 🔐 Optional Variables (for R2 storage)

If you're using Cloudflare R2 for reel storage:

```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_key
CLOUDFLARE_R2_BUCKET_NAME=your_bucket_name
CLOUDFLARE_R2_PUBLIC_URL=https://your-bucket.r2.dev
```

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

