/*
  ============================================================
  utils/customDictionary.js — Food & Menu Word Dictionary
  ============================================================
  PURPOSE:
    LanguageTool doesn't know Indian food words like "Paneer",
    "Biryani", "Tikka", etc. It would incorrectly flag these
    as spelling errors.

    This file contains a list of words that should NEVER be
    marked as spelling errors.

  HOW TO ADD MORE WORDS:
    Simply add them to the CUSTOM_WORDS array below.
    Words are case-insensitive — "paneer" and "Paneer" both work.

  HOW IT WORKS:
    Before sending errors back to the frontend, our spell-check
    route filters out any "error" that is actually a custom
    dictionary word.
  ============================================================
*/

// ── The Master Custom Dictionary ─────────────────────────────
const CUSTOM_WORDS = [
  // ── Indian Food / Menu Items ────────────────────────────
  "Paneer", "Makhani", "Tikka", "Biryani", "Raita", "Bhuna",
  "Masala", "Kulcha", "Tandoori", "Dal", "Daal", "Naan",
  "Paratha", "Parantha", "Roti", "Chapati", "Chapatti",
  "Puri", "Poori", "Bhature", "Chole", "Chana", "Rajma",
  "Kadhi", "Halwa", "Kheer", "Gulab", "Jamun", "Jalebi",
  "Ladoo", "Laddoo", "Burfi", "Barfi", "Peda", "Rasgulla",
  "Sandesh", "Rabri", "Kulfi", "Lassi", "Shrikhand",
  "Samosa", "Pakora", "Bhaji", "Vada", "Idli", "Dosa",
  "Uttapam", "Upma", "Poha", "Khichdi", "Sabudana",
  "Aloo", "Gobi", "Palak", "Methi", "Baingan", "Bharta",
  "Bhindi", "Lauki", "Tinda", "Karela", "Jackfruit",
  "Korma", "Nihari", "Haleem", "Keema", "Mutton", "Gosht",
  "Seekh", "Shami", "Galawati", "Rogan", "Kofta", "Malai",
  "Handi", "Dum", "Lucknowi", "Awadhi", "Hyderabadi",
  "Mughlai", "Punjabi",

  // ── Cooking Terms & Spices ───────────────────────────────
  "Jeera", "Zeera", "Cumin", "Cardamom", "Elaichi",
  "Cinnamon", "Dalchini", "Clove", "Laung", "Turmeric",
  "Haldi", "Chilli", "Mirchi", "Kali", "Hing", "Asafoetida",
  "Saunf", "Ajwain", "Methi", "Kalonji", "Mustard",
  "Sarson", "Fenugreek", "Garam", "Chaat", "Amchur",
  "Tamarind", "Imli", "Kokum", "Anardana", "Sumac",

  // ── Restaurant / Menu Words ──────────────────────────────
  "Thali", "Combo", "Platter", "Tawa", "Kadai", "Balti",
  "Seekh", "Reshmi", "Achari", "Lahori", "Amritsari",
  "Kashmiri", "Rajasthani", "Gujarati", "Bengali",
  "Maharashtrian", "Keralite", "Chettinad", "Andhra",
  "Mughal", "Nawabi",

  // ── Drinks / Beverages ───────────────────────────────────
  "Chai", "Masala chai", "Lassi", "Sharbat", "Nimbu",
  "Pani", "Jaljeera", "Thandai", "Badam", "Kesar",

  // ── Restaurant business terms ────────────────────────────
  "Veg", "Non-veg", "Jain", "Satvik", "Gluten",

  // ── Common Abbreviations in menus ───────────────────────
  "veg", "nonveg", "pcs", "grms", "ml",
];

// Create a Set of lowercase words for fast O(1) lookup
const CUSTOM_WORDS_SET = new Set(
  CUSTOM_WORDS.map(w => w.toLowerCase().trim())
);

/*
  isCustomWord(word)
  ------------------
  Returns true if the word is in our custom dictionary.
  Case-insensitive: "Paneer" and "paneer" both return true.

  Usage:
    isCustomWord("Paneer")  → true
    isCustomWord("Chiken")  → false
*/
function isCustomWord(word) {
  if (!word || typeof word !== "string") return false;
  return CUSTOM_WORDS_SET.has(word.toLowerCase().trim());
}

/*
  filterCustomWords(errors)
  --------------------------
  Given an array of spelling errors, removes any errors where
  the flagged word is actually in our custom dictionary.

  Each error object should have an "original" field
  (the word that was flagged as misspelled).

  Returns the filtered array with only real errors.
*/
function filterCustomWords(errors) {
  if (!Array.isArray(errors)) return [];

  return errors.filter(error => {
    // Keep the error only if the flagged word is NOT in our dictionary
    return !isCustomWord(error.original);
  });
}

/*
  addCustomWord(word)
  -------------------
  Adds a new word to the in-memory dictionary.
  Note: This only lasts until the server restarts.
  For permanent additions, add to CUSTOM_WORDS array above.
*/
function addCustomWord(word) {
  if (word && typeof word === "string") {
    CUSTOM_WORDS_SET.add(word.toLowerCase().trim());
    CUSTOM_WORDS.push(word.trim());
  }
}

/*
  getCustomWords()
  ----------------
  Returns the full list of custom dictionary words.
  Used by admin endpoints to inspect the dictionary.
*/
function getCustomWords() {
  return [...CUSTOM_WORDS];
}

module.exports = {
  isCustomWord,
  filterCustomWords,
  addCustomWord,
  getCustomWords,
};
