/*
  ============================================================
  routes/payment.js — Razorpay UPI Payment Routes
  ============================================================
  ROUTES IN THIS FILE:
    POST /api/payment/create-order  → Create a Razorpay payment order
    POST /api/payment/verify        → Verify payment after completion
    POST /api/payment/check-latest  → Check if a pending order was paid
    GET  /payment-page              → Hosted payment page (for Office dialog)

  HOW RAZORPAY PAYMENT WORKS:
    1. We create an "Order" on Razorpay servers (amount, currency)
    2. Razorpay gives us an order_id
    3. We open the Razorpay payment UI (in an Office dialog)
    4. User pays via UPI
    5. Razorpay sends us payment_id, order_id, signature
    6. We VERIFY the signature to confirm it's genuine
    7. If verified, we activate the subscription in our database

  SIGNATURE VERIFICATION (IMPORTANT FOR SECURITY):
    The signature is like a fingerprint that proves Razorpay
    really processed this payment. Without verifying it,
    anyone could send fake "I paid!" messages to your API.
  ============================================================
*/

const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { authenticate } = require("../middleware/authenticate");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Initialize Razorpay client with your API keys
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Price per day in paise (1 INR = 100 paise, so ₹1 = 100 paise)
const PRICE_PER_DAY_PAISE = 100;

// ── POST /api/payment/create-order ───────────────────────────
// Creates a new Razorpay order for the user to pay
// Body: { days: 1 }  (number of subscription days)
router.post("/create-order", authenticate, async (req, res) => {
  const days = parseInt(req.body?.days || "1", 10);

  // Validate days (must be 1, 7, or 30)
  if (![1, 7, 30].includes(days)) {
    return res.status(400).json({
      success: false,
      message: "Invalid subscription duration. Choose 1, 7, or 30 days.",
    });
  }

  const amountPaise = days * PRICE_PER_DAY_PAISE; // ₹1/day * days

  try {
    // Create an order on Razorpay's servers
    const order = await razorpay.orders.create({
      amount: amountPaise,             // Amount in PAISE (not rupees!)
      currency: "INR",
      receipt: `scp_${req.user.id}_${Date.now()}`, // Unique receipt ID
      notes: {
        user_id: req.user.id,
        email: req.user.email,
        days: days,
        product: "SpellCheck Pro Subscription",
      },
    });

    // Save pending order to our database
    await supabase.from("payment_orders").insert({
      order_id:   order.id,
      user_id:    req.user.id,
      amount:     amountPaise,
      days:       days,
      status:     "created",
      created_at: new Date().toISOString(),
    });

    console.log(`💳 Order created: ${order.id} for ${req.user.email} (${days} days)`);

    res.json({
      success: true,
      order_id:     order.id,
      amount:       amountPaise,
      currency:     "INR",
      razorpay_key: process.env.RAZORPAY_KEY_ID, // Frontend needs this to open payment UI
      days,
    });

  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to create payment order. Please try again.",
    });
  }
});

// ── POST /api/payment/verify ──────────────────────────────────
// Called after payment succeeds, to verify it's genuine
// Body: { payment_id, order_id, signature, days }
router.post("/verify", authenticate, async (req, res) => {
  const { payment_id, order_id, signature, days } = req.body;

  if (!payment_id || !order_id || !signature) {
    return res.status(400).json({
      success: false,
      message: "Missing payment verification data.",
    });
  }

  try {
    // ── SECURITY: Verify the payment signature ────────────────
    // Razorpay signs the payment with our KEY_SECRET.
    // We re-compute the signature and compare. If they match,
    // the payment is 100% genuine.
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${order_id}|${payment_id}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.warn(`⚠️  Signature mismatch for order ${order_id}`);
      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Invalid signature.",
        code: "INVALID_SIGNATURE",
      });
    }

    // ── Signature verified! Now activate the subscription ─────
    const subscriptionDays = parseInt(days || "1", 10);
    const expiresAt = new Date(Date.now() + subscriptionDays * 24 * 60 * 60 * 1000);

    // Deactivate any existing subscriptions first
    await supabase
      .from("subscriptions")
      .update({ is_active: false })
      .eq("user_id", req.user.id);

    // Create new active subscription
    const { error: subError } = await supabase.from("subscriptions").insert({
      user_id:    req.user.id,
      is_active:  true,
      starts_at:  new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      payment_id,
      order_id,
      amount:     subscriptionDays * PRICE_PER_DAY_PAISE,
      days:       subscriptionDays,
      created_at: new Date().toISOString(),
    });

    if (subError) throw subError;

    // Update the order status in our payment_orders table
    await supabase
      .from("payment_orders")
      .update({ status: "paid", payment_id })
      .eq("order_id", order_id);

    // Reset the user's correction count (fresh start with subscription)
    await supabase
      .from("usage")
      .update({ corrections_used: 0 })
      .eq("user_id", req.user.id);

    const expiryDateDisplay = expiresAt.toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });

    console.log(`✅ Subscription activated: ${req.user.email} until ${expiryDateDisplay}`);

    res.json({
      success: true,
      message: `Subscription activated! Valid until ${expiryDateDisplay}`,
      expiry_date: expiryDateDisplay,
    });

  } catch (err) {
    console.error("payment/verify error:", err);
    res.status(500).json({
      success: false,
      message: "Payment verification failed. Please contact support.",
    });
  }
});

