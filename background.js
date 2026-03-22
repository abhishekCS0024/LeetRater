// ─────────────────────────────────────────────
//  LeetCode Code Rater — background.js
//  Service worker: handles API call + prompt
// ─────────────────────────────────────────────


// ── 1. Message listener ───────────────────────
// FIX: Merged two separate onMessage listeners into one to avoid
//      duplicate listener registration which can cause missed messages.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "rateCode") {
    handleRating(request)
      .then(data => sendResponse({ data }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async
  }
  if (request.action === "settingsUpdated") {
    console.log("[LCR] Settings updated. Pilot mode:", request.pilotMode);
  }
});


// ── 2. Main rating handler ────────────────────

async function handleRating({ code, language, title, description }) {
  const { pilotMode } = await chrome.storage.local.get("pilotMode");
  const isPilot = pilotMode !== false; // default ON

  if (isPilot) {
    await sleep(1800);
    return getMockResponse(language);
  }

  // Auto-retry once — truncation and malformed JSON are usually transient
  try {
    return await callGroq({ code, language, title, description });
  } catch (err) {
    const retryable = ["cut off", "plain text", "repaired", "malformed"];
    if (retryable.some(kw => err.message.includes(kw))) {
      console.warn("[LCR] Retrying after error:", err.message);
      await sleep(600);
      return await callGroq({ code, language, title, description });
    }
    throw err;
  }
}


// ── 3. Groq API call ──────────────────────────

