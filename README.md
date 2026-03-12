# ✦ SpellCheck Pro — Excel Add-in SaaS
### Complete Setup Guide (Zero to Deployed)

---

## 📁 FOLDER STRUCTURE (What every file does)

```
spell-checker-addin/
│
├── frontend/                     ← All Excel Add-in files (deployed to Vercel)
│   ├── manifest.xml              ← Add-in's identity card (tells Excel what this is)
│   ├── taskpane.html             ← The UI shown in Excel's right sidebar
│   ├── taskpane.js               ← All the logic (buttons, API calls, Excel reading)
│   ├── styles.css                ← Visual design and colors
│   ├── commands.html             ← Required for ribbon button support
│   ├── vercel.json               ← Deployment config for Vercel hosting
│   └── assets/
│       ├── icon-16.png           ← Add-in icon (16x16 pixels)
│       ├── icon-32.png           ← Add-in icon (32x32 pixels)
│       ├── icon-64.png           ← Add-in icon (64x64 pixels)
│       └── icon-80.png           ← Add-in icon (80x80 pixels)
│
├── backend/                      ← Node.js API server (deployed to Render)
│   ├── server.js                 ← Main server entry point
│   ├── package.json              ← List of Node.js packages needed
│   ├── .env.example              ← Template for environment variables
│   ├── database-setup.sql        ← SQL to create database tables in Supabase
│   │
│   ├── routes/
│   │   ├── auth.js               ← Login, OTP sending, token verification
│   │   ├── spell.js              ← Spell check API + usage tracking
│   │   └── payment.js            ← Razorpay payment integration
│   │
│   ├── middleware/
│   │   ├── authenticate.js       ← Checks login tokens on protected routes
│   │   └── rateLimiter.js        ← Prevents spam/abuse
│   │
│   └── utils/
│       ├── customDictionary.js   ← Food words that should never be flagged
│       └── languageTool.js       ← Talks to LanguageTool spell check API
│
├── .gitignore                    ← Files Git should not track
└── README.md                     ← This file!
```

---

## 🛠️ STEP-BY-STEP SETUP INSTRUCTIONS

### STEP 1: Install Node.js on Your Computer

Node.js lets you run JavaScript outside of a browser (on your computer or server).

1. Go to: **https://nodejs.org**
2. Click the big green button that says **"LTS"** (recommended version)
3. Download and run the installer
4. Click Next → Next → Install (accept all defaults)
5. When done, open **Command Prompt** (Windows) or **Terminal** (Mac):
   - Windows: Press Win+R, type `cmd`, press Enter
   - Mac: Press Cmd+Space, type `terminal`, press Enter
6. Type this command and press Enter:
   ```
   node --version
   ```
   You should see something like: `v20.11.0`
   If you see a version number, Node.js is installed! ✓

---

### STEP 2: Download the Project Files

You have two options:

**Option A: Use Git (recommended)**
```bash
git clone https://github.com/YOUR-USERNAME/spell-checker-addin.git
cd spell-checker-addin
```

**Option B: Manual Download**
1. Download the ZIP file of this project
2. Extract it to a folder on your computer
3. Open Terminal/Command Prompt
4. Navigate to the folder:
   ```bash
   cd path/to/spell-checker-addin
   ```

---

### STEP 3: Set Up the Supabase Database (Free)

Supabase is a free online database service. It stores user accounts,
login codes, usage counts, and subscription records.

1. Go to: **https://supabase.com**
2. Click **"Start your project"** → Sign up with GitHub (free)
3. Click **"New Project"**:
   - **Name**: spellcheck-pro
   - **Database Password**: Create a strong password (save this!)
   - **Region**: Choose the closest region to India (Asia South East)
4. Wait 2 minutes for the project to be created
5. In the left sidebar, click **"SQL Editor"**
6. Click **"New query"**
7. Copy the ENTIRE contents of `backend/database-setup.sql`
8. Paste it into the SQL editor
9. Click **"Run"** (Ctrl+Enter)
10. You should see: "Success. No rows returned."

