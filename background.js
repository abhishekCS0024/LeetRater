/**
 * Leet Rater — background.js (Service Worker)
 *
 * Responsibilities:
 *  1. Receive rateCode messages from content.js
 *  2. Optionally validate code quality before rating
 *  3. Call Groq API with a dynamic, category-aware rubric
 *  4. Parse + repair the JSON response robustly
 *  5. Auto-retry once on transient failures
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL      = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 4000;   // 10-criteria JSON needs ~2500 tokens; headroom avoids truncation
const TEMP_RATE  = 0.2;    // Low temperature = consistent, repeatable scores
const TEMP_VAL   = 0.1;    // Even lower for validation (binary yes/no)

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'rateCode') {
    handleRateCode(request)
      .then(data  => sendResponse({ ok: true,  data }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // keep port open for async response
  }

  if (request.action === 'settingsUpdated') {
    console.info('[LeetRater] Settings updated.');
  }
});

// ─── Main Handler ─────────────────────────────────────────────────────────────

/**
 * Orchestrates the full rating pipeline:
 *   Step 1 → Validate API key exists
 *   Step 2 → Validate code is not empty/broken
 *   Step 3 → Rate with dynamic rubric (with one auto-retry)
 */
async function handleRateCode({ code, language, title, description }) {
  const apiKey = await getApiKey();

  // Step 1 — validate code before burning API tokens
  const validation = await validateCode({ apiKey, code, language, title });
  if (!validation.isValid) {
    return { isValidationError: true, ...validation };
  }

  // Step 2 — rate with auto-retry for transient failures
  try {
    return await rateCode({ apiKey, code, language, title, description });
  } catch (err) {
    if (isRetryable(err)) {
      console.warn('[LeetRater] Retrying after transient error:', err.message);
      await sleep(800);
      return await rateCode({ apiKey, code, language, title, description });
    }
    throw err;
  }
}

// ─── API Key ──────────────────────────────────────────────────────────────────

async function getApiKey() {
  const { groqApiKey } = await chrome.storage.local.get('groqApiKey');
  if (!groqApiKey) {
    throw new Error('No API key saved. Click the ⚡ extension icon and enter your Groq key.');
  }
  return groqApiKey;
}

// ─── Code Validation ─────────────────────────────────────────────────────────

const VALIDATION_SYSTEM = `
You are a strict code validator. Analyze the submitted code and detect ONLY these blocking issues:
- EMPTY: function body is empty, has only comments, or just returns a placeholder like -1/null/0
- SYNTAX: missing brackets/braces, invalid tokens, unclosed strings that prevent parsing
- WRONG_LANG: code is clearly written in a different language than specified
- UNRELATED: code clearly solves a completely different problem (not just suboptimal)

Be LENIENT. Do NOT flag: suboptimal algorithms, poor naming, missing edge cases, style issues.
Respond ONLY with valid JSON, no markdown:
{
  "isValid": true | false,
  "errorType": null | "EMPTY" | "SYNTAX" | "WRONG_LANG" | "UNRELATED",
  "errorSummary": null | "one short sentence",
  "errorLines": null | [{"line": <number>, "issue": "<short>", "code": "<snippet>"}],
  "suggestion": null | "one concrete fix"
}
`.trim();

async function validateCode({ apiKey, code, language, title }) {
  const userMsg = `Language: ${language}\nProblem: ${title}\n\nCode:\n\`\`\`${language}\n${code}\n\`\`\`\n\nValidate. JSON only.`;

  let raw;
  try {
    raw = await callGroq({ apiKey, system: VALIDATION_SYSTEM, user: userMsg, maxTokens: 512, temperature: TEMP_VAL });
  } catch {
    // Validation API failure → fail open, let rating proceed
    console.warn('[LeetRater] Validation call failed — proceeding to rating');
    return { isValid: true };
  }

  try {
    const parsed = parseJSON(raw);
    if (typeof parsed?.isValid !== 'boolean') return { isValid: true };
    return parsed;
  } catch {
    return { isValid: true }; // fail open
  }
}

// ─── Rating ───────────────────────────────────────────────────────────────────