async function callGroq({ code, language, title, description }) {
  const { groqApiKey } = await chrome.storage.local.get("groqApiKey");

  if (!groqApiKey) {
    throw new Error("No API key found. Open extension settings and paste your Groq API key.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqApiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_tokens: 4000,  // full 10-criteria JSON needs ~2500 tokens
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildPrompt({ code, language, title, description }) }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error: ${response.status}`);
  }

  const result = await response.json();
  const raw = result.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty response from API.");

  return parseResponse(raw);
}


// ── 4. System prompt ──────────────────────────

const SYSTEM_PROMPT = `
You are a senior software engineer and coding interview coach performing a structured code review on a LeetCode solution.
Your persona: a supportive but honest mentor who has conducted 500+ technical interviews at top-tier companies.
Your goal: help the developer understand exactly where they stand and how to level up — not just what's wrong, but WHY it matters in an interview context.

Tone: constructive, specific, and encouraging. Never dismissive. Never vague. Always reference actual code when explaining.

════════════════════════════════════════
SCORING SYSTEM
════════════════════════════════════════

Base score = 10. Deduct points across exactly 10 criteria below.
Final score = 10 − (sum of all deductions). Minimum score is 0.

IMPORTANT SCORING RULES:
• Each criterion has a max deduction of 1 point (some allow 0.5 for minor issues).
• "earned" = max_points − deduction for that criterion.
• Partial credit is encouraged — use 0.5 deductions for minor but real issues.
• Never double-penalize: if one bug causes failures in two criteria, charge the more relevant one.
• Context matters: a brute-force O(n²) on a problem with n ≤ 100 is acceptable; on n ≤ 10⁵ it's not.
• Accepted status on LeetCode does NOT guarantee full marks — it only means basic correctness.

─────────────────────────────────────────
🧠 GROUP 1: Understanding & Approach (2 pts)
─────────────────────────────────────────
Criterion 1 — Problem Understanding (1 pt)
  Does the code correctly interpret the problem statement, constraints, and expected output?
  ✅ Full: Solution addresses the actual problem with correct interpretation of inputs/outputs.
  ❌ Deduct 1: Solves a different problem, misreads constraints, or ignores key requirements.
  ⚠️ Deduct 0.5: Mostly correct but misses a subtle constraint (e.g., 1-indexed vs 0-indexed).

Criterion 2 — Approach Selection (1 pt)
  Is the chosen algorithm/strategy appropriate for this problem's constraints?
  ✅ Full: Uses an optimal or near-optimal approach (e.g., DP when DP is expected).
  ❌ Deduct 1: Uses brute force when a well-known optimal approach exists AND the constraints demand it.
  ⚠️ Deduct 0.5: Approach works but is suboptimal (e.g., O(n log n) when O(n) is straightforward).

─────────────────────────────────────────
⚙️ GROUP 2: Implementation Quality (3 pts)
─────────────────────────────────────────
Criterion 3 — Correctness (1 pt)
  Does the solution produce correct output for standard test cases?
  ✅ Full: Logic is sound and produces correct results. Accepted on LeetCode is a strong signal.
  ❌ Deduct 1: Contains a logic bug that produces wrong output on common inputs.
  ⚠️ Deduct 0.5: Correct for most cases but has a subtle bug (e.g., off-by-one in rare scenarios).

Criterion 4 — Edge Case Handling (1 pt)
  Does it handle boundary conditions: empty input, single element, min/max values, negative numbers, duplicates?
  ✅ Full: Key edge cases are handled (explicitly or implicitly through logic).
  ❌ Deduct 1: Crashes or gives wrong output on obvious edge cases (empty array, n=0, etc.).
  ⚠️ Deduct 0.5: Handles most but misses one non-obvious edge case.

Criterion 5 — Efficiency Awareness (1 pt)
  Is the time/space complexity reasonable given the problem's constraints?
  ✅ Full: Complexity matches or is close to the expected optimal for the constraint range.
  ❌ Deduct 1: Exponential or clearly TLE-prone when polynomial is expected.
  ⚠️ Deduct 0.5: Acceptable but not optimal (e.g., O(n²) when O(n log n) is standard).

─────────────────────────────────────────
🧹 GROUP 3: Code Craftsmanship (3 pts)
─────────────────────────────────────────
Criterion 6 — Code Clarity (1 pt)
  Is the code easy to read, follow, and understand within 30 seconds?
  ✅ Full: Clean flow, reasonable line count, no unnecessary complexity.
  ❌ Deduct 1: Deeply nested (3+ levels), convoluted control flow, or "clever" code that's hard to parse.
  ⚠️ Deduct 0.5: Mostly clear but has one confusing section or unnecessary complexity.

Criterion 7 — Variable Naming (1 pt)
  Are names meaningful and self-documenting? (i, j for loop indices are fine.)
  ✅ Full: Names clearly convey purpose (e.g., leftSum, maxProfit, visited).
  ❌ Deduct 1: Critical variables named a, b, x, tmp, fun with no context.
  ⚠️ Deduct 0.5: Mix of good and poor names, or one key variable is unclear.

Criterion 8 — Modularity (1 pt)
  Is the code well-organized? Appropriate use of helper functions? No misuse of global/shared state?
  ✅ Full: Clean separation, no unnecessary globals, reasonable function length.
  ❌ Deduct 1: Mutable class-level state that causes bugs, or a single 40+ line monolithic function.
  ⚠️ Deduct 0.5: Could benefit from extraction but isn't egregious.

─────────────────────────────────────────
🧩 GROUP 4: Technical Depth (2 pts)
─────────────────────────────────────────
Criterion 9 — Language Proficiency (1 pt)
  Does the code leverage language-specific features, idioms, and standard library effectively?
  ✅ Full: Uses appropriate built-ins (e.g., Python's collections, C++ STL, Java streams).
  ❌ Deduct 1: Manually implements something the standard library provides trivially.
  ⚠️ Deduct 0.5: Misses a minor idiomatic improvement.

Criterion 10 — Best Practices (1 pt)
  No dead code, no redundant checks, no hacks, clean logical structure?
  ✅ Full: Every line serves a purpose. No commented-out code, no always-true guards.
  ❌ Deduct 1: Multiple instances of dead code, redundant logic, or hacky workarounds.
  ⚠️ Deduct 0.5: One minor instance of unnecessary code or a small anti-pattern.

════════════════════════════════════════
DEDUCTION SEVERITY REFERENCE
════════════════════════════════════════

🔴 Critical (total −3 to −5):
  Wrong algorithm output on basic cases     → −1 (Correctness) + −1 (Approach) + others
  Completely wrong approach + TLE           → −1 (Approach) + −1 (Efficiency)
  Crashes on empty input + wrong output     → −1 (Edge Cases) + −1 (Correctness)

🟡 Moderate (total −1.5 to −2.5):
  Suboptimal approach but correct           → −0.5 to −1 (Approach or Efficiency)
  Global state anti-pattern                 → −1 (Modularity)
  Poor naming throughout                    → −1 (Variable Naming)

🟢 Minor (total −0.5 to −1):
  One unclear variable name                 → −0.5 (Variable Naming)
  Missing one non-obvious edge case         → −0.5 (Edge Cases)
  One redundant check                       → −0.5 (Best Practices)

════════════════════════════════════════
INTERVIEW CONTEXT GUIDE
════════════════════════════════════════

When writing comments, frame feedback as an interviewer would think about it:
• Score 9-10: "Strong hire signal — clean, optimal, well-communicated."
• Score 7-8: "Hire-leaning — solid fundamentals, minor polish needed."
• Score 5-6: "Borderline — correct but shows gaps in optimization or code quality."
• Score 3-4: "Needs improvement — significant issues that would raise concerns."
• Score 0-2: "Major red flags — fundamental misunderstanding or broken logic."

Use this context in the verdict to help the developer understand where they'd stand.

════════════════════════════════════════
TONE & LANGUAGE RULES
════════════════════════════════════════

✅ DO:
  • Start deduction comments with: "The solution loses X point(s) due to..."
  • Start full-mark comments with: "Full point — [specific praise]."
  • Reference actual variable names, line logic, or patterns from the code.
  • Explain WHY something matters (interview context, production impact, scalability).
  • Keep fix suggestions concrete and actionable (one specific change, not a rewrite).

❌ DON'T:
  • Never say "This code is wrong" or "This is bad."
  • Never be vague: "Could be improved" without saying HOW.
  • Never suggest a complete rewrite as a "fix" — suggest the minimal targeted change.
  • Never penalize competitive programming style IF the logic is sound and readable.
  • Never assume the developer's skill level — just evaluate the code objectively.

════════════════════════════════════════
OUTPUT FORMAT — valid JSON only, no markdown fences, no extra text
════════════════════════════════════════

{
  "verdict": "<Interview-framed one-liner. Format: 'I'd rate this X/10 — [what's strong], but [what costs points].' For 9-10: pure praise. For ≤4: empathetic but honest.>",

  "baseScore": 10,

  "criteriaScores": [
    {
      "group": "🧠 Understanding & Approach",
      "criterion": "Problem Understanding",
      "number": 1,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<1-2 sentences. Full: 'Full point — [specific praise].' Deducted: 'The solution loses X point(s) due to [specific issue], which [impact].' Partial: 'Partial credit — [what's right] but [what's missing].'>"
    },
    {
      "group": "🧠 Understanding & Approach",
      "criterion": "Approach Selection",
      "number": 2,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "⚙️ Implementation Quality",
      "criterion": "Correctness",
      "number": 3,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "⚙️ Implementation Quality",
      "criterion": "Edge Case Handling",
      "number": 4,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "⚙️ Implementation Quality",
      "criterion": "Efficiency Awareness",
      "number": 5,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "🧹 Code Craftsmanship",
      "criterion": "Code Clarity",
      "number": 6,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "🧹 Code Craftsmanship",
      "criterion": "Variable Naming",
      "number": 7,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "🧹 Code Craftsmanship",
      "criterion": "Modularity",
      "number": 8,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "🧩 Technical Depth",
      "criterion": "Language Proficiency",
      "number": 9,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    },
    {
      "group": "🧩 Technical Depth",
      "criterion": "Best Practices",
      "number": 10,
      "earned": <0, 0.5, or 1>,
      "status": "<'full' | 'deducted' | 'partial'>",
      "comment": "<same format>"
    }
  ],

  "deductions": [
    {
      "points": <number: 0.5 or 1>,
      "criterion": "<criterion name>",
      "explanation": "<2-3 sentences. Start with 'The solution loses X point(s) due to...'. Reference specific code. Explain the real-world or interview impact.>",
      "fix": "<One concrete, minimal, actionable fix. Not a rewrite — a targeted change. Include a brief code snippet or pseudocode if helpful. null if no fix needed.>"
    }
  ],

  "finalScore": <number: exact sum of all earned values, range 0-10>,

  "languageTip": "<1-2 sentences: a specific, actionable tip for the language used. Reference a built-in, idiom, or pattern they could use. Not generic advice.>",

  "optimalApproach": "<2-4 sentences: the best known approach for this problem. Include the time/space complexity. Mention the key insight or data structure. Do NOT write actual code — describe the strategy.>"
}

STRICT RULES:
• criteriaScores must always have exactly 10 entries in the exact order listed above (criteria 1-10).
• finalScore must exactly equal the sum of all "earned" values across criteriaScores.
• deductions array contains ONLY criteria where points were lost (earned < 1).
• If the solution is perfect (10/10): deductions = [].
• "earned" can be 0, 0.5, or 1. Use "partial" status for 0.5.
• Do NOT output anything outside the JSON object — no markdown fences, no preamble, no trailing text.
• The JSON must be parseable by JSON.parse() with zero modifications.
`.trim();


// ── 5. User prompt builder ────────────────────

function buildPrompt({ code, language, title, description }) {
  return `
Problem: ${title}

Description:
${description}

Language: ${language}

Solution:
\`\`\`${language}
${code}
\`\`\`

Rate this solution using the rubric. Return valid JSON only.
`.trim();
}


// ── 6. Parse & validate API response ─────────
//
// 3-pass robust parser handles ALL common Groq/LLM issues:
//   Pass 1 — direct JSON.parse (clean response)
//   Pass 2 — fix invalid \u escapes and bare backslashes
//   Pass 3 — nuclear: fix string values individually
//
// Also handles:
//   • Preamble text before JSON ("Here is the rating: {...}")
//   • Trailing text / code fences after JSON
//   • Trailing commas in objects/arrays
//   • Truncated responses (token limit hit)
//   • finalScore arithmetic mismatch (auto-corrected)

function extractJSON(raw) {
  // Find the outermost JSON object
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let s = raw.slice(start, end + 1);

  // Strip trailing commas before } or ] — common LLM mistake
  s = s.replace(/,\s*([}\]])/g, "$1");

  return s;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch(e) { return null; }
}

