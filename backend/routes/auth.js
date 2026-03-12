/*
  ============================================================
  routes/auth.js — Login, OTP, and Session Routes
  ============================================================
  ROUTES IN THIS FILE:
    POST /api/auth/send-otp   → Send a 6-digit code to user's email
    POST /api/auth/verify-otp → Verify the code, return login token
    GET  /api/auth/verify     → Check if a token is still valid

  HOW THE LOGIN FLOW WORKS:
    1. User types their email → POST /api/auth/send-otp
    2. We generate a random 6-digit OTP
    3. We store it in the database with a 10-minute expiry
    4. We email the OTP to the user
    5. User types the OTP → POST /api/auth/verify-otp
    6. We check it against the database
    7. If correct, we create the user (if new) and return a JWT token
    8. Frontend stores the token and uses it for all future requests
  ============================================================
*/

const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");
const { generateToken } = require("../middleware/authenticate");
const { authLimiter } = require("../middleware/rateLimiter");

// Supabase client (our database)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email transporter (for sending OTP emails)
const emailTransporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
 });

// ── POST /api/auth/send-otp ───────────────────────────────────
// Request body: { email: "user@example.com" }
router.post("/send-otp", authLimiter, async (req, res) => {
  const { email } = req.body;

  // Validate email format
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address.",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Generate a 6-digit random OTP
    const otp = generateOTP();

    // Store/update OTP in database with 10-minute expiry
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins from now

    const { error: upsertError } = await supabase
      .from("otp_codes")
      .upsert(
        {
          email: normalizedEmail,
          code: otp,
          expires_at: expiresAt.toISOString(),
          attempts: 0, // Reset attempt counter
        },
        { onConflict: "email" } // If this email already has an OTP, update it
      );

    if (upsertError) throw upsertError;

    // Send the OTP via email
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: normalizedEmail,
      subject: "Your SpellCheck Pro Login Code",
      html: buildOTPEmail(otp, normalizedEmail),
    });

    console.log(`✉️  OTP sent to ${normalizedEmail}`);

    res.json({
      success: true,
      message: "OTP sent to your email address.",
    });

  } catch (err) {
    console.error("send-otp error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please check your email and try again.",
    });
  }
});

// ── POST /api/auth/verify-otp ─────────────────────────────────
// Request body: { email: "user@example.com", otp: "482931" }
router.post("/verify-otp", authLimiter, async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP code are required.",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const cleanOTP = String(otp).trim();

  try {
    // Fetch the stored OTP for this email
    const { data: otpRecord, error: fetchError } = await supabase
      .from("otp_codes")
      .select("code, expires_at, attempts")
      .eq("email", normalizedEmail)
      .single();

    // No OTP found for this email
    if (fetchError || !otpRecord) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new code.",
      });
    }

    // Check if OTP has expired (10 minute limit)
    if (new Date(otpRecord.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "This OTP has expired. Please request a new code.",
      });
    }

    // Check too many failed attempts (max 5 tries per OTP)
    if (otpRecord.attempts >= 5) {
      return res.status(400).json({
        success: false,
        message: "Too many failed attempts. Please request a new code.",
      });
    }

    // Check if the OTP matches
    if (otpRecord.code !== cleanOTP) {
      // Increment the failed attempts counter
      await supabase
        .from("otp_codes")
        .update({ attempts: otpRecord.attempts + 1 })
        .eq("email", normalizedEmail);

      return res.status(400).json({
        success: false,
        message: `Incorrect code. ${4 - otpRecord.attempts} attempts remaining.`,
      });
    }

    // ✓ OTP is correct! Delete it so it can't be reused
    await supabase.from("otp_codes").delete().eq("email", normalizedEmail);

    // Find or create the user in our users table
    let userId;

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (existingUser) {
      // Existing user — just return their ID
      userId = existingUser.id;

      // Update their last_login timestamp
      await supabase
        .from("users")
        .update({ last_login: new Date().toISOString() })
        .eq("id", userId);

    } else {
      // New user — create their account
      const { data: newUser, error: createError } = await supabase
        .from("users")
        .insert({
          email: normalizedEmail,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          is_blocked: false,
        })
        .select("id")
        .single();

      if (createError || !newUser) {
        throw new Error("Failed to create user account.");
      }

      userId = newUser.id;

      // Create a usage record for the new user (starts at 0 corrections)
      await supabase.from("usage").insert({
        user_id: userId,
        corrections_used: 0,
        created_at: new Date().toISOString(),
      });
    }

    // Generate JWT token for the user
    const token = generateToken(userId, normalizedEmail);

    console.log(`✅ Login successful: ${normalizedEmail}`);

    res.json({
      success: true,
      token,
      message: "Login successful!",
    });

  } catch (err) {
    console.error("verify-otp error:", err);
    res.status(500).json({
      success: false,
      message: "Verification failed. Please try again.",
    });
  }
});

// ── GET /api/auth/verify ──────────────────────────────────────
// Checks if a JWT token is still valid
// Used by the frontend on startup to see if user is still logged in
router.get("/verify", async (req, res) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.json({ valid: false });
  }

  try {
    const jwt = require("jsonwebtoken");
    jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
    res.json({ valid: true });
  } catch {
    res.json({ valid: false });
  }
});

// ── HELPER FUNCTIONS ──────────────────────────────────────────

// Generates a random 6-digit OTP number
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Basic email format validation
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Builds the HTML email with the OTP code
function buildOTPEmail(otp, email) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: -apple-system, Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
        .container { max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
        .header { background: #0d1117; padding: 24px; text-align: center; }
        .header h1 { color: #4ecca3; margin: 0; font-size: 20px; }
        .body { padding: 28px 32px; }
        .otp-box { background: #f4f6f9; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
        .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1a6b55; font-family: monospace; }
        .expiry { color: #6b7280; font-size: 13px; text-align: center; }
        .footer { padding: 16px 32px; background: #f4f6f9; font-size: 12px; color: #9ca3af; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✦ SpellCheck Pro</h1>
        </div>
        <div class="body">
          <p>Hi there! Here's your one-time login code for SpellCheck Pro:</p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          <p class="expiry">⏱ This code expires in 10 minutes.</p>
          <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
        <div class="footer">
          SpellCheck Pro · Excel Add-in · Sent to ${email}
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = router;