const RATING_SYSTEM = `
You are a senior software engineer and coding interview coach performing a structured, context-aware code review.

══════════════════════════════════════════
STEP 1 — DETECT PROBLEM CATEGORY
══════════════════════════════════════════
Read the problem description and identify ONE primary category:
Two Pointers | Sliding Window | Dynamic Programming | Binary Search | Backtracking | Graph/BFS/DFS | Tree Traversal | Recursion | Greedy | HashMap/Hashing | Stack/Queue | Math/Bit Manipulation | Sorting | String Manipulation | General

══════════════════════════════════════════
STEP 2 — SCORE ACROSS 10 CRITERIA
══════════════════════════════════════════
Start from 10. Deduct per criterion. finalScore = 10 − total_deductions (min 0).

FIXED CRITERIA (always apply):
  1. Problem Understanding  — Did code interpret the problem correctly?         Max deduct: 1
  2. Correctness            — Produces right output for normal cases?            Max deduct: 1
  3. Edge Case Handling     — Handles empty, null, boundary, overflow?           Max deduct: 1
  4. Efficiency/Complexity  — Time/space complexity appropriate for constraints? Max deduct: 1

CATEGORY-SPECIFIC (choose 4 based on detected category):
  Two Pointers/Sliding Window → Pointer Init | Movement Logic | Termination Condition | Window Invariant
  Dynamic Programming         → State Definition | Recurrence Relation | Base Cases | Overlap Handling
  Binary Search               → Search Space | Mid Calculation | Boundary Shrink | Termination
  Backtracking                → Choice Exploration | Constraint Pruning | State Restoration | Result Collection
  Graph/BFS/DFS               → Traversal Completeness | Cycle Prevention | Algorithm Fit | Graph Representation
  Tree Traversal              → Null Check | Traversal Order | Return Value Propagation | Structure Assumptions
  Recursion                   → Base Case | Recursive Trust | Problem Decomposition | Stack Depth Risk
  Greedy                      → Greedy Choice Property | Ordering Step | Invariant Maintenance | Correctness Proof
  HashMap/Hashing             → Key Design | Lookup Efficiency | Collision Handling | Memory Awareness
  Stack/Queue                 → Push/Pop Logic | Monotonic Property | Result Extraction | Boundary Handling
  Math/Bit Manipulation       → Formula Correctness | Overflow Handling | Edge Values | Bit Operation Precision
  Sorting                     → Algorithm Selection | Comparison Logic | Post-Sort Logic | Stability
  String Manipulation         → Index Management | Mutation Handling | Encoding | Pattern Matching
  General                     → Algorithm Design | Data Structure Choice | Loop Logic | Modularity

FIXED CRITERIA (always apply):
  9.  Language Proficiency   — Uses language features, STL, idioms correctly?   Max deduct: 1
  10. Best Practices         — No dead code, redundant checks, global state abuse? Max deduct: 1

DEDUCTION GUIDE:
  −1   Major issue (wrong output, TLE-prone, crashes on edge cases)
  −0.5 Minor issue (suboptimal but acceptable, slight naming issue)
  0    Full marks

TONE RULES:
  ✅ Full mark:  "Full point — [specific praise referencing actual code]"
  ✅ Deduction:  "The solution loses X point(s) due to [specific issue], which [impact]"
  ❌ Never say:  "This is wrong" or "This is bad"

INTERVIEW FRAMING:
  9–10 → Strong hire signal
  7–8  → Hire-leaning, minor polish needed
  5–6  → Borderline, correct but gaps in quality
  ≤4   → Needs significant improvement

══════════════════════════════════════════
OUTPUT — valid JSON only, no markdown, no extra text
══════════════════════════════════════════
{
  "detectedCategory": "<category name>",
  "categoryRationale": "<1 sentence why>",
  "verdict": "<interview one-liner: I'd rate this X/10 — [strength], but [weakness]>",
  "baseScore": 10,
  "criteriaScores": [
    {
      "group": "<group label>",
      "criterion": "<criterion name>",
      "number": <1–10>,
      "earned": <0 | 0.5 | 1>,
      "status": "<full | partial | deducted>",
      "comment": "<1–2 sentences using correct tone>"
    }
  ],
  "deductions": [
    {
      "points": <0.5 | 1>,
      "criterion": "<criterion name>",
      "explanation": "<2–3 sentences starting with 'The solution loses X point(s) due to...'>",
      "fix": "<one concrete actionable fix, or null>"
    }
  ],
  "finalScore": <exact sum of earned values>,
  "languageTip": "<1–2 sentences: specific tip for the language used>",
  "optimalApproach": "<2–4 sentences: best known approach with complexity>"
}

STRICT RULES:
• criteriaScores MUST have exactly 10 entries numbered 1–10
• Criteria 1,2,3,4 are ALWAYS: Problem Understanding, Correctness, Edge Case Handling, Efficiency/Complexity
• Criteria 5,6,7,8 are ALWAYS the 4 category-specific ones for the detected category
• Criteria 9,10 are ALWAYS: Language Proficiency, Best Practices
• finalScore MUST equal exact sum of all earned values
• deductions lists only criteria where earned < 1
• Output ONLY the JSON object — nothing before or after
`.trim();

