/*
  ============================================================
  TASKPANE.JS — The Brain of SpellCheck Pro
  ============================================================
  This file handles ALL the logic:
    1. Waiting for Office/Excel to be ready
    2. Login with email + OTP
    3. Reading Excel cell data
    4. Sending text to our backend for spell checking
    5. Displaying errors in the task pane
    6. Correcting cells in Excel
    7. Subscription/payment flow

  HOW IT WORKS (simplified):
    - Office.onReady() → Excel is loaded, we can start
    - User logs in → we store a session token
    - User clicks "Check Spelling" → we read cells → send to API
    - API returns errors → we show them in the list
    - User clicks "Correct" → we write back to the cell

  IMPORTANT: Replace BACKEND_URL with your actual deployed URL!
  ============================================================
*/

"use strict";

// ── Configuration ────────────────────────────────────────────
// REPLACE THIS with your actual Render backend URL after deploying
const BACKEND_URL = "https://spellcheck-api-phz7.onrender.com";

// Free corrections limit before paywall
const FREE_LIMIT = 20;

// ── App State ────────────────────────────────────────────────
// Think of "state" as the app's memory. All important data is here.
let state = {
  token: null,           // Login session token (stored in localStorage)
  userEmail: null,       // Logged-in user's email
  usageCount: 0,         // How many corrections used so far
  isSubscribed: false,   // Is the user a paying subscriber?
  subExpiry: null,       // Subscription expiry date string

  scanMode: "selection", // "selection" or "sheet"
  errors: [],            // Array of spelling errors found
  pendingOrderId: null,  // Razorpay order ID waiting for payment
  pendingDays: 1,        // Days chosen for subscription

  // Map from error index to Excel cell reference + original text
  cellMap: [],           // [{ cellAddress: "A2", fullText: "Chiken curry", wordIndex: 0 }]
};

// ── Wait for Office/Excel to Load ────────────────────────────
// This is the entry point. Office.onReady() is called by Microsoft
// once Excel is ready to accept JavaScript commands.
Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    // Excel is ready! Now initialize our app.
    init();
  }
});

// ── Initialize the App ───────────────────────────────────────
async function init() {
  // Check if user is already logged in (token saved from previous session)
  const savedToken = localStorage.getItem("scp_token");
  const savedEmail = localStorage.getItem("scp_email");

  if (savedToken && savedEmail) {
    // Try to validate the saved token with our backend
    const valid = await verifyToken(savedToken);
    if (valid) {
      state.token = savedToken;
      state.userEmail = savedEmail;
      showScreen("screen-main");
      await loadUserStatus();
      return;
    }
  }

  // No valid session — show login screen
  showScreen("screen-login");
  setupLoginHandlers();
}

// ═══════════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ═══════════════════════════════════════════════════════════

// Shows one screen and hides all others
// screenId can be: "screen-login", "screen-main", "screen-upgrade"
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => {
    s.classList.add("hidden");
    s.classList.remove("active");
  });
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove("hidden");
    target.classList.add("active");
  }

  // Set up button handlers depending on which screen just appeared
  if (screenId === "screen-main")    setupMainHandlers();
  if (screenId === "screen-upgrade") setupUpgradeHandlers();
}

// ═══════════════════════════════════════════════════════════
//  LOGIN / AUTHENTICATION
// ═══════════════════════════════════════════════════════════

function setupLoginHandlers() {
  // "Send OTP" button
  document.getElementById("btn-send-otp").addEventListener("click", handleSendOTP);

  // Allow pressing Enter in email field
  document.getElementById("input-email").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSendOTP();
  });

  // "Verify OTP" button
  document.getElementById("btn-verify-otp").addEventListener("click", handleVerifyOTP);

  // "Back to email" button
  document.getElementById("btn-back-email").addEventListener("click", () => {
    showLoginStep("email");
    hideLoginError();
  });

  // OTP digit boxes: auto-advance to next box as user types
  setupOTPInputs();
}

function setupOTPInputs() {
  const digits = document.querySelectorAll(".otp-digit");
  digits.forEach((input, index) => {
    input.addEventListener("input", (e) => {
      // Only allow single digit
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      // Auto-move to next box
      if (input.value && index < digits.length - 1) {
        digits[index + 1].focus();
      }
    });

    input.addEventListener("keydown", (e) => {
      // Backspace: go back to previous box
      if (e.key === "Backspace" && !input.value && index > 0) {
        digits[index - 1].focus();
      }
      // Enter: trigger verify
      if (e.key === "Enter") handleVerifyOTP();
    });
  });
}

