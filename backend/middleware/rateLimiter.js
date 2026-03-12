/*
  ============================================================
  middleware/rateLimiter.js — Prevent Abuse / DDoS
  ============================================================
  PURPOSE:
    Rate limiting prevents people from hammering your API
    with thousands of requests per second.

    Without it:
      - Someone could spam /api/spell-check and rack up costs
      - Someone could try millions of OTP combinations
      - Your server could crash from too many requests

  HOW IT WORKS:
    We track how many requests each IP address makes
    within a time window. If they exceed the limit, we
    return a 429 "Too Many Requests" error.

  DIFFERENT LIMITS FOR DIFFERENT ROUTES:
    - General API: 100 requests per 15 minutes
    - Auth routes: 10 requests per 15 minutes (stricter!)
    - Spell check: 30 requests per 15 minutes
  ============================================================
*/

const rateLimit = require("express-rate-limit");

// ── General API Rate Limiter ──────────────────────────────────
// Applied to all routes as a baseline protection
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes in milliseconds
  max: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  standardHeaders: true,   // Send rate limit info in response headers
  legacyHeaders: false,     // Don't send old-style X-RateLimit headers

  // Custom error message returned when limit is hit
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "Too many requests. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    });
  },

  // How to identify users: by IP address
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// ── Auth Route Rate Limiter ───────────────────────────────────
// Much stricter — prevents brute-force OTP guessing attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // Only 10 auth attempts per 15 mins

  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "Too many login attempts. Please wait 15 minutes.",
      code: "AUTH_RATE_LIMITED",
    });
  },

  // Skip rate limiting if the request succeeds (200 response)
  // This way failed OTP attempts are counted, but not successful logins
  skipSuccessfulRequests: true,

  keyGenerator: (req) => {
    // Rate limit by IP + email (prevents one IP from blocking everyone)
    const email = req.body?.email || "";
    return `${req.ip}_${email}`;
  },
});

// ── Spell Check Route Rate Limiter ────────────────────────────
// Medium strictness — prevents API abuse / cost inflation
const spellCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                   // 30 spell-check calls per 15 mins

  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "Too many spell check requests. Please wait a few minutes.",
      code: "SPELL_CHECK_RATE_LIMITED",
    });
  },

  // Rate limit by authenticated user ID (not just IP)
  // So multiple users on the same network aren't affected by each other
  keyGenerator: (req) => {
    return req.user?.id || req.ip;
  },
});

module.exports = { generalLimiter, authLimiter, spellCheckLimiter };
