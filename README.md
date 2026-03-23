# ⚡ Leet Rater

> AI-powered LeetCode code reviewer — rates your solution out of 10 with detailed, constructive feedback tailored to the problem type.

---

## What it does

Leet Rater injects a collapsible sidebar into any LeetCode problem page. Write your solution, click **Analyze**, and get:

- **Dynamic 10-point rubric** — detects the algorithm category (DP, Binary Search, Backtracking, Graph, etc.) and builds criteria specific to that problem type
- **Earned-first presentation** — shows what you did well before showing deductions
- **Deduction explanations** — every lost point explained with *why it matters* and a concrete fix
- **Language-specific tips** — idiomatic advice for C++, Python, Java, and more
- **Optimal approach** — best known solution with time/space complexity

---

## File Structure

```
leet-rater/
├── manifest.json       Chrome extension config (MV3)
├── background.js       Service worker — Groq API calls, validation, JSON parsing
├── content.js          Sidebar injection, DOM scraping, result rendering
├── styles.css          Dark UI scoped to #lr-* selectors
├── settings.html       Extension popup — API key management
├── settings.js         Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Installation

### Prerequisites
- Google Chrome (or any Chromium-based browser)
- A free [Groq API key](https://console.groq.com/keys) — no credit card required

### Steps

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top right)
4. Click **Load unpacked** and select the `leet-rater/` folder
5. Click the ⚡ icon in the Chrome toolbar
6. Paste your Groq API key and click **Save API Key**
7. Open any LeetCode problem — you'll see the orange ⚡ tab on the right edge

---

## How to use

1. Go to any LeetCode problem (e.g. `leetcode.com/problems/two-sum/`)
2. Write your solution in the code editor
3. Click the **⚡ tab** on the right edge to open the sidebar
4. Click **Analyze my solution**
5. Wait ~3–5 seconds for the AI review

---

## Scoring Rubric

Every analysis scores your solution across **10 criteria** grouped into 4 categories.

### Fixed criteria (always applied)

| # | Criterion | What it checks |
|---|-----------|----------------|
| 1 | Problem Understanding | Did you interpret the problem correctly? |
| 2 | Correctness | Does it produce right output for normal cases? |
| 3 | Edge Case Handling | Handles empty, null, min/max, boundary inputs? |
| 4 | Efficiency / Complexity | Is the time/space complexity appropriate? |
| 9 | Language Proficiency | Uses language features, STL, idioms correctly? |
| 10 | Best Practices | No dead code, globals abuse, redundant checks? |

### Dynamic criteria (criteria 5–8, change per problem type)

| Problem Category | Criteria 5–8 |
|-----------------|--------------|
| **Two Pointers / Sliding Window** | Pointer Init · Movement Logic · Termination · Window Invariant |
| **Dynamic Programming** | State Definition · Recurrence Relation · Base Cases · Overlap Handling |
| **Binary Search** | Search Space · Mid Calculation · Boundary Shrink · Termination |
| **Backtracking** | Choice Exploration · Constraint Pruning · State Restoration · Result Collection |
| **Graph / BFS / DFS** | Traversal Completeness · Cycle Prevention · Algorithm Fit · Representation |
| **Tree Traversal** | Null Check · Traversal Order · Return Value · Structure Assumptions |
| **Recursion** | Base Case · Recursive Trust · Decomposition · Stack Depth Risk |
| **Greedy** | Choice Property · Ordering Step · Invariant · Correctness |
| **HashMap / Hashing** | Key Design · Lookup Efficiency · Collision Handling · Memory |
| **Stack / Queue** | Push/Pop Logic · Monotonic Property · Result Extraction · Boundaries |
| **Math / Bit Manipulation** | Formula · Overflow · Edge Values · Bit Precision |
| **Sorting** | Algorithm Selection · Comparator · Post-Sort Logic · Stability |
| **String Manipulation** | Index Management · Mutation · Encoding · Pattern Matching |
| **General** | Algorithm Design · Data Structure · Loop Logic · Modularity |

### Score interpretation

| Score | What it means |
|-------|---------------|
| 9–10 | Strong hire signal — clean, optimal, well-communicated |
| 7–8  | Hire-leaning — solid fundamentals, minor polish needed |
| 5–6  | Borderline — correct but gaps in optimization or quality |
| 3–4  | Needs improvement — issues that would raise interview concerns |
| 0–2  | Major red flags — fundamental misunderstanding or broken logic |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension platform | Chrome Extension Manifest V3 |
| AI model | `llama-3.3-70b-versatile` via Groq API |
| Language | Vanilla JS (`'use strict'`, ES modules) |
| Styling | CSS custom properties, no frameworks |
| Storage | `chrome.storage.local` (API key only) |

---

## Architecture

```
User clicks Analyze
       │
       ▼
content.js — scrapeCode() + scrapeProblem()
       │
       │  chrome.runtime.sendMessage
       ▼
background.js (Service Worker)
       │
       ├─► validateCode()     — quick Groq call to block empty/broken code
       │       │ isValid=false → return validation error to content.js
       │       │ isValid=true  ↓
       │
       ├─► rateCode()         — full rubric call (max_tokens: 4000)
       │       │ parse failure → auto-retry once
       │       │ success       ↓
       │
       └─► parseAndValidateRating()
               │ auto-correct finalScore if model arithmetic is off
               ▼
       sendResponse({ ok: true, data })
               │
               ▼
content.js — renderRating() or renderValidationError()
```

### JSON parsing — 3-pass repair

The Groq API (llama-3.3-70b) sometimes returns responses that are not clean JSON. The parser handles this gracefully:

1. **Pass 1** — direct `JSON.parse` (handles clean responses)
2. **Pass 2** — fix invalid `\u` escapes and bare backslashes (common in code snippets)
3. **Pass 3** — nuclear: re-escape every string value individually

All passes also strip preamble text, code fences, and trailing commas before attempting to parse.

---

## Troubleshooting

**Sidebar doesn't appear**
- Make sure you are on a `/problems/` URL, not the explore or discuss pages
- Try refreshing the page — the MutationObserver has a 3 s fallback
- Check `chrome://extensions` → Leet Rater → Errors

**"No API key saved" error**
- Click the ⚡ icon in the Chrome toolbar
- Paste your Groq key (starts with `gsk_`) and click Save

**"Could not read your code" error**
- Write at least a few lines of code in the editor before analyzing
- LeetCode sometimes changes their DOM — try refreshing

**"Rate limit hit" error**
- Groq free tier has per-minute limits — wait 10–15 seconds and retry

**API key invalid error**
- Make sure you copied the full key from console.groq.com/keys
- Keys start with `gsk_` and are at least 20 characters

---

## Privacy

- Your code and the problem description are sent to the **Groq API only**
- No data is stored anywhere except your API key in Chrome's local extension storage
- No analytics, no tracking, no third-party services

---

## Roadmap

- [ ] Rating history per problem (localStorage)
- [ ] Hint mode — suggestions without revealing the optimal approach
- [ ] Export feedback as Markdown / PDF
- [ ] Support for LeetCode contest pages

---

## License

MIT