// ── POST /api/payment/check-latest ───────────────────────────
// Checks if an order was paid (for manual verification flow)
router.post("/check-latest", authenticate, async (req, res) => {
  const { order_id, days } = req.body;
  if (!order_id) {
    return res.status(400).json({ success: false, message: "Order ID required." });
  }

  try {
    // Fetch the order from Razorpay to check its status
    const order = await razorpay.orders.fetch(order_id);

    if (order.status === "paid") {
      // Fetch the payment ID
      const payments = await razorpay.orders.fetchPayments(order_id);
      const payment = payments.items.find(p => p.status === "captured");

      if (!payment) {
        return res.json({ success: true, paid: false });
      }

      // Compute the signature for verification
      const signature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(`${order_id}|${payment.id}`)
        .digest("hex");

      res.json({
        success: true,
        paid: true,
        payment_id: payment.id,
        signature,
      });
    } else {
      res.json({ success: true, paid: false });
    }
  } catch (err) {
    console.error("check-latest error:", err);
    res.status(500).json({ success: false, message: "Could not check payment status." });
  }
});

// ── GET /payment-page ─────────────────────────────────────────
// This is a hosted payment page that opens in the Office dialog.
// It loads Razorpay's checkout and sends the result back to the add-in.
router.get("/payment-page", (req, res) => {
  const { order_id, amount, key, email } = req.query;

  if (!order_id || !amount || !key) {
    return res.status(400).send("Invalid payment parameters.");
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>SpellCheck Pro — Payment</title>
      <!-- Razorpay checkout.js -->
      <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
      <style>
        body {
          font-family: -apple-system, Arial, sans-serif;
          background: #f4f6f9;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 28px 24px;
          text-align: center;
          max-width: 320px;
          width: 100%;
          box-shadow: 0 4px 16px rgba(0,0,0,0.1);
        }
        h2 { color: #0d1117; margin-bottom: 8px; font-size: 18px; }
        p  { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
        .amount { font-size: 32px; font-weight: 800; color: #1a6b55; margin: 12px 0; }
        .btn {
          background: #1a6b55;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
        }
        .btn:hover { background: #155847; }
        .spinner { display: none; }
        .upi { font-size: 11px; color: #9ca3af; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>✦ SpellCheck Pro</h2>
        <p>Complete your subscription payment</p>
        <div class="amount">₹${Math.floor(parseInt(amount) / 100)}</div>
        <button class="btn" id="pay-btn" onclick="openPayment()">
          Pay via UPI →
        </button>
        <p class="upi">Powered by Razorpay · Secure · Encrypted</p>
      </div>

      <script>
        function openPayment() {
          document.getElementById('pay-btn').textContent = 'Opening payment…';

          const options = {
            key:          '${escapeHtml(key)}',
            amount:       '${parseInt(amount)}',
            currency:     'INR',
            order_id:     '${escapeHtml(order_id)}',
            name:         'SpellCheck Pro',
            description:  'Excel Add-in Subscription',
            prefill: {
              email: '${escapeHtml(email || "")}',
            },
            theme: { color: '#1a6b55' },

            handler: function(response) {
              // Payment succeeded! Send result back to the Excel add-in
              Office.context.ui.messageParent(JSON.stringify({
                status:     'success',
                payment_id: response.razorpay_payment_id,
                order_id:   response.razorpay_order_id,
                signature:  response.razorpay_signature,
              }));
            },

            modal: {
              ondismiss: function() {
                // User closed without paying
                Office.context.ui.messageParent(JSON.stringify({
                  status: 'dismissed',
                }));
              }
            }
          };

          const rzp = new Razorpay(options);
          rzp.open();
        }

        // Office.js needed for messageParent
        // Try to load it; if not available (testing in browser), show alert
        try {
          Office.onReady(() => {
            // Auto-open payment after a short delay
            setTimeout(openPayment, 800);
          });
        } catch(e) {
          // Testing outside Office — just show the button
        }
      </script>

      <!-- Office.js for messageParent -->
      <script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
    </body>
    </html>
  `);
});

// Simple HTML escaping to prevent XSS in the payment page
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = router;
