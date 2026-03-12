require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");
const path     = require("path");

const authRoutes    = require("./routes/auth");
const spellRoutes   = require("./routes/spell");
const paymentRoutes = require("./routes/payment");

const { generalLimiter } = require("./middleware/rateLimiter");

const app  = express();
const PORT = process.env.PORT || 3000;

/* ============================================================
   SECURITY HEADERS
============================================================ */

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

/* ============================================================
   CORS FIX (IMPORTANT)
============================================================ */

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://voluble-kheer-16faec.netlify.app",
  "http://localhost:3000",
  "https://appsforoffice.microsoft.com",
  "null"
];

app.use(cors({
  origin: function(origin, callback) {

    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(null, true); // allow during development
    }

  },
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: true
}));

app.options("*", cors());

/* ============================================================
   BODY PARSER
============================================================ */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* ============================================================
   LOGGER
============================================================ */

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

/* ============================================================
   RATE LIMITER
============================================================ */

app.use(generalLimiter);

/* ============================================================
   HEALTH CHECK
============================================================ */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "SpellCheck Pro API",
    version: "1.0.0"
  });
});

/* ============================================================
   ROUTES
============================================================ */

app.use("/api/auth", authRoutes);
app.use("/api", spellRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/", paymentRoutes);

/* ============================================================
   404 HANDLER
============================================================ */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`
  });
});

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use((err, req, res, next) => {

  console.error("Unhandled error:", err);

  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message;

  res.status(err.status || 500).json({
    success: false,
    message
  });

});

/* ============================================================
   START SERVER
============================================================ */

app.listen(PORT, () => {

console.log(`
╔══════════════════════════════════════════╗
║      SpellCheck Pro — Backend API        ║
╠══════════════════════════════════════════╣
║  ✓ Server running on port ${PORT}           ║
║  ✓ Environment: ${process.env.NODE_ENV || "development"}        
║  ✓ Supabase connected                    ║
╚══════════════════════════════════════════╝
`);

});

module.exports = app;
