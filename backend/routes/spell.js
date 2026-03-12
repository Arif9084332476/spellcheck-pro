/*
  ============================================================
  routes/spell.js — Spell Check API Routes
  ============================================================
  ROUTES IN THIS FILE:
    POST /api/spell-check     → Main spell check endpoint
    POST /api/usage/increment → Record a correction was made
    GET  /api/usage           → Get current user's usage stats

  HOW SPELL CHECKING WORKS:
    1. Frontend sends array of cells: [{address, text}, ...]
    2. We check if user has available corrections (free or paid)
    3. We send each cell's text to LanguageTool API
    4. LanguageTool returns error locations and suggestions
    5. We filter out custom dictionary words (Paneer, etc.)
    6. We return clean error list to frontend
  ============================================================
*/

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { authenticate } = require("../middleware/authenticate");
const { spellCheckLimiter } = require("../middleware/rateLimiter");
const { checkCells } = require("../utils/languageTool");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FREE_LIMIT = 20; // Free corrections before paywall

// ── POST /api/spell-check ─────────────────────────────────────
// Request body:
//   { cells: [{address: "A1", text: "Chiken"}, ...], mode: "selection" }
// Response:
//   { success: true, errors: [{address, original, correction, suggestions, fullText}] }
router.post("/spell-check", authenticate, spellCheckLimiter, async (req, res) => {
  const { cells, mode } = req.body;
  const userId = req.user.id;

  // Validate input
  if (!cells || !Array.isArray(cells) || cells.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No cells provided for spell check.",
    });
  }

  // Limit cell count to prevent abuse (max 500 cells per request)
  if (cells.length > 500) {
    return res.status(400).json({
      success: false,
      message: "Too many cells selected. Please select fewer than 500 cells.",
    });
  }

  try {
    // ── Step 1: Check user's subscription/usage ───────────────
    const userStatus = await getUserStatus(userId);

    // If not subscribed and at free limit → reject with paywall code
    if (!userStatus.isSubscribed && userStatus.correctionsUsed >= FREE_LIMIT) {
      return res.status(402).json({
        success: false,
        message: "You've used all 20 free corrections. Please subscribe to continue.",
        code: "LIMIT_REACHED",
        corrections_used: userStatus.correctionsUsed,
        is_subscribed: false,
      });
    }

    // ── Step 2: Run spell check ───────────────────────────────
    const errors = await checkCells(cells);

    // ── Step 3: Return results ────────────────────────────────
    res.json({
      success: true,
      errors,
      total_errors: errors.length,
      corrections_remaining: userStatus.isSubscribed
        ? "unlimited"
        : Math.max(0, FREE_LIMIT - userStatus.correctionsUsed),
    });

  } catch (err) {
    console.error("spell-check route error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Spell check failed. Please try again.",
    });
  }
});

// ── POST /api/usage/increment ─────────────────────────────────
// Called by frontend each time user clicks "Correct" or "Correct All"
// Body: { count: 1 }  (how many corrections to add)
router.post("/usage/increment", authenticate, async (req, res) => {
  const userId = req.user.id;
  const count  = parseInt(req.body?.count || "1", 10);

  // Sanity check: can't add negative corrections or huge numbers
  if (isNaN(count) || count < 1 || count > 500) {
    return res.status(400).json({
      success: false,
      message: "Invalid correction count.",
    });
  }

  try {
    // Use Supabase's RPC to atomically increment (prevents race conditions)
    const { error } = await supabase.rpc("increment_corrections", {
      p_user_id: userId,
      p_count: count,
    });

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    console.error("usage/increment error:", err);
    // Don't fail silently — but also don't break the user experience
    res.status(500).json({
      success: false,
      message: "Failed to record usage.",
    });
  }
});

// ── GET /api/usage ────────────────────────────────────────────
// Returns current user's usage and subscription status
router.get("/usage", authenticate, async (req, res) => {
  try {
    const status = await getUserStatus(req.user.id);

    res.json({
      success: true,
      corrections_used: status.correctionsUsed,
      corrections_remaining: status.isSubscribed
        ? "unlimited"
        : Math.max(0, FREE_LIMIT - status.correctionsUsed),
      is_subscribed: status.isSubscribed,
      sub_expiry: status.subExpiry,
      free_limit: FREE_LIMIT,
    });

  } catch (err) {
    console.error("usage route error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to load usage data.",
    });
  }
});

// ── HELPER: Get user status from DB ──────────────────────────
async function getUserStatus(userId) {
  // Get corrections count from usage table
  const { data: usage } = await supabase
    .from("usage")
    .select("corrections_used")
    .eq("user_id", userId)
    .single();

  // Check for active subscription
  const now = new Date().toISOString();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .gt("expires_at", now)     // Only subscriptions that haven't expired
    .order("expires_at", { ascending: false })
    .limit(1)
    .single();

  return {
    correctionsUsed: usage?.corrections_used || 0,
    isSubscribed: !!sub,
    subExpiry: sub?.expires_at
      ? new Date(sub.expires_at).toLocaleDateString("en-IN", {
          day: "numeric", month: "short", year: "numeric"
        })
      : null,
  };
}

module.exports = router;