async function rateCode({ apiKey, code, language, title, description }) {
  const userMsg = `Problem: ${title}\n\nDescription:\n${description}\n\nLanguage: ${language}\n\nSolution:\n\`\`\`${language}\n${code}\n\`\`\`\n\nRate this solution. Return valid JSON only.`;

  const raw = await callGroq({ apiKey, system: RATING_SYSTEM, user: userMsg, maxTokens: MAX_TOKENS, temperature: TEMP_RATE });
  return parseAndValidateRating(raw);
}

// ─── Groq HTTP Call ───────────────────────────────────────────────────────────

async function callGroq({ apiKey, system, user, maxTokens, temperature }) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg  = body?.error?.message || `HTTP ${response.status}`;

    if (response.status === 401) throw new Error('Invalid API key. Check your Groq key in settings.');
    if (response.status === 429) throw new Error('Rate limit hit. Please wait a moment and try again.');
    if (response.status >= 500) throw new Error(`Groq server error (${response.status}). Please try again.`);
    throw new Error(`API error: ${msg}`);
  }

  const result = await response.json();
  const raw = result.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty response from API. Please try again.');

  console.debug('[LeetRater] Raw response length:', raw.length);
  return raw;
}

// ─── JSON Parsing (3-pass robust) ────────────────────────────────────────────

/**
 * Handles all common LLM response issues:
 *  Pass 1 — direct JSON.parse (clean response)
 *  Pass 2 — fix invalid \u escapes and bare backslashes
 *  Pass 3 — nuclear: fix individual string values
 *
 * Also:
 *  - Strips preamble text and code fences
 *  - Removes trailing commas
 *  - Detects truncation (unbalanced braces)
 */
function parseJSON(raw) {
  // Extract JSON object by finding outermost { }
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in response.');
  }

  let s = raw.slice(start, end + 1);

  // Strip trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // Check for truncation
  const opens  = (s.match(/{/g) || []).length;
  const closes = (s.match(/}/g) || []).length;
  if (opens !== closes) {
    throw new Error('Response was truncated (token limit hit). Please try again.');
  }

  // Pass 1: clean parse
  let parsed = tryParse(s);
  if (parsed) return parsed;

  // Pass 2: fix escape sequences
  const fixed = s
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u')  // bad \uXXXX
    .replace(/\\(?!["\\\/bfnrtu])/gi, '\\\\');    // bare backslash
  parsed = tryParse(fixed);
  if (parsed) return parsed;

  // Pass 3: nuclear — fix each string value individually
  const nuclear = s.replace(/"(?:[^"\\]|\\.)*"/g, match => {
    const inner = match.slice(1, -1)
      .replace(/\\(?!["\\\/bfnrtu])/gi, '\\\\')
      .replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u');
    return `"${inner}"`;
  });
  parsed = tryParse(nuclear);
  if (parsed) return parsed;

  throw new Error('Response JSON could not be parsed after all repair attempts.');
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ─── Rating Response Validation ───────────────────────────────────────────────

function parseAndValidateRating(raw) {
  const parsed = parseJSON(raw);

  // Structure checks
  if (typeof parsed.verdict !== 'string')
    throw new Error("Response missing 'verdict' field.");
  if (typeof parsed.finalScore !== 'number')
    throw new Error("Response missing 'finalScore' field.");
  if (!Array.isArray(parsed.criteriaScores) || parsed.criteriaScores.length !== 10)
    throw new Error(`Expected 10 criteriaScores, got ${parsed.criteriaScores?.length ?? 0}. Please try again.`);
  if (!Array.isArray(parsed.deductions))
    throw new Error("Response missing 'deductions' array.");

  // Auto-correct finalScore if model arithmetic is off
  const computed = parsed.criteriaScores.reduce((sum, c) => sum + (typeof c.earned === 'number' ? c.earned : 0), 0);
  const rounded  = Math.round(computed * 10) / 10;
  if (Math.abs(rounded - parsed.finalScore) > 0.05) {
    console.warn(`[LeetRater] finalScore corrected: ${parsed.finalScore} → ${rounded}`);
    parsed.finalScore = rounded;
  }

  console.info(`[LeetRater] Rating complete. Category: ${parsed.detectedCategory}. Score: ${parsed.finalScore}/10`);
  return parsed;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function isRetryable(err) {
  const msg = err.message.toLowerCase();
  return msg.includes('truncated') || msg.includes('json') || msg.includes('parsed') || msg.includes('plain text');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}