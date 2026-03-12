/*
  ============================================================
  utils/languageTool.js — Spell Check via LanguageTool API
  ============================================================
  PURPOSE:
    This file talks to the LanguageTool API to find spelling
    and grammar errors in text.

  WHAT IS LANGUAGETOOL?
    LanguageTool is a free, open-source proofreading tool.
    It has a free public API at:
    https://api.languagetool.org/v2/check

    Free tier limits: ~20 requests/minute, max 1500 chars/request
    For production, consider self-hosting LanguageTool (it's free!)
    or purchasing the premium API.

  HOW IT WORKS:
    1. We send a piece of text to the API
    2. The API returns a list of "matches" (errors it found)
    3. Each match has the error position and suggested corrections
    4. We format that into a clean list for our frontend
  ============================================================
*/

const fetch = require("node-fetch");
const { filterCustomWords } = require("./customDictionary");

const LANGUAGE_TOOL_URL = process.env.LANGUAGE_TOOL_URL ||
  "https://api.languagetool.org/v2/check";

/*
  checkSpelling(text, language)
  ==============================
  Checks a single piece of text for spelling errors.

  Arguments:
    text     - The text to check (e.g., "Chiken Masala")
    language - Language code (default: "en-US")

  Returns:
    Array of error objects like:
    [{
      word: "Chiken",
      offset: 0,
      length: 6,
      suggestions: ["Chicken", "Chicane"],
      message: "Possible spelling mistake found."
    }]
*/
async function checkSpelling(text, language = "en-US") {
  if (!text || text.trim().length === 0) return [];

  // Build the POST form data that LanguageTool expects
  const params = new URLSearchParams({
    text,
    language,
    enabledOnly: "false",  // Check all rules, not just enabled ones
    // We only want SPELLING errors, not grammar/style errors:
    disabledCategories: "GRAMMAR,STYLE,TYPOGRAPHY,PUNCTUATION,CASING",
  });

  // Add API key if configured (for premium LanguageTool)
  if (process.env.LANGUAGE_TOOL_API_KEY) {
    params.append("apiKey", process.env.LANGUAGE_TOOL_API_KEY);
  }

  try {
    const response = await fetch(LANGUAGE_TOOL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      timeout: 10000, // 10 second timeout
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("LanguageTool API error:", response.status, errText);
      throw new Error(`LanguageTool API error: ${response.status}`);
    }

    const data = await response.json();

    // Transform LanguageTool's response into our clean format
    const errors = (data.matches || [])
      .filter(match => {
        // Only include SPELLING errors (not grammar, style, etc.)
        return match.rule.issueType === "misspelling" ||
               match.rule.category.id === "TYPOS" ||
               match.rule.id.includes("SPELL");
      })
      .map(match => ({
        word: text.substring(match.offset, match.offset + match.length),
        offset: match.offset,
        length: match.length,
        suggestions: (match.replacements || [])
          .slice(0, 5) // Max 5 suggestions per error
          .map(r => r.value),
        message: match.message,
      }));

    return errors;

  } catch (err) {
    if (err.name === "FetchError" || err.code === "ETIMEDOUT") {
      throw new Error("Cannot reach spell check service. Please try again.");
    }
    throw err;
  }
}

/*
  checkCells(cells)
  ==================
  Checks an array of cell objects for spelling errors.
  Each cell is: { address: "A1", text: "Chiken curry" }

  Returns a flat array of errors, each containing:
    - The cell address (for highlighting in Excel)
    - The misspelled word
    - Suggestions
    - The full cell text (to rebuild corrected text)

  Also filters out custom dictionary words (food terms, etc.)
*/
async function checkCells(cells) {
  if (!cells || cells.length === 0) return [];

  const allErrors = [];

  // Process cells one by one (or could batch — but LanguageTool
  // free tier prefers smaller requests)
  for (const cell of cells) {
    try {
      const rawErrors = await checkSpelling(cell.text);

      // Convert LanguageTool errors into our format
      const cellErrors = rawErrors.map(err => ({
        address:    cell.address,
        original:   err.word,          // The misspelled word
        suggestions: err.suggestions,  // List of possible corrections
        correction: err.suggestions[0] || "",  // Best guess
        fullText:   cell.text,         // Full cell text (to rebuild)
        offset:     err.offset,
        message:    err.message,
      }));

      allErrors.push(...cellErrors);

      // Small delay to be polite to the free API
      // (prevents hitting rate limits)
      await sleep(200);

    } catch (err) {
      // Log but continue — don't fail all cells if one has an issue
      console.warn(`Error checking cell ${cell.address}:`, err.message);
    }
  }

  // Remove any errors that are actually custom dictionary words
  // (food words like Paneer, Tikka, etc.)
  const filtered = filterCustomWords(allErrors);

  return filtered;
}

// Tiny helper: waits for N milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { checkSpelling, checkCells };