// Gets the 6 OTP digits as a single string like "482931"
function getOTPValue() {
  return Array.from(document.querySelectorAll(".otp-digit"))
    .map(d => d.value)
    .join("");
}

async function handleSendOTP() {
  const email = document.getElementById("input-email").value.trim();
  if (!email || !email.includes("@")) {
    showLoginError("Please enter a valid email address.");
    return;
  }

  setBtnLoading("btn-send-otp", true);
  hideLoginError();

  try {
    const res = await apiPost("/api/auth/send-otp", { email });
    if (res.success) {
      state.pendingEmail = email;
      document.getElementById("otp-sent-label").textContent =
        `We sent a code to ${email}`;
      showLoginStep("otp");
    } else {
      showLoginError(res.message || "Failed to send OTP. Please try again.");
    }
  } catch (err) {
    showLoginError("Cannot reach server. Check your internet connection.");
  } finally {
    setBtnLoading("btn-send-otp", false);
  }
}

async function handleVerifyOTP() {
  const otp = getOTPValue();
  if (otp.length !== 6) {
    showLoginError("Please enter all 6 digits of your OTP.");
    return;
  }

  setBtnLoading("btn-verify-otp", true);
  hideLoginError();

  try {
    const res = await apiPost("/api/auth/verify-otp", {
      email: state.pendingEmail,
      otp,
    });

    if (res.success) {
      // Save token so user stays logged in next time
      state.token = res.token;
      state.userEmail = state.pendingEmail;
      localStorage.setItem("scp_token", res.token);
      localStorage.setItem("scp_email", state.pendingEmail);

      showScreen("screen-main");
      await loadUserStatus();
    } else {
      showLoginError(res.message || "Incorrect OTP. Please try again.");
    }
  } catch (err) {
    showLoginError("Cannot reach server. Check your internet connection.");
  } finally {
    setBtnLoading("btn-verify-otp", false);
  }
}

function showLoginStep(step) {
  document.getElementById("login-step-email").classList.toggle("hidden", step !== "email");
  document.getElementById("login-step-otp").classList.toggle("hidden",  step !== "otp");
}

