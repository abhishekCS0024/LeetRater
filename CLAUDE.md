# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Leet Rater** is a Chrome Extension (Manifest V3) that provides AI-powered code reviews for LeetCode solutions using the Groq API. The extension injects a sidebar into LeetCode problem pages, scrapes submitted code, sends it for analysis, and renders a dynamic 10-point rating with category-specific criteria.

## Tech Stack & Setup

**No build step required.** This is vanilla JS with no npm/webpack/build tools.

### Local Testing
```bash
# 1. Load unpacked into Chrome
# - Open chrome://extensions
# - Enable Developer mode (top right)
# - Click "Load unpacked" → select this folder

# 2. Set up Groq API key
# - Click the ⚡ extension icon
# - Paste your key from console.groq.com/keys (free tier)
# - Click "Save API Key"

# 3. Test on a LeetCode problem
# - Go to https://leetcode.com/problems/<any-problem>/
# - Click the ⚡ tab (right edge of screen)
# - Write code and click "Analyze my solution"
# - Verify the sidebar renders feedback
```

### Testing Changes
- Edit any `.js` or `.css` file
- Reload extension: `chrome://extensions` → Leet Rater → reload icon
- Refresh the LeetCode page
- Test affected features (sidebar injection, API calls, form submission, etc.)

## Architecture & File Responsibilities

```
manifest.json       → Extension config (permissions, host URLs, service worker, content scripts)
background.js       → Service Worker: Groq API orchestration, code validation, JSON parsing
content.js          → Content Script: DOM scraping, sidebar injection, UI rendering
styles.css          → Scoped CSS for sidebar (#lr-* namespace)
settings.html       → Popup UI (API key form)
settings.js         → Popup logic (storage, validation)
```

### Key Data Flow

```
User clicks "Analyze" in sidebar
         ↓
content.js: scrapeCode() + scrapeProblem()
         ↓
chrome.runtime.sendMessage({ action: 'rateCode', code, language, title, description })
         ↓
background.js:
  1. validateCode()      → Check if code is empty/broken (optional, quick Groq call)
  2. rateCode()          → Full 10-point rubric (max_tokens: 4000)
  3. parseAndValidateRating()  → Auto-repair malformed JSON (3-pass)
         ↓
sendResponse({ ok: true, data })
         ↓
content.js: renderRating() or renderValidationError()
         ↓
Sidebar displays scored criteria + deductions
```

## Critical Implementation Details

### 1. DOM Scraping (content.js)

The extension must scrape three pieces of data from LeetCode's dynamic DOM:

- **Code**: Try `.view-lines` (Monaco editor), `.CodeMirror`, `[data-mode-id]`, `textarea.inputarea`
- **Language**: Text from `.ant-select-selection-item` or headlessui button spans
- **Problem Title & Description**: Multiple selector fallbacks due to LeetCode layout changes

If selectors fail silently (Leetcode updates UI):
- Check browser console for "Could not read your code"
- Add new selectors to `EDITOR_SELECTORS`, `LANG_SELECTORS`, `TITLE_SELECTORS`, `DESC_SELECTORS`
- Test with `document.querySelector()` in Chrome DevTools on a live problem page

### 2. JSON Parsing Robustness (background.js)

Groq's llama-3.3-70b sometimes returns invalid JSON (broken `\u` escapes, unquoted keys, trailing commas). The parser runs **3 passes**:

1. **Pass 1**: Direct `JSON.parse()` (clean responses)
2. **Pass 2**: Fix invalid `\u` escapes and bare backslashes (common in code snippets)
3. **Pass 3**: Re-escape every string value individually (nuclear option)

All passes also strip preamble text, code fences, and trailing commas.

**Never trust the raw API response.** Always validate structure with `parseAndValidateRating()`.

### 3. Scoring Rubric (background.js)

The rubric is **dynamic**: 6 fixed criteria (understanding, correctness, edge cases, efficiency, language proficiency, best practices) + 4 algorithm-specific criteria.

Algorithm detection happens in the Groq prompt. Detects: DP, Binary Search, Backtracking, Graph/BFS/DFS, Tree, Recursion, Greedy, HashMap, Stack, Queue, Math, Sorting, Strings, or "General".

If the model returns `finalScore` that doesn't match the sum of criteria, `auto-correct` it:
```javascript
criteria.forEach(c => sum += c.points);
if (finalScore !== sum) finalScore = sum;  // Trust math, not model arithmetic
```

### 4. Auto-Retry Logic (background.js)

Groq rate limits are real. The handler retries **once** on transient errors (429, 500, timeout). Check `isRetryable()` before retry.

### 5. Message Protocol (content.js ↔ background.js)