function fixEscapes(s) {
  // Fix \u not followed by exactly 4 hex chars (e.g. "\u—" or "\u20")
  s = s.replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u");
  // Fix bare backslashes not part of valid JSON escape sequences
  // Valid escapes: \\ \/ \" \n \r \t \b \f \uXXXX
  s = s.replace(/\\(?!["\\\\/bfnrtu])/gi, "\\\\");
  return s;
}

function nuclearFix(s) {
  // Last resort: find every JSON string value and re-escape its contents
  return s.replace(/"(?:[^"\\]|\\.)*"/g, function(match) {
    const inner = match.slice(1, -1);
    const fixed = inner
      .replace(/\\(?!["\\\\/bfnrtu])/gi, "\\\\")
      .replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u");
    return '"' + fixed + '"';
  });
}

function parseResponse(raw) {
  console.log("[LCR] Response length:", raw.length, "| Preview:", raw.slice(0, 150));

  const extracted = extractJSON(raw);
  if (!extracted) {
    console.error("[LCR] No JSON object found:", raw.slice(0, 400));
    throw new Error("Model returned plain text instead of JSON. Please try again.");
  }

  // Check for truncation (unbalanced braces = cut off by token limit)
  const opens  = (extracted.match(/{/g) || []).length;
  const closes = (extracted.match(/}/g) || []).length;
  if (opens !== closes) {
    console.error("[LCR] Truncated JSON: opens=" + opens + " closes=" + closes);
    throw new Error("Response was cut off (token limit). Please try again — it usually succeeds on retry.");
  }

  // Pass 1: clean parse
  let parsed = tryParse(extracted);
  if (!parsed) {
    // Pass 2: fix escape sequences
    console.warn("[LCR] Pass 1 failed — trying escape fix");
    const fixed = fixEscapes(extracted);
    parsed = tryParse(fixed);
  }
  if (!parsed) {
    // Pass 3: nuclear string-level fix
    console.warn("[LCR] Pass 2 failed — trying nuclear fix");
    const nuclear = nuclearFix(extracted);
    parsed = tryParse(nuclear);
  }
  if (!parsed) {
    console.error("[LCR] All 3 passes failed. Extracted:", extracted.slice(0, 400));
    throw new Error("Response JSON could not be repaired. Please try again.");
  }

  // Validate required fields
  if (typeof parsed.verdict !== "string")
    throw new Error("Missing 'verdict' in response.");
  if (typeof parsed.finalScore !== "number")
    throw new Error("Missing 'finalScore' in response.");
  if (!Array.isArray(parsed.criteriaScores) || parsed.criteriaScores.length !== 10)
    throw new Error("Expected 10 criteriaScores, got " + (parsed.criteriaScores?.length ?? 0) + ". Please try again.");
  if (!Array.isArray(parsed.deductions))
    throw new Error("Missing 'deductions' in response.");

  // Auto-correct finalScore if model arithmetic is off
  const computed = parsed.criteriaScores.reduce(
    (sum, c) => sum + (typeof c.earned === "number" ? c.earned : 0), 0
  );
  if (Math.abs(computed - parsed.finalScore) > 0.01) {
    console.warn("[LCR] finalScore corrected:", parsed.finalScore, "→", computed);
    parsed.finalScore = Math.round(computed * 10) / 10;
  }

  console.log("[LCR] Parse successful. Score:", parsed.finalScore);
  return parsed;
}


// ── 7. Mock response (pilot mode) ────────────
// NOTE: Criterion 9 is "Language Proficiency" — matches SYSTEM_PROMPT
//       and content.js deduction lookup key exactly.

function getMockResponse(language) {
  return {
    verdict: "I'd rate this 6/10 — the problem is correctly understood and the output is right, but the solution loses points due to an inefficient recursive approach without memoization, a global variable anti-pattern, and a meaningless function name.",
    baseScore: 10,
    criteriaScores: [
      {
        group: "🧠 Understanding & Approach",
        criterion: "Problem Understanding",
        number: 1,
        earned: 1,
        status: "full",
        comment: "Full point — the solution correctly models the grid traversal, moving only right or down to count unique paths."
      },
      {
        group: "🧠 Understanding & Approach",
        criterion: "Approach Selection",
        number: 2,
        earned: 0,
        status: "deducted",
        comment: "The solution loses 1 point due to using plain recursion without memoization, when DP or memoized DFS is the standard efficient approach for this problem."
      },
      {
        group: "⚙️ Implementation Quality",
        criterion: "Correctness",
        number: 3,
        earned: 1,
        status: "full",
        comment: "Full point — the solution produces correct output for normal test cases as confirmed by the Accepted result."
      },
      {
        group: "⚙️ Implementation Quality",
        criterion: "Edge Case Handling",
        number: 4,
        earned: 1,
        status: "full",
        comment: "Full point — the boundary check (i==m-1 && j==n-1) and out-of-bounds guard (i<0 || j<0 || i>=m || j>=n) correctly handle grid boundaries."
      },
      {
        group: "⚙️ Implementation Quality",
        criterion: "Efficiency Awareness",
        number: 5,
        earned: 0,
        status: "deducted",
        comment: "The solution loses 1 point due to exponential time complexity O(2^(m+n)) — the same subproblems are recomputed repeatedly, causing TLE on larger grids."
      },
      {
        group: "🧹 Code Craftsmanship",
        criterion: "Code Clarity",
        number: 6,
        earned: 1,
        status: "full",
        comment: "Full point — the recursive logic is concise and the two movement directions are straightforward to follow."
      },
      {
        group: "🧹 Code Craftsmanship",
        criterion: "Variable Naming",
        number: 7,
        earned: 0.5,
        status: "partial",
        comment: "Partial credit — loop variables and parameters are fine, but the helper function 'fun' is a placeholder name with no semantic meaning."
      },
      {
        group: "🧹 Code Craftsmanship",
        criterion: "Modularity",
        number: 8,
        earned: 0,
        status: "deducted",
        comment: "The solution loses 1 point due to 'ans' being declared as a class-level global variable — this causes incorrect results if uniquePaths() is called more than once on the same instance."
      },
      {
        group: "🧩 Technical Depth",
        criterion: "Language Proficiency",
        number: 9,
        earned: 1,
        status: "full",
        comment: "Full point — C++ syntax is used correctly with proper class structure, method signatures, and integer types."
      },
      {
        group: "🧩 Technical Depth",
        criterion: "Best Practices",
        number: 10,
        earned: 0.5,
        status: "partial",
        comment: "Partial credit — the code is clean overall, but the shared mutable 'ans' pattern is a common competitive programming habit that introduces subtle bugs in production or reusable code."
      }
    ],
    deductions: [
      {
        points: 1,
        criterion: "Approach Selection",
        explanation: "The solution loses 1 point due to choosing plain recursion over memoized DP. Every unique (i, j) pair is recomputed from scratch multiple times, leading to exponential redundancy that a simple 2D memo table would eliminate.",
        fix: "Add a memo table: vector<vector<int>> memo(m, vector<int>(n, -1)); and in fun(), return memo[i][j] if it's not -1, otherwise compute and store before returning."
      },
      {
        points: 1,
        criterion: "Efficiency Awareness",
        explanation: "The solution loses 1 point due to O(2^(m+n)) time complexity. For a 10×10 grid this is already millions of recursive calls. LeetCode will TLE on large inputs where O(m×n) DP is expected.",
        fix: "Replace with bottom-up DP: dp[i][j] = dp[i-1][j] + dp[i][j-1], with dp[0][j] = dp[i][0] = 1. This runs in O(m×n) time and O(m×n) space, reducible to O(n)."
      },
      {
        points: 1,
        criterion: "Modularity",
        explanation: "The solution loses 1 point due to 'ans' being a class-level variable mutated inside fun(). If uniquePaths() is called twice on the same Solution instance, 'ans' accumulates both results — a silent bug that would concern an interviewer.",
        fix: "Declare 'int ans = 0;' locally inside uniquePaths() and pass it by reference to fun(), or better yet, refactor fun() to return int directly and sum the recursive calls."
      },
      {
        points: 0.5,
        criterion: "Variable Naming",
        explanation: "The solution loses 0.5 points due to the helper being named 'fun' — a name that conveys nothing about its purpose. In an interview, an interviewer would expect self-documenting names.",
        fix: "Rename 'fun' to 'countPaths' or 'dfs' to immediately communicate its role."
      },
      {
        points: 0.5,
        criterion: "Best Practices",
        explanation: "The solution loses 0.5 points due to the void + shared mutable state pattern. While common in competitive programming, it's an anti-pattern that makes the code harder to reason about and test.",
        fix: "Refactor fun() to 'int countPaths(int i, int j, int m, int n)' that returns the count directly, eliminating the shared state entirely."
      }
    ],
    finalScore: 6,
    languageTip: "In C++, for grid DP problems prefer vector<vector<int>> dp(m, vector<int>(n, 0)) for clean initialization. Also consider using std::function or a lambda with a capture for memoized recursion — it keeps the memo table scoped and avoids class-level state.",
    optimalApproach: "The standard O(m×n) solution uses bottom-up DP where dp[i][j] represents the number of unique paths to cell (i,j). The recurrence is dp[i][j] = dp[i-1][j] + dp[i][j-1], since each cell is reachable only from above or the left. Space can be optimized to O(n) using a single rolling row. For the mathematically inclined, there's also a O(min(m,n)) combinatorial solution: the answer is C(m+n-2, m-1), since you need exactly (m-1) down moves and (n-1) right moves in any order."
  };
}


// ── 8. Utility ────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}