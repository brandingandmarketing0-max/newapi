/**
 * Cookie Rotation Manager for Instagram
 * 
 * Supports multiple backup cookies that rotate when rate limited or failing.
 * 
 * Environment variables:
 * - INSTAGRAM_COOKIES: Primary cookie (required)
 * - INSTAGRAM_COOKIES_2, INSTAGRAM_COOKIES_3, etc.: Backup cookies (optional)
 * 
 * Or use JSON array format:
 * - INSTAGRAM_COOKIES_JSON: JSON array of cookie strings
 */

class CookieManager {
  constructor() {
    this.cookies = [];
    this.currentIndex = 0;
    this.failedCookies = new Set(); // Track cookies that failed
    this.cookieFailureCount = new Map(); // Track failure count per cookie
    this.cookieFailureTime = new Map(); // Track when each cookie failed (for auto-reset)
    this.lastSwitchTime = 0;
    this.switchDelay = 60000; // 1 minute delay before switching cookies
    this.cookieResetTime = 60 * 60 * 1000; // Reset cookie failures after 60 minutes
    
    this.loadCookies();
    
    // Auto-reset failed cookies periodically
    setInterval(() => {
      this.autoResetFailedCookies();
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Load cookies from environment variables
   */
  loadCookies() {
    // Method 1: Try JSON array format first
    if (process.env.INSTAGRAM_COOKIES_JSON) {
      try {
        const cookieArray = JSON.parse(process.env.INSTAGRAM_COOKIES_JSON);
        if (Array.isArray(cookieArray)) {
          this.cookies = cookieArray.filter(c => c && c.trim() !== '');
          console.log(`🍪 [Cookie Manager] Loaded ${this.cookies.length} cookies from INSTAGRAM_COOKIES_JSON`);
          return;
        }
      } catch (err) {
        console.warn(`⚠️  [Cookie Manager] Failed to parse INSTAGRAM_COOKIES_JSON: ${err.message}`);
      }
    }

    // Method 2: Load individual cookies (INSTAGRAM_COOKIES, INSTAGRAM_COOKIES_2, etc.)
    const cookies = [];
    
    // Primary cookie
    if (process.env.INSTAGRAM_COOKIES) {
      cookies.push(process.env.INSTAGRAM_COOKIES);
    }
    
    // Backup cookies (INSTAGRAM_COOKIES_2, INSTAGRAM_COOKIES_3, INSTAGRAM_COOKIES_4)
    // Stop at INSTAGRAM_COOKIES_4, keep INSTAGRAM_COOKIES_5 and INSTAGRAM_COOKIES_6 empty
    let index = 2;
    while (index <= 4 && process.env[`INSTAGRAM_COOKIES_${index}`]) {
      cookies.push(process.env[`INSTAGRAM_COOKIES_${index}`]);
      index++;
    }
    
    this.cookies = cookies.filter(c => c && c.trim() !== '');
    
    if (this.cookies.length === 0) {
      console.warn(`⚠️  [Cookie Manager] No cookies found! Set INSTAGRAM_COOKIES or INSTAGRAM_COOKIES_JSON`);
    } else {
      console.log(`🍪 [Cookie Manager] Loaded ${this.cookies.length} cookie(s) (primary + ${this.cookies.length - 1} backup)`);
    }
  }

  /**
   * Get current cookie
   */
  getCurrentCookie() {
    if (this.cookies.length === 0) {
      return null;
    }
    return this.cookies[this.currentIndex];
  }

  /**
   * Get all available cookies (for debugging)
   */
  getAllCookies() {
    return this.cookies;
  }

  /**
   * Mark current cookie as failed and switch to next
   * @param {String} reason - Reason for failure (e.g., 'rate_limit', 'auth_failed')
   */
  markCookieFailed(reason = 'unknown') {
    const currentCookie = this.getCurrentCookie();
    if (!currentCookie) return;

    const cookieId = this.currentIndex;
    const failureCount = (this.cookieFailureCount.get(cookieId) || 0) + 1;
    this.cookieFailureCount.set(cookieId, failureCount);
    this.cookieFailureTime.set(cookieId, Date.now()); // Record failure time

    console.log(`🚫 [Cookie Manager] Cookie ${cookieId + 1} failed (${reason}) - Failure count: ${failureCount}`);
    
    // If cookie failed multiple times, mark it as permanently failed
    if (failureCount >= 3) {
      this.failedCookies.add(cookieId);
      console.log(`❌ [Cookie Manager] Cookie ${cookieId + 1} marked as permanently failed (${failureCount} failures)`);
    }

    // Switch to next cookie after delay
    const now = Date.now();
    const timeSinceLastSwitch = now - this.lastSwitchTime;
    
    if (timeSinceLastSwitch < this.switchDelay) {
      const waitTime = this.switchDelay - timeSinceLastSwitch;
      console.log(`⏳ [Cookie Manager] Waiting ${Math.round(waitTime / 1000)}s before switching cookies...`);
      return waitTime;
    }

    this.switchToNextCookie();
    return 0;
  }

  /**
   * Switch to next available cookie
   */
  switchToNextCookie() {
    if (this.cookies.length <= 1) {
      console.log(`⚠️  [Cookie Manager] Only 1 cookie available, cannot switch`);
      return false;
    }

    const previousIndex = this.currentIndex;
    let attempts = 0;
    const maxAttempts = this.cookies.length;

    // Find next available cookie (skip failed ones)
    do {
      this.currentIndex = (this.currentIndex + 1) % this.cookies.length;
      attempts++;
    } while (this.failedCookies.has(this.currentIndex) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      // All cookies failed, reset and try again
      console.log(`⚠️  [Cookie Manager] All cookies failed, resetting and trying again...`);
      this.failedCookies.clear();
      this.cookieFailureCount.clear();
      this.currentIndex = 0;
    }

    if (this.currentIndex !== previousIndex) {
      console.log(`🔄 [Cookie Manager] Switched from cookie ${previousIndex + 1} to cookie ${this.currentIndex + 1}`);
      this.lastSwitchTime = Date.now();
      return true;
    }

    return false;
  }

  /**
   * Mark current cookie as successful (reset failure count)
   */
  markCookieSuccess() {
    const cookieId = this.currentIndex;
    if (this.cookieFailureCount.has(cookieId)) {
      this.cookieFailureCount.delete(cookieId);
      this.failedCookies.delete(cookieId);
      console.log(`✅ [Cookie Manager] Cookie ${cookieId + 1} working - reset failure count`);
    }
  }

  /**
   * Get status of all cookies
   */
  getStatus() {
    return {
      totalCookies: this.cookies.length,
      currentCookie: this.currentIndex + 1,
      failedCookies: Array.from(this.failedCookies).map(i => i + 1),
      failureCounts: Object.fromEntries(
        Array.from(this.cookieFailureCount.entries()).map(([i, count]) => [i + 1, count])
      )
    };
  }

  /**
   * Auto-reset cookies that failed more than cookieResetTime ago
   */
  autoResetFailedCookies() {
    const now = Date.now();
    let resetCount = 0;
    
    for (const [cookieId, failureTime] of this.cookieFailureTime.entries()) {
      if (now - failureTime >= this.cookieResetTime) {
        // Reset this cookie - it's been long enough
        this.failedCookies.delete(cookieId);
        this.cookieFailureCount.delete(cookieId);
        this.cookieFailureTime.delete(cookieId);
        resetCount++;
      }
    }
    
    if (resetCount > 0) {
      console.log(`🔄 [Cookie Manager] Auto-reset ${resetCount} cookie(s) after ${Math.round(this.cookieResetTime / 1000 / 60)} minutes`);
    }
  }

  /**
   * Check if all cookies are currently rate limited
   */
  areAllCookiesRateLimited() {
    const status = this.getStatus();
    return status.totalCookies > 0 && 
           status.totalCookies === status.failedCookies.length &&
           Object.values(status.failureCounts || {}).every(count => count >= 2);
  }

  /**
   * Get time until cookies can be retried (if all are rate limited)
   */
  getTimeUntilRetry() {
    if (!this.areAllCookiesRateLimited()) {
      return 0;
    }
    
    const now = Date.now();
    let maxWaitTime = 0;
    
    for (const [cookieId, failureTime] of this.cookieFailureTime.entries()) {
      const timeSinceFailure = now - failureTime;
      const timeUntilReset = this.cookieResetTime - timeSinceFailure;
      if (timeUntilReset > maxWaitTime) {
        maxWaitTime = timeUntilReset;
      }
    }
    
    return Math.max(0, maxWaitTime);
  }

  /**
   * Reset all failure tracking (useful for testing or after manual cookie updates)
   */
  reset() {
    this.failedCookies.clear();
    this.cookieFailureCount.clear();
    this.cookieFailureTime.clear();
    this.currentIndex = 0;
    this.lastSwitchTime = 0;
    console.log(`🔄 [Cookie Manager] Reset - all cookies available again`);
  }
}

// Export singleton instance
const cookieManager = new CookieManager();

module.exports = cookieManager;

