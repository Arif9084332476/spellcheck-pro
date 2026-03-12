/*
  ============================================================
  server.js — The Main Backend Server for SpellCheck Pro
  ============================================================
  This is the entry point for the Node.js backend.
  When you run "node server.js", this file starts the server.

  WHAT THIS FILE DOES:
    1. Loads environment variables from .env file
    2. Creates an Express web server
    3. Adds security middleware (helmet, cors, rate limiting)
    4. Connects all the routes (auth, spell check, payment)
    5. Starts listening for requests on port 3000

  WHAT IS EXPRESS?
    Express is a popular Node.js framework that makes it easy
    to build web servers. It handles incoming HTTP requests
    and routes them to the right handler function.

  WHAT IS MIDDLEWARE?
    Middleware are functions that run BEFORE your route
    handler. They're like a pipeline: request → middleware 1
    → middleware 2 → your route → response.
  ============================================================
*/

// Load environment variables from .env file FIRST
// (before any other imports that might use them)
require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");
const path     = require("path");

// Import our route handlers
const authRoutes    = require("./routes/auth");
const spellRoutes   = require("./routes/spell");
const paymentRoutes = require("./routes/payment");

// Import rate limiters
const { generalLimiter } = require("./middleware/rateLimiter");

// ── Create the Express app ────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security Middleware ───────────────────────────────────────

// Helmet: Sets security HTTP headers automatically
// Protects against common attacks like XSS, clickjacking, etc.
app.use(helmet({
  // Allow loading resources from Microsoft's Office.js CDN
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://appsforoffice.microsoft.com",
        "https://checkout.razorpay.com",
        "'unsafe-inline'", // Needed for Razorpay
      ],
      frameSrc: ["https://api.razorpay.com"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for Office.js
}));

// CORS: Allows our Excel frontend to talk to this backend
// CORS = Cross-Origin Resource Sharing
// By default, browsers block requests from different URLs.
// We need to explicitly allow our frontend URL.
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "https://appsforoffice.microsoft.com",  // Microsoft's Office.js host
      "null",  // Allows requests from file:// during local testing
    ];

    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // During development, you might want to allow all origins:
      // callback(null, true);
      callback(new Error(`CORS policy: Origin ${origin} not allowed.`));
    }
  },
  methods:     ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// Body parsing: Allows Express to read JSON request bodies
// Without this, req.body would be undefined
app.use(express.json({ limit: "1mb" }));               // Parse JSON
app.use(express.urlencoded({ extended: true }));        // Parse form data

// Logging: Shows request logs in the terminal
// "dev" format: "GET /api/usage 200 23ms - 145 bytes"
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// General rate limiting: Applied to ALL routes as baseline protection
app.use(generalLimiter);

// ── Health Check Route ────────────────────────────────────────
// This is used by Render.com to check if your server is running.
// If it returns 200, the server is healthy.
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "SpellCheck Pro API",
    version: "1.0.0",
  });
});

// ── Mount Route Handlers ──────────────────────────────────────
// All auth routes are at /api/auth/...
app.use("/api/auth", authRoutes);

// All spell check and usage routes are at /api/...
app.use("/api", spellRoutes);

// Payment routes (some are at /api/payment/..., /payment-page)
app.use("/api/payment", paymentRoutes);
app.use("/",            paymentRoutes); // For /payment-page route

// ── 404 Handler ───────────────────────────────────────────────
// If no route matched, return a 404 error
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

// ── Global Error Handler ──────────────────────────────────────
// If any route throws an error, this catches it
// (Express calls this when you pass an error to next(err))
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  // Don't expose internal error details in production
  const message = process.env.NODE_ENV === "production"
    ? "An internal server error occurred."
    : err.message;

  res.status(err.status || 500).json({
    success: false,
    message,
  });
});

// ── Start the Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║      SpellCheck Pro — Backend API        ║
╠══════════════════════════════════════════╣
║  ✓ Server running on port ${PORT}           ║
║  ✓ Environment: ${(process.env.NODE_ENV || "development").padEnd(24)}║
║  ✓ Supabase connected                    ║
╚══════════════════════════════════════════╝

Routes available:
  GET  /health                     ← Health check
  POST /api/auth/send-otp          ← Send login OTP
  POST /api/auth/verify-otp        ← Verify OTP + login
  GET  /api/auth/verify            ← Validate token
  POST /api/spell-check            ← Check spelling
  GET  /api/usage                  ← Get usage stats
  POST /api/usage/increment        ← Record correction
  POST /api/payment/create-order   ← Create Razorpay order
  POST /api/payment/verify         ← Verify payment
  GET  /payment-page               ← Hosted payment page
  `);
});

// Export for testing (optional)
module.exports = app;
