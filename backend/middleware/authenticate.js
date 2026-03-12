/*
  ============================================================
  middleware/authenticate.js — Protect API Routes
  ============================================================
  PURPOSE:
    This "middleware" runs BEFORE your route handlers.
    It checks if the request has a valid login token.

    If the token is valid  → the request continues ✓
    If the token is invalid → the request is rejected ✗

  WHAT IS A MIDDLEWARE?
    Think of it like a security guard at a door.
    Every request must show their badge (token) before
    being allowed into the protected area (the API route).

  HOW JWT TOKENS WORK:
    When a user logs in, we create a signed "JWT token"
    (a long string that encodes the user's ID and email).
    The frontend stores this token and sends it with
    every API request in the "Authorization" header:
      Authorization: Bearer eyJhbGciOiJIUzI1...
  ============================================================
*/

const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

// Get the JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET;

// Supabase client for looking up users in database
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/*
  authenticate(req, res, next)
  ==============================
  Express middleware function.
  Call next() to allow the request through,
  or res.status(401).json() to reject it.
*/
async function authenticate(req, res, next) {
  try {
    // 1. Extract the token from the request header
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
        code: "NO_TOKEN",
      });
    }

    // Remove "Bearer " prefix to get just the token string
    const token = authHeader.substring(7);

    // 2. Verify the token signature (was it signed by us?)
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
        code: "INVALID_TOKEN",
      });
    }

    // 3. Check that the user still exists in our database
    // (In case we deleted their account)
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, is_blocked")
      .eq("id", decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Account not found. Please create a new account.",
        code: "USER_NOT_FOUND",
      });
    }

    // 4. Check if user has been blocked (abuse prevention)
    if (user.is_blocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended. Please contact support.",
        code: "ACCOUNT_BLOCKED",
      });
    }

    // 5. All good! Attach user info to the request object
    // So the route handler can use req.user
    req.user = {
      id: user.id,
      email: user.email,
    };

    // Let the request continue to the route handler
    next();

  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({
      success: false,
      message: "Authentication error. Please try again.",
      code: "AUTH_ERROR",
    });
  }
}

/*
  generateToken(userId, email)
  ==============================
  Creates a new JWT token for a user.
  This token is valid for 30 days.

  The token is SIGNED (not encrypted) — meaning anyone can
  decode and read it, but only WE can verify it's genuine
  because it's signed with our JWT_SECRET.
*/
function generateToken(userId, email) {
  return jwt.sign(
    {
      userId,
      email,
      iat: Math.floor(Date.now() / 1000), // "Issued at" timestamp
    },
    JWT_SECRET,
    {
      expiresIn: "30d", // Token valid for 30 days
    }
  );
}

module.exports = { authenticate, generateToken };