**Get your Supabase credentials:**
1. In left sidebar → **Settings** → **API**
2. Copy:
   - **Project URL** (looks like: https://xxxxx.supabase.co)
   - **service_role** key (under "Project API keys" → "service_role")
   
   ⚠️ IMPORTANT: Use the `service_role` key, NOT the `anon` key

---

### STEP 4: Set Up Email for OTP (Free — Gmail)

We use Gmail to send login codes to users.

1. Open your **Google Account settings**: https://myaccount.google.com
2. Click **Security** in the left menu
3. Scroll to **"How you sign in to Google"**
4. Enable **2-Step Verification** (if not already on)
5. After enabling 2FA, go back to Security
6. Search for **"App passwords"** (it appears after enabling 2FA)
7. Click it → Select app: **Mail** → Select device: **Other**
8. Type: `SpellCheck Pro`
9. Click **Generate**
10. Copy the **16-character password** shown (looks like: `abcd efgh ijkl mnop`)
    - Remove the spaces: `abcdefghijklmnop`
    - This is your `EMAIL_PASS` — save it!

---

### STEP 5: Set Up Razorpay (Free Account)

Razorpay processes UPI payments from your customers.

1. Go to: **https://razorpay.com**
2. Click **"Sign Up"** → Create an account
3. Complete business verification (required for live payments):
   - Business type: Individual / Proprietorship
   - PAN card details
   - Bank account details
4. While your account is being verified, you can use **test mode**:
   - In Razorpay dashboard → Left menu → **Settings** → **API Keys**
   - Click **"Generate Test Key"**
   - Copy:
     - **Key ID** (starts with `rzp_test_`)
     - **Key Secret** (a long random string)
5. For live payments (after verification):
   - Switch to **Live mode** (toggle at top of dashboard)
   - Generate **Live Keys** instead

---

### STEP 6: Install Backend Dependencies

In your Terminal, navigate to the backend folder and install packages:

```bash
cd backend
npm install
```

This will download all the packages listed in `package.json`.
It may take 1-2 minutes. When done, you'll see a `node_modules` folder.

---

### STEP 7: Configure Environment Variables

1. Inside the `backend` folder, make a copy of `.env.example`
2. Rename the copy to `.env` (just `.env`, no other word)
3. Open `.env` in a text editor (Notepad, VS Code, etc.)
4. Fill in every value:

```bash
# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5500  # Change after deploying frontend

# JWT (generate at: https://generate-secret.vercel.app/32)
JWT_SECRET=paste-a-long-random-string-here-minimum-32-characters

# Supabase (from Step 3)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Gmail (from Step 4)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASS=abcdefghijklmnop
EMAIL_FROM=SpellCheck Pro <your-gmail@gmail.com>

# Razorpay (from Step 5)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# LanguageTool (no key needed for free tier)
LANGUAGE_TOOL_URL=https://api.languagetool.org/v2/check

# Rate limiting
RATE_LIMIT_MAX=100
```

5. Save the file

---

### STEP 8: Run the Backend Locally (Testing)

In the `backend` folder:

```bash
npm start
```

You should see:
```
╔══════════════════════════════════════════╗
║      SpellCheck Pro — Backend API        ║
╠══════════════════════════════════════════╣
║  ✓ Server running on port 3000           ║
...
```

Test it by opening in your browser: http://localhost:3000/health

You should see: `{"status":"ok","service":"SpellCheck Pro API"}`

If you see that → Your backend is working! ✓

---

### STEP 9: Add Icons for the Add-in

You need small PNG image files for the Excel ribbon icon.

**Quick option (use any simple icon):**
1. Go to: https://www.flaticon.com
2. Search for "spell check" or "abc"
3. Download in PNG format at sizes: 16, 32, 64, 80 pixels
4. Name them: `icon-16.png`, `icon-32.png`, `icon-64.png`, `icon-80.png`
5. Place them in the `frontend/assets/` folder

**Or create simple colored squares temporarily:**
You can use any PNG image while testing. Icons just need to exist.

---

### STEP 10: Deploy Frontend to Vercel (Free)

Vercel hosts your frontend files (HTML, CSS, JS) for free.

1. Go to: **https://vercel.com** → Sign up (free, use GitHub)
2. Click **"New Project"**
3. Import your project from GitHub, OR:
4. Use Vercel CLI for the `frontend` folder:
   ```bash
   npm install -g vercel
   cd frontend
   vercel
   ```
   Follow the prompts. It will give you a URL like:
   `https://spell-checker-addin.vercel.app`
5. **Save this URL** — this is your `FRONTEND_URL`

---

### STEP 11: Deploy Backend to Render (Free)

Render hosts your Node.js server for free (may sleep after 15 min inactivity).

1. Go to: **https://render.com** → Sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: spellcheck-pro-backend
   - **Root Directory**: backend
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **"Advanced"** → **"Add Environment Variables"**
6. Add ALL variables from your `.env` file one by one
   - Change `FRONTEND_URL` to your Vercel URL from Step 10
   - Change `NODE_ENV` to `production`
7. Click **"Create Web Service"**
8. Wait 3-5 minutes for deployment
9. Copy your Render URL: `https://spellcheck-pro-backend.onrender.com`

---

### STEP 12: Update URLs in the Code

Now that you have both URLs, update them in the project:

**In `frontend/taskpane.js` (line 20):**
```javascript
const BACKEND_URL = "https://spellcheck-pro-backend.onrender.com";
```

**In `frontend/manifest.xml`, replace ALL occurrences of:**
```
https://YOUR-FRONTEND-URL.vercel.app  →  https://spell-checker-addin.vercel.app
https://YOUR-BACKEND-URL.onrender.com →  https://spellcheck-pro-backend.onrender.com
```

**In `backend/.env`:**
```
FRONTEND_URL=https://spell-checker-addin.vercel.app
```

Then redeploy both:
- Frontend: Run `vercel` again in the `frontend` folder
- Backend: Push to GitHub (Render auto-deploys)

---

### STEP 13: Install the Add-in in Excel

**Method A: Sideloading (for testing, no approval needed)**

This lets you test the add-in without submitting it to Microsoft.

*On Windows:*
1. Copy `manifest.xml` to this folder:
   ```
   %APPDATA%\Microsoft\Excel\XLSTART
   ```
   Or: `C:\Users\[YourName]\AppData\Roaming\Microsoft\Excel\XLSTART`
2. Open Excel
3. Go to **Insert** tab → **Get Add-ins**
4. Click **"My Add-ins"** tab → **"Shared Folder"**
5. Or go to **File** → **Options** → **Trust Center** → **Trust Center Settings**
   → **Trusted Add-in Catalogs** → Add the folder path → restart Excel

*Better way on Windows:*
1. Open Excel
2. Go to **Insert** → **Get Add-ins** → **My Add-ins**
3. Click **"Upload My Add-in"**
4. Browse to your `manifest.xml` file
5. Click **"Upload"**

*On Mac:*
1. Copy `manifest.xml` to:
   ```
   /Users/[YourName]/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
   ```
2. Open Excel → Insert → My Add-ins

**Method B: Submit to Microsoft AppSource (for public launch)**

1. Create a Microsoft Partner Center account: https://partner.microsoft.com
2. Go to **Office Store** section
3. Submit your manifest and app details
4. Microsoft reviews it (7-14 days)
5. Once approved, anyone can install it from Office Store

---

## 💡 HOW TO TEST THE FULL FLOW

1. Open Excel
2. Type some text with intentional spelling mistakes:
   - Cell A1: `Chiken curry`
   - Cell A2: `Paneer Tika masla`
   - Cell A3: `Biryani with raita` (no mistakes — should be clean)
3. Click **"SpellCheck Pro"** button in Excel's Home tab ribbon
4. The task pane opens on the right
5. Enter your email → Get OTP → Login
6. Click **"Check Spelling"**
7. You should see: `Chiken → Chicken`, `Tika → Tikka`, `masla → masala`
8. Note: `Paneer`, `Biryani`, `raita` are NOT flagged (custom dictionary!)
9. Click **"Correct"** on one → the Excel cell updates ✓
10. After 20 corrections → paywall appears
11. Click **"Upgrade"** → pay ₹1 via UPI → corrections resume

---

## 🔒 SECURITY SUMMARY

| Security Feature | What It Does |
|---|---|
| JWT Tokens | Login session that expires in 30 days |
| OTP Login | No passwords to steal or forget |
| Rate Limiting | Blocks spam attacks (100 req/15 min general, 10 for auth) |
| Signature Verification | Prevents fake payment notifications |
| Helmet.js | Sets security HTTP headers automatically |
| CORS | Only allows requests from your frontend URL |
| Input Validation | Checks all inputs before processing |
| RLS on Supabase | Database-level access control |

---

## 💰 SAAS BUSINESS MODEL

| Tier | Price | Corrections |
|---|---|---|
| Free | ₹0 | 20 total |
| 1 Day | ₹1 | Unlimited |
| 7 Days | ₹7 | Unlimited |
| 30 Days | ₹30 | Unlimited |

**Monthly Revenue Potential:**
- 100 paying users × ₹30/month = ₹3,000/month
- 500 paying users × ₹30/month = ₹15,000/month

**Cost to run:**
- Vercel (frontend): Free ✓
- Render (backend): Free (with sleep) or ₹650/month (always on)
- Supabase (database): Free up to 50,000 rows ✓
- LanguageTool (API): Free ✓
- Razorpay: 2% per transaction ✓

---

## ❓ TROUBLESHOOTING

**"Cannot reach server" in the add-in:**
- Check if backend is running (visit /health in browser)
- Render free tier "sleeps" after 15 min — first request takes 30 sec

**"OTP email not received":**
- Check spam folder
- Verify Gmail App Password is correct (16 chars, no spaces)
- Make sure 2-Step Verification is enabled in your Google Account

**"Spell check not finding errors":**
- LanguageTool free API has rate limits (20 requests/minute)
- Wait 1 minute and try again
- Check if the word is in your custom dictionary (it won't be flagged)

**"CORS error" in browser console:**
- Make sure FRONTEND_URL in your .env matches your exact Vercel URL
- Redeploy the backend after changing .env

**Excel doesn't show the add-in button:**
- Make sure manifest.xml has your correct Vercel URL
- Try removing and re-adding the add-in
- Close and reopen Excel

---

## 📞 NEXT STEPS TO GROW YOUR PRODUCT

1. **Add more dictionary words** — Edit `customDictionary.js`
2. **Add more languages** — Pass different language codes to LanguageTool
3. **Analytics dashboard** — Track usage in Supabase
4. **Admin panel** — Build a simple web dashboard to see users
5. **Microsoft AppSource listing** — Submit for public distribution
6. **Self-host LanguageTool** — Use Docker for higher limits (free)
7. **Annual pricing** — Add ₹299/year option
8. **Team plans** — Sell to restaurants, food companies
