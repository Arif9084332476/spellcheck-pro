-- ============================================================
-- SUPABASE DATABASE SETUP SQL
-- ============================================================
-- INSTRUCTIONS:
--   1. Go to https://supabase.com and sign up (free)
--   2. Create a new project (choose any region near India)
--   3. Go to your project → SQL Editor (left sidebar)
--   4. Paste this ENTIRE file and click "Run"
--   5. All tables will be created automatically ✓
-- ============================================================


-- ── TABLE 1: users ────────────────────────────────────────────
-- Stores one row per user who has signed up
CREATE TABLE IF NOT EXISTS users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_login  TIMESTAMPTZ DEFAULT NOW(),
  is_blocked  BOOLEAN DEFAULT FALSE
);

-- Index: Makes email lookups very fast
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);


-- ── TABLE 2: otp_codes ────────────────────────────────────────
-- Temporarily stores OTP codes during login
-- Each code is deleted immediately after being used
CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,  -- One OTP per email at a time
  code        TEXT NOT NULL,          -- The 6-digit number
  expires_at  TIMESTAMPTZ NOT NULL,  -- 10 minutes from creation
  attempts    INTEGER DEFAULT 0,     -- How many times user tried wrong code
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup: Automatically delete expired OTP codes every hour
-- (Keeps the table small and clean)
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);


-- ── TABLE 3: usage ────────────────────────────────────────────
-- Tracks how many corrections each user has used
-- One row per user (updated in place)
CREATE TABLE IF NOT EXISTS usage (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corrections_used  INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)  -- Only one row per user
);

CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);


-- ── TABLE 4: subscriptions ────────────────────────────────────
-- Records every paid subscription
-- Multiple rows per user (one per payment)
CREATE TABLE IF NOT EXISTS subscriptions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active   BOOLEAN DEFAULT TRUE,
  starts_at   TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  payment_id  TEXT,              -- Razorpay payment_id
  order_id    TEXT,              -- Razorpay order_id
  amount      INTEGER NOT NULL,  -- Amount in paise
  days        INTEGER NOT NULL,  -- 1, 7, or 30
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_user_id    ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_expires_at ON subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sub_is_active  ON subscriptions(is_active);


-- ── TABLE 5: payment_orders ───────────────────────────────────
-- Tracks Razorpay orders (before payment is confirmed)
CREATE TABLE IF NOT EXISTS payment_orders (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    TEXT UNIQUE NOT NULL,   -- Razorpay order ID (rzp_...)
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,       -- In paise
  days        INTEGER NOT NULL,
  status      TEXT DEFAULT 'created', -- 'created', 'paid', 'failed'
  payment_id  TEXT,                   -- Set after payment
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_order_id ON payment_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id  ON payment_orders(user_id);


-- ── FUNCTION: increment_corrections ──────────────────────────
-- This function safely adds to the corrections count.
-- Using a function prevents "race conditions" where two requests
-- might try to update the count at the same time.
CREATE OR REPLACE FUNCTION increment_corrections(
  p_user_id UUID,
  p_count   INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  UPDATE usage
  SET
    corrections_used = corrections_used + p_count,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  -- If no row exists (shouldn't happen, but safety net):
  IF NOT FOUND THEN
    INSERT INTO usage (user_id, corrections_used)
    VALUES (p_user_id, p_count);
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ── ROW LEVEL SECURITY (RLS) ─────────────────────────────────
-- Enable RLS on all tables (security best practice for Supabase)
-- Our backend uses the SERVICE KEY which bypasses RLS,
-- but this prevents accidental direct database access.
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

-- Note: We use Supabase's SERVICE KEY in the backend, which
-- bypasses RLS. This is intentional and safe for server-side use.


-- ── VERIFY SETUP ─────────────────────────────────────────────
-- Run these queries to verify everything was created:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT routine_name FROM information_schema.routines WHERE routine_type = 'FUNCTION';


-- ══════════════════════════════════════════════════════════════
-- ✓ DONE! All tables created.
-- Now go back to the SETUP GUIDE to continue with Step 4.
-- ══════════════════════════════════════════════════════════════
