# 🚨 Quick Fix: SUPABASE_KEY Missing Error

## The Problem

You're seeing:
```
❌ SUPABASE_KEY is missing! Set SUPABASE_KEY or SUPABASE_ANON_KEY in .env
```

## ✅ The Solution

**On Railway, you DON'T use a `.env` file!** Set environment variables in the Railway dashboard.

### Steps to Fix:

1. **Go to Railway Dashboard**
   - https://railway.app
   - Click on your project
   - Click on your service

2. **Go to Variables Tab**
   - Click **Variables** tab (top menu)
   - Click **+ New Variable** button

3. **Add These Variables:**
   ```
   Name: SUPABASE_URL
   Value: https://your-project.supabase.co
   
   Name: SUPABASE_KEY
   Value: your_supabase_service_role_key
   
   Name: NODE_ENV
   Value: production
   ```

4. **Save and Redeploy**
   - Railway will automatically redeploy
   - Wait 1-2 minutes
   - Check logs - error should be gone!

## 🔍 How to Get Supabase Keys

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → Use for `SUPABASE_URL`
   - **service_role** key (secret) → Use for `SUPABASE_KEY`

## ✅ Verify It Works

After adding variables, check Railway logs:
- Should see: `✅ Supabase connected successfully!`
- Should NOT see: `❌ SUPABASE_KEY is missing!`

## 📝 Note

- **Don't create `.env` file on Railway** - It won't work
- **Use Railway Variables tab** - That's the correct way
- **Variables are encrypted** - Safe to store secrets there