function showLoginError(msg) {
  const el = document.getElementById("login-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideLoginError() {
  document.getElementById("login-error").classList.add("hidden");
}

// Ping backend to check if a saved token is still valid
async function verifyToken(token) {
  try {
    const res = await apiGet("/api/auth/verify", token);
    return res.valid === true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  MAIN SCREEN SETUP
// ═══════════════════════════════════════════════════════════

function setupMainHandlers() {
  // Mode toggle buttons (Selected Cells vs Entire Sheet)
  document.getElementById("btn-mode-selection").addEventListener("click", () => setMode("selection"));
  document.getElementById("btn-mode-sheet").addEventListener("click",     () => setMode("sheet"));

  // Main scan button
  document.getElementById("btn-start-scan").addEventListener("click", handleStartScan);

  // Bulk action buttons
  document.getElementById("btn-correct-all").addEventListener("click", handleCorrectAll);
  document.getElementById("btn-ignore-all").addEventListener("click",  handleIgnoreAll);

  // Retry button in error state
  document.getElementById("btn-retry")?.addEventListener("click", handleStartScan);

  // Logout button
  document.getElementById("btn-logout").addEventListener("click", handleLogout);

  // Upgrade button in subscription banner
  document.getElementById("btn-go-upgrade")?.addEventListener("click", () => showScreen("screen-upgrade"));

  // Footer upgrade link
  document.getElementById("footer-manage-sub")?.addEventListener("click", (e) => {
    e.preventDefault();
    showScreen("screen-upgrade");
  });
}

function setMode(mode) {
  state.scanMode = mode;
  document.querySelectorAll(".toggle-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

async function loadUserStatus() {
  // Show user email in footer
  document.getElementById("user-email-display").textContent = state.userEmail || "";

  try {
    const res = await apiGet("/api/usage", state.token);
    state.usageCount    = res.corrections_used  || 0;
    state.isSubscribed  = res.is_subscribed     || false;
    state.subExpiry     = res.sub_expiry        || null;

    updateUsageBadge();
    updateSubscriptionUI();
  } catch (err) {
    console.warn("Could not load user status:", err);
  }
}

function updateUsageBadge() {
  const badge = document.getElementById("usage-badge");
  const count = document.getElementById("usage-count");
  count.textContent = state.usageCount;

  if (state.isSubscribed) {
    badge.textContent = "Pro ✓";
    badge.classList.remove("at-limit");
    badge.style.background = "rgba(78, 204, 163, 0.2)";
    badge.style.color = "#4ecca3";
  } else {
    badge.innerHTML = `<span id="usage-count">${state.usageCount}</span>/20 free`;
    badge.classList.toggle("at-limit", state.usageCount >= FREE_LIMIT);
  }
}

function updateSubscriptionUI() {
  const banner = document.getElementById("subscription-banner");
  const proBadge = document.getElementById("pro-badge");

  if (state.isSubscribed && state.subExpiry) {
    // Show "Pro Active" bar, hide paywall banner
    document.getElementById("sub-expiry").textContent = state.subExpiry;
    proBadge.classList.remove("hidden");
    banner.classList.add("hidden");
  } else if (!state.isSubscribed && state.usageCount >= FREE_LIMIT) {
    // Show paywall banner
    banner.classList.remove("hidden");
    proBadge.classList.add("hidden");
  } else {
    // Within free limit, no banners needed
    banner.classList.add("hidden");
    proBadge.classList.add("hidden");
  }
}

// ═══════════════════════════════════════════════════════════
//  CORE SPELL CHECK LOGIC
// ═══════════════════════════════════════════════════════════

async function handleStartScan() {
  // Check if user can still use the app (free limit or subscription)
  if (!state.isSubscribed && state.usageCount >= FREE_LIMIT) {
    showScreen("screen-upgrade");
    return;
  }

  showResultsState("scanning");
  document.getElementById("btn-start-scan").classList.add("scanning");
  document.getElementById("scan-btn-text").textContent = "Scanning…";

  try {
    // Step 1: Read cell data from Excel
    const cellData = await readExcelCells();

    if (!cellData || cellData.length === 0) {
      showResultsState("idle");
      showAPIError("No text found in the selected area.");
      document.getElementById("btn-start-scan").classList.remove("scanning");
      document.getElementById("scan-btn-text").textContent = "Check Spelling";
      return;
    }

    // Step 2: Send cell data to our backend API for spell checking
    const res = await apiPost("/api/spell-check", {
      cells: cellData,
      mode: state.scanMode,
    }, state.token);

    if (!res.success) {
      // Backend rejected — could be auth issue or server error
      if (res.code === "LIMIT_REACHED") {
        state.usageCount = FREE_LIMIT;
        updateUsageBadge();
        updateSubscriptionUI();
        showScreen("screen-upgrade");
        return;
      }
      throw new Error(res.message || "Spell check failed.");
    }

    // Step 3: Display the results
    state.errors = res.errors || [];
    state.cellMap = res.cellMap || [];
    renderErrors(state.errors);

  } catch (err) {
    showResultsState("api-error");
    document.getElementById("api-error-message").textContent =
      err.message || "Something went wrong. Please try again.";
  } finally {
    document.getElementById("btn-start-scan").classList.remove("scanning");
    document.getElementById("scan-btn-text").textContent = "Check Spelling";
  }
}

// ── READ EXCEL CELLS ─────────────────────────────────────────
// This is where we use the Excel JavaScript API (Office.js)
// to read what's in the spreadsheet.
async function readExcelCells() {
  return new Promise((resolve, reject) => {
    // Excel.run() is how you start any Excel operation
    Excel.run(async (context) => {
      try {
        let range;

        if (state.scanMode === "selection") {
          // Get whatever cells the user currently has selected
          range = context.workbook.getSelectedRange();
        } else {
          // Get the entire used area of the active sheet
          const sheet = context.workbook.worksheets.getActiveWorksheet();
          range = sheet.getUsedRange();
        }

        // Tell Excel what properties we want to read
        // "values" = the cell contents
        // "address" = the cell references like "A1", "B2", etc.
        range.load(["values", "address", "rowCount", "columnCount"]);

        // Actually execute the Excel read command
        await context.sync();

        // Now process what we got
        const cellData = [];
        const values = range.values;  // 2D array: rows of columns
        const baseAddress = range.address; // e.g. "Sheet1!A1:C5"

        // Extract just the grid part (remove "Sheet1!" prefix)
        const gridStart = baseAddress.includes("!") ?
          baseAddress.split("!")[1].split(":")[0] : "A1";

        // Parse starting row and column from gridStart (e.g., "B3" → row 3, col B)
        const startCol = columnLetterToIndex(gridStart.replace(/\d/g, ""));
        const startRow = parseInt(gridStart.replace(/\D/g, ""), 10);

        // Go through every cell in the range
        for (let r = 0; r < values.length; r++) {
          for (let c = 0; c < values[r].length; c++) {
            const cellValue = values[r][c];

            // Only process cells that have text (not numbers, not empty)
            if (typeof cellValue === "string" && cellValue.trim().length > 0) {
              const colLetter = indexToColumnLetter(startCol + c);
              const rowNum    = startRow + r;
              const address   = `${colLetter}${rowNum}`;

              cellData.push({
                address,
                text: cellValue.trim(),
              });
            }
          }
        }

        resolve(cellData);

      } catch (excelError) {
        reject(new Error("Could not read Excel cells: " + excelError.message));
      }
    }).catch(reject);
  });
}

// ── CORRECT A SINGLE CELL IN EXCEL ───────────────────────────
async function correctCell(address, newText) {
  return new Promise((resolve, reject) => {
    Excel.run(async (context) => {
      try {
        // Get a reference to the specific cell by its address (e.g., "A2")
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const cell  = sheet.getRange(address);

        // Write the corrected text to the cell
        cell.values = [[newText]];

        // Execute the write command
        await context.sync();
        resolve(true);
      } catch (err) {
        reject(new Error("Could not update cell " + address + ": " + err.message));
      }
    }).catch(reject);
  });
}

// ── RENDER ERROR CARDS ────────────────────────────────────────
function renderErrors(errors) {
  if (!errors || errors.length === 0) {
    showResultsState("success");
    return;
  }

  showResultsState("errors");
  const list = document.getElementById("error-list");
  list.innerHTML = ""; // Clear previous results

  // Update the count label
  document.getElementById("error-count-label").textContent =
    `${errors.length} issue${errors.length !== 1 ? "s" : ""} found`;

  // Create one error card for each mistake
  errors.forEach((error, index) => {
    const card = createErrorCard(error, index);
    list.appendChild(card);
  });
}

// Creates an HTML card element for one spelling error
function createErrorCard(error, index) {
  const card = document.createElement("div");
  card.className = "error-card";
  card.dataset.index = index;

  // Build the suggestions dropdown
  const options = (error.suggestions || [error.correction])
    .slice(0, 5) // Max 5 suggestions
    .map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
    .join("");

  card.innerHTML = `
    <div class="error-cell-ref">${escapeHtml(error.address)}</div>
    <div class="error-body">
      <div class="error-original">${escapeHtml(error.original)}</div>
      <div class="error-arrow">→</div>
      <div class="error-suggestion-wrap">
        <select class="suggestion-select" data-index="${index}">
          ${options}
        </select>
      </div>
    </div>
    <div class="error-actions">
      <button class="btn btn-xs btn-correct" data-index="${index}">✓ Correct</button>
      <button class="btn btn-xs btn-ignore"  data-index="${index}">✗ Ignore</button>
    </div>
  `;

  // Attach event handlers to the buttons inside this card
  card.querySelector(".btn-correct").addEventListener("click", () => handleCorrectSingle(index));
  card.querySelector(".btn-ignore").addEventListener("click",  () => handleIgnoreSingle(index));

  return card;
}

// ── ACTION HANDLERS ───────────────────────────────────────────

async function handleCorrectSingle(index) {
  const error = state.errors[index];
  if (!error || error.ignored || error.corrected) return;

  // Get the chosen suggestion from the dropdown
  const select   = document.querySelector(`.suggestion-select[data-index="${index}"]`);
  const newWord  = select ? select.value : error.correction;

  // Build the corrected full cell text
  // (Replace just the misspelled word in the full cell text)
  const correctedText = error.fullText.replace(error.original, newWord);

  try {
    // Write to Excel
    await correctCell(error.address, correctedText);

    // Mark this error as corrected in our state
    state.errors[index].corrected = true;
    state.errors[index].correctedTo = newWord;

    // Visually mark the card as done
    const card = document.querySelector(`.error-card[data-index="${index}"]`);
    if (card) card.classList.add("corrected");

    // Track the correction count (for free limit)
    state.usageCount++;
    updateUsageBadge();

    // Tell backend to record this correction
    await apiPost("/api/usage/increment", {}, state.token).catch(() => {});

    // Check if limit reached after this correction
    if (!state.isSubscribed && state.usageCount >= FREE_LIMIT) {
      updateSubscriptionUI();
    }

  } catch (err) {
    alert("Could not update cell: " + err.message);
  }
}

async function handleCorrectAll() {
  if (!state.isSubscribed && state.usageCount >= FREE_LIMIT) {
    showScreen("screen-upgrade");
    return;
  }

  let correctedCount = 0;

  for (let i = 0; i < state.errors.length; i++) {
    const error = state.errors[i];
    if (error.corrected || error.ignored) continue;

    const select = document.querySelector(`.suggestion-select[data-index="${i}"]`);
    const newWord = select ? select.value : error.correction;
    const correctedText = error.fullText.replace(error.original, newWord);

    try {
      await correctCell(error.address, correctedText);
      state.errors[i].corrected = true;
      correctedCount++;

      const card = document.querySelector(`.error-card[data-index="${i}"]`);
      if (card) card.classList.add("corrected");

      // Small delay between corrections to not overwhelm Excel
      await sleep(100);

    } catch (err) {
      console.warn(`Failed to correct ${error.address}:`, err);
    }
  }

  // Update usage count on backend
  state.usageCount += correctedCount;
  updateUsageBadge();

  try {
    await apiPost("/api/usage/increment", { count: correctedCount }, state.token);
  } catch {}

  if (!state.isSubscribed && state.usageCount >= FREE_LIMIT) {
    updateSubscriptionUI();
  }
}

function handleIgnoreSingle(index) {
  state.errors[index].ignored = true;
  const card = document.querySelector(`.error-card[data-index="${index}"]`);
  if (card) card.classList.add("ignored");
}

function handleIgnoreAll() {
  state.errors.forEach((_, i) => {
    state.errors[i].ignored = true;
    const card = document.querySelector(`.error-card[data-index="${i}"]`);
    if (card) card.classList.add("ignored");
  });
}

function handleLogout() {
  localStorage.removeItem("scp_token");
  localStorage.removeItem("scp_email");
  state.token = null;
  state.userEmail = null;
  showScreen("screen-login");
  setupLoginHandlers();
}

// ═══════════════════════════════════════════════════════════
//  UPGRADE / PAYMENT SCREEN
// ═══════════════════════════════════════════════════════════

function setupUpgradeHandlers() {
  document.getElementById("btn-back-main").addEventListener("click", () => showScreen("screen-main"));
  document.getElementById("btn-pay-now").addEventListener("click", handlePayNow);
  document.getElementById("btn-verify-payment")?.addEventListener("click", handleVerifyPayment);
}

async function handlePayNow() {
  // Get selected duration
  const durationEl = document.querySelector('input[name="duration"]:checked');
  const days = durationEl ? parseInt(durationEl.value, 10) : 1;
  const amount = days; // ₹1 per day

  state.pendingDays = days;

  setBtnLoading("btn-pay-now", true);
  document.getElementById("upgrade-error")?.classList.add("hidden");

  try {
    // Ask backend to create a Razorpay order
    const res = await apiPost("/api/payment/create-order", {
      amount_paise: amount * 100, // Razorpay uses paise (1 rupee = 100 paise)
      days,
    }, state.token);

    if (!res.success) throw new Error(res.message || "Could not create payment order.");

    state.pendingOrderId = res.order_id;

    // Open Razorpay payment UI
    openRazorpay({
      order_id: res.order_id,
      amount: res.amount,
      key: res.razorpay_key,
      email: state.userEmail,
    });

  } catch (err) {
    const errBox = document.getElementById("upgrade-error");
    errBox.textContent = err.message || "Payment failed. Please try again.";
    errBox.classList.remove("hidden");
  } finally {
    setBtnLoading("btn-pay-now", false);
  }
}

// Opens the Razorpay pop-up UPI payment window
function openRazorpay({ order_id, amount, key, email }) {
  // Razorpay SDK is loaded from CDN — it must be in taskpane.html
  // But since this is an Office add-in, we open payment in a dialog
  const paymentUrl = `${BACKEND_URL}/payment-page?` +
    `order_id=${order_id}&amount=${amount}&key=${key}&email=${encodeURIComponent(email)}`;

  // Open in a dialog window (Office dialog API)
  Office.context.ui.displayDialogAsync(paymentUrl, {
    height: 70,
    width: 50,
    promptBeforeOpen: false,
  }, (result) => {
    if (result.status === Office.AsyncResultStatus.Failed) {
      // Fallback: show manual verify UI if dialog blocked
      document.getElementById("payment-verify-section").classList.remove("hidden");
    } else {
      const dialog = result.value;

      // Listen for payment completion message from the payment page
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, (args) => {
        dialog.close();
        const msg = JSON.parse(args.message);
        if (msg.status === "success") {
          handlePaymentSuccess(msg.payment_id, msg.order_id, msg.signature);
        } else {
          document.getElementById("payment-verify-section").classList.remove("hidden");
        }
      });

      dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
        // User closed dialog without paying — show manual verify button
        document.getElementById("payment-verify-section").classList.remove("hidden");
      });
    }
  });
}

async function handlePaymentSuccess(payment_id, order_id, signature) {
  try {
    const res = await apiPost("/api/payment/verify", {
      payment_id,
      order_id: order_id || state.pendingOrderId,
      signature,
      days: state.pendingDays,
    }, state.token);

    if (res.success) {
      state.isSubscribed = true;
      state.subExpiry = res.expiry_date;
      state.usageCount = 0; // Reset usage count on subscribe

      updateUsageBadge();
      updateSubscriptionUI();
      showScreen("screen-main");

      // Show success notification
      showToast("✓ Subscription activated! Enjoy unlimited corrections.");
    } else {
      throw new Error(res.message || "Payment verification failed.");
    }
  } catch (err) {
    const errBox = document.getElementById("upgrade-error");
    errBox.textContent = "Payment verification failed: " + err.message;
    errBox.classList.remove("hidden");
  }
}

async function handleVerifyPayment() {
  // Manual verification: user clicked "I've paid" button
  try {
    const res = await apiPost("/api/payment/check-latest", {
      order_id: state.pendingOrderId,
      days: state.pendingDays,
    }, state.token);

    if (res.success && res.paid) {
      await handlePaymentSuccess(res.payment_id, state.pendingOrderId, res.signature);
    } else {
      alert("Payment not yet confirmed. Please wait a moment and try again.");
    }
  } catch {
    alert("Could not verify payment. Please contact support.");
  }
}

// ═══════════════════════════════════════════════════════════
//  UI HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

// Shows one of the states inside the results panel
// state can be: "idle", "scanning", "success", "errors", "api-error"
function showResultsState(stateName) {
  const states = ["idle", "scanning", "success", "errors", "api-error"];
  states.forEach(s => {
    const el = document.getElementById(`state-${s}`);
    if (el) el.classList.toggle("hidden", s !== stateName);
  });
}

// Shows an error in the api-error state box
function showAPIError(message) {
  showResultsState("api-error");
  const el = document.getElementById("api-error-message");
  if (el) el.textContent = message;
}

// Switches a button to "loading" state (shows spinner text, disables button)
function setBtnLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  const textEl    = btn.querySelector(".btn-text");
  const loadingEl = btn.querySelector(".btn-loading");
  if (textEl)    textEl.classList.toggle("hidden",  loading);
  if (loadingEl) loadingEl.classList.toggle("hidden", !loading);
}

// Shows a temporary toast message at the top
function showToast(message) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    background: #0d1117; color: white; padding: 8px 16px;
    border-radius: 20px; font-size: 12px; font-weight: 600;
    z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    animation: toast-in 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Prevents XSS: escapes special HTML characters in user content
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Wait for N milliseconds (used to pace corrections)
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════
//  API COMMUNICATION HELPERS
// ═══════════════════════════════════════════════════════════

// Makes a POST request to our backend
async function apiPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(BACKEND_URL + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok && response.status !== 400 && response.status !== 402) {
    throw new Error(`Server error: ${response.status}`);
  }

  return response.json();
}

// Makes a GET request to our backend
async function apiGet(path, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(BACKEND_URL + path, {
    method: "GET",
    headers,
  });

  if (!response.ok && response.status !== 401) {
    throw new Error(`Server error: ${response.status}`);
  }

  return response.json();
}

// ═══════════════════════════════════════════════════════════
//  EXCEL CELL ADDRESS HELPERS
// ═══════════════════════════════════════════════════════════

// Converts a column letter like "A" to an index like 1
// "A" → 1, "B" → 2, "Z" → 26, "AA" → 27
function columnLetterToIndex(letter) {
  let result = 0;
  const upper = letter.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result;
}

// Converts a column index like 1 to a letter like "A"
// 1 → "A", 27 → "AA", 28 → "AB"
function indexToColumnLetter(n) {
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