**Request** (content.js → background.js):
```javascript
chrome.runtime.sendMessage({
  action: 'rateCode',
  code: '<user code>',
  language: 'Python3' | 'C++' | 'Java' | ...,
  title: 'Two Sum',
  description: '<problem description>'
})
```

**Response** (background.js → content.js):
```javascript
{
  ok: true,
  data: {
    finalScore: 7,
    isValidationError: false,
    criteria: [
      { name: 'Problem Understanding', points: 10, explanation: '...' },
      { name: 'Custom Criterion', points: 8, explanation: '...', deductions: [...] }
    ],
    optimalApproach: { algorithm: '...', timeComplexity: '...', spaceComplexity: '...' },
    languageSpecificTips: ['...']
  }
}
```

or on error:
```javascript
{
  ok: false,
  error: 'Rate limit hit. Please retry in 10–15 seconds.'
}
```

### 6. CSS Namespace (styles.css)

All selectors are scoped to `#lr-*` to avoid colliding with LeetCode's styles:
- `#lr-tab` — collapsible tab on right edge
- `#lr-sidebar` — main panel
- `#lr-content` — content area
- Nested elements like `#lr-tab-icon`, `#lr-button`, etc.

Never add unscopedCSS that could leak into the page.

## Common Development Tasks

### Adding a New Groq API Call
1. Add function to `background.js` (e.g., `async function newFeature() { ... }`)
2. Handle inside `handleRateCode()` or new message listener
3. Call with `const resp = await groqCall(apiKey, messages, maxTokens, temperature)`
4. Always parse response through `parseAndValidateRating()` or custom JSON repair
5. Send back via `sendResponse()` with `{ ok: true, data }` or `{ ok: false, error }`
6. Handle in `content.js` with null-checks for `response.data` structure

### Updating DOM Selectors (LeetCode UI Changes)
1. Open failing problem page in Chrome
2. Open DevTools → Elements tab
3. Find the new selector for code/language/title/description
4. Add to `*_SELECTORS` array in `content.js`
5. Test `document.querySelector()` in console
6. Reload extension and test full flow

### Adding New Sidebar UI
1. Build in `injectUI()` (content.js) using `document.createElement()`
2. Scope all IDs/classes to `lr-*`
3. Add CSS to `styles.css` with `#lr-*` prefix
4. Attach event listeners via `addEventListener()`
5. Sanitize any user-facing text with `textContent` instead of `innerHTML`

### Debugging Message Passing
- Check `chrome://extensions` → Leet Rater → Errors (both content script and service worker logs)
- Add `console.log()` in both `content.js` and `background.js`
- Verify message action string matches exactly (`'rateCode'`)
- Ensure `return true` in message listener to keep port open for async responses

## Persistence & Storage

The extension only stores one thing: the Groq API key.

```javascript
// Save
await chrome.storage.local.set({ groqApiKey: userInput })

// Retrieve
const { groqApiKey } = await chrome.storage.local.get('groqApiKey')
```

No analytics, no server calls beyond Groq, no tracking.

## Known Limitations

1. **DOM changes**: LeetCode frequently updates class names and selectors. If sidebar doesn't appear or code isn't scraped, selectors need updating.
2. **Rate limits**: Groq free tier has per-minute limits. Extension auto-retries once; user must wait 10–15 seconds for manual retry.
3. **Large code submissions**: Groq API has token limits. Solutions >2000 lines may be truncated.
4. **JSON repair**: The 3-pass parser handles most malformed JSON, but extremely broken responses may still fail. Fall back to user seeing "Unexpected error" and checking logs.

## Testing Checklist Before Shipping

- [ ] Sidebar injects on `/problems/` URLs
- [ ] Code scraping works for all supported languages (Python3, C++, Java, JS, etc.)
- [ ] Problem title & description scrape correctly
- [ ] "Analyze" button sends correct message to service worker
- [ ] Groq API call succeeds with valid key
- [ ] JSON parsing handles real messy responses (check logs)
- [ ] Criteria cards render without styling leaks to page
- [ ] "No API key" error message shows if key missing
- [ ] Rate limit error retries or shows user message
- [ ] Sidebar toggle works (open/close with tab)
- [ ] Extension reloads don't break message passing
- [ ] CSS doesn't overflow or cover editor

## File Modification Notes

- `background.js` & `content.js`: Main logic. Both require extension reload after edits.
- `styles.css`: Changes visible after page refresh (no reload needed).
- `manifest.json`: Changes require full extension reload.
- `settings.html` / `settings.js`: Changes visible after reopening popup.

No transpilation, no bundling. Edit → Save → Reload extension → Test.
