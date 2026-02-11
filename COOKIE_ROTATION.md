# Cookie Rotation System

The Instagram tracking system now supports **automatic cookie rotation** with backup cookies. If one cookie fails or gets rate limited, the system automatically switches to the next available cookie.

## How It Works

1. **Primary Cookie**: Used first for all requests
2. **Backup Cookies**: Automatically used if primary cookie fails
3. **Automatic Switching**: When a cookie gets rate limited (429, 401, 403) or fails, the system:
   - Waits 1 minute (configurable)
   - Switches to the next cookie
   - Retries the request
4. **Failure Tracking**: Cookies that fail 3+ times are marked as permanently failed and skipped

## Setup

### Method 1: Individual Environment Variables (Recommended)

Set multiple cookies in Railway environment variables. **No limit** - you can add as many as you need!

**Example with 5 backups (6 total cookies):**

```bash
# Primary cookie
INSTAGRAM_COOKIES="mid=xxx; sessionid=xxx; ig_did=xxx; csrftoken=xxx; datr=xxx"

# Backup cookies (up to as many as you need)
INSTAGRAM_COOKIES_2="mid=yyy; sessionid=yyy; ig_did=yyy; csrftoken=yyy; datr=yyy"
INSTAGRAM_COOKIES_3="mid=zzz; sessionid=zzz; ig_did=zzz; csrftoken=zzz; datr=zzz"
INSTAGRAM_COOKIES_4="mid=aaa; sessionid=aaa; ig_did=aaa; csrftoken=aaa; datr=aaa"
INSTAGRAM_COOKIES_5="mid=bbb; sessionid=bbb; ig_did=bbb; csrftoken=bbb; datr=bbb"
INSTAGRAM_COOKIES_6="mid=ccc; sessionid=ccc; ig_did=ccc; csrftoken=ccc; datr=ccc"
```

**You can add more:** `INSTAGRAM_COOKIES_7`, `INSTAGRAM_COOKIES_8`, etc. - no limit!

### Method 2: JSON Array Format

Set a single environment variable with a JSON array (supports unlimited cookies):

```bash
INSTAGRAM_COOKIES_JSON='[
  "mid=xxx; sessionid=xxx; ig_did=xxx; csrftoken=xxx; datr=xxx",
  "mid=yyy; sessionid=yyy; ig_did=yyy; csrftoken=yyy; datr=yyy",
  "mid=zzz; sessionid=zzz; ig_did=zzz; csrftoken=zzz; datr=zzz",
  "mid=aaa; sessionid=aaa; ig_did=aaa; csrftoken=aaa; datr=aaa",
  "mid=bbb; sessionid=bbb; ig_did=bbb; csrftoken=bbb; datr=bbb",
  "mid=ccc; sessionid=ccc; ig_did=ccc; csrftoken=ccc; datr=ccc"
]'
```

## How to Get Cookies

1. Open Chrome and **log into Instagram** (instagram.com)
2. Press **F12** to open DevTools
3. Go to **Application** tab → **Storage** → **Cookies** → `https://www.instagram.com`
4. Copy the values for:
   - **`sessionid`** (REQUIRED - most important!)
   - `mid`
   - `csrftoken`
   - `datr`
   - `ig_did`
   - `ig_nrcb`
5. Format: `name1=value1; name2=value2; name3=value3`

## Example

```bash
# Primary cookie
INSTAGRAM_COOKIES="mid=aTWpkwALAAGNrS5VWDp3XLkvTyKs; sessionid=78008627449:qvWgKbVeJDfB30:26:AYjz9UKXsrWakkpQ2xkBjlX9fmtL6y9PIKl8rFphxW8; ig_did=2612B2C8-FA74-4AE2-BB32-88737E2AEC82; csrftoken=a80jwHWaDK-5n8J9RACM9L; datr=kqk1adXxib2X2pEdhCDk3muw"

# Backup cookie 1
INSTAGRAM_COOKIES_2="mid=DIFFERENT_VALUE; sessionid=DIFFERENT_SESSION_ID; ig_did=DIFFERENT_ID; csrftoken=DIFFERENT_TOKEN; datr=DIFFERENT_DATR"

# Backup cookie 2
INSTAGRAM_COOKIES_3="mid=ANOTHER_VALUE; sessionid=ANOTHER_SESSION_ID; ig_did=ANOTHER_ID; csrftoken=ANOTHER_TOKEN; datr=ANOTHER_DATR"
```

## What Happens When a Cookie Fails

1. **Rate Limit (429)**: System detects rate limit → waits 1 minute → switches to next cookie → retries
2. **Auth Failed (401)**: System detects auth failure → waits 1 minute → switches to next cookie → retries
3. **Forbidden (403)**: System detects forbidden → waits 1 minute → switches to next cookie → retries
4. **Login Redirect**: Playwright detects login page → waits 1 minute → switches to next cookie → retries

## Logs

You'll see logs like:

```
🍪 [Instagram] Using cookie 1 for username
🚫 [Instagram] Rate limit (429) for username with cookie 1
🔄 [Cookie Manager] Switched from cookie 1 to cookie 2
🔄 [Instagram] Switching to next cookie and retrying...
🍪 [Instagram] Using cookie 2 for username
✅ [Cookie Manager] Cookie 2 working - reset failure count
```

## Benefits

- **No Manual Intervention**: System automatically switches cookies
- **Higher Success Rate**: If one cookie is rate limited, others can still work
- **Resilient**: Can handle multiple cookie failures
- **Smart Retry**: Only switches after delay to avoid rapid switching

## Notes

- **No limit on backup cookies** - add as many as you need (INSTAGRAM_COOKIES_2, _3, _4, _5, _6, etc.)
- Cookies expire after some time - update them regularly
- More cookies = better resilience (recommend 2-5 backup cookies for production)
- System tracks which cookies work and which don't
- Failed cookies are automatically skipped after 3 failures
- System will cycle through all available cookies before giving up

