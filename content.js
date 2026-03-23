// ─────────────────────────────────────────────
//  LeetCode Code Rater — content.js
//  Injects sidebar + scrapes problem & code
// ─────────────────────────────────────────────

// ── 1. Inject sidebar into the page ──────────

function injectSidebar() {
  // Don't inject twice
  if (document.getElementById("lcr-sidebar")) return;

  const sidebar = document.createElement("div");
  sidebar.id = "lcr-sidebar";
  sidebar.classList.add("lcr-collapsed");

  sidebar.innerHTML = `
    <!-- Toggle tab (always visible) -->
    <div id="lcr-tab" title="LeetCode Leet Rater">
      <span id="lcr-tab-icon">⚡</span>
    </div>

    <!-- Sidebar content -->
    <div id="lcr-panel">

      <!-- Header -->
      <div id="lcr-header">
        <span id="lcr-title">Leet Rater</span>
        <button id="lcr-close" title="Collapse">✕</button>
      </div>

      <!-- Analyze button -->
      <button id="lcr-analyze-btn">
        <span id="lcr-btn-text">Analyze my solution</span>
      </button>

      <!-- Results area (hidden until analysis runs) -->
      <div id="lcr-results" class="lcr-hidden">

        <!-- ① One-liner verdict -->
        <div id="lcr-verdict" class="lcr-card"></div>

        <!-- ② Score breakdown table -->
        <div class="lcr-card">
          <div class="lcr-section-title">Score Breakdown</div>
          <div id="lcr-score-table"></div>
          <div id="lcr-final-score"></div>
        </div>

        <!-- ③ Deduction explanations -->
        <div class="lcr-card">
          <div class="lcr-section-title">Point by point breakdown</div>
          <div id="lcr-explanations"></div>
        </div>

        <!-- ④ Language tip -->
        <div class="lcr-card">
          <div class="lcr-section-title">Language tip</div>
          <div id="lcr-lang-tip"></div>
        </div>

        <!-- ⑤ Optimal approach -->
        <div class="lcr-card">
          <div class="lcr-section-title">Optimal approach</div>
          <div id="lcr-optimal"></div>
        </div>

      </div>

      <!-- Error area -->
      <div id="lcr-error" class="lcr-hidden lcr-error-box"></div>

    </div>
  `;

  document.body.appendChild(sidebar);
  attachEventListeners();
}


// ── 2. Event listeners ────────────────────────

function attachEventListeners() {
  const tab      = document.getElementById("lcr-tab");
  const closeBtn = document.getElementById("lcr-close");
  const analyzeBtn = document.getElementById("lcr-analyze-btn");
  const sidebar  = document.getElementById("lcr-sidebar");

  // Toggle open/close
  tab.addEventListener("click", () => {
    sidebar.classList.toggle("lcr-collapsed");
  });

  closeBtn.addEventListener("click", () => {
    sidebar.classList.add("lcr-collapsed");
  });

  // Main action
  analyzeBtn.addEventListener("click", handleAnalyze);
}


// ── 3. Main analyze handler ───────────────────

async function handleAnalyze() {
  const btn     = document.getElementById("lcr-analyze-btn");
  const btnText = document.getElementById("lcr-btn-text");
  const results = document.getElementById("lcr-results");
  const errorBox = document.getElementById("lcr-error");

  // Reset UI
  results.classList.add("lcr-hidden");
  errorBox.classList.add("lcr-hidden");
  btn.disabled = true;
  btnText.textContent = "Analyzing...";

  try {
    const { code, language } = scrapeCode();
    const { title, description } = scrapeProblem();

    if (!code || code.trim().length < 10) {
      throw new Error("No code found. Please write your solution first.");
    }

    // Send to background.js
    const response = await sendMessage({
      action: "rateCode",
      code,
      language,
      title,
      description
    });

    if (response.error) throw new Error(response.error);

    // BUG 2 FIX: if background returns a validation error, show error UI — not rating
    if (response.data && response.data.isValidationError) {
      renderValidationError(response.data);
    } else {
      renderResults(response.data);
    }
    results.classList.remove("lcr-hidden");

  } catch (err) {
    errorBox.textContent = "⚠ " + err.message;
    errorBox.classList.remove("lcr-hidden");
  } finally {
    btn.disabled = false;
    btnText.textContent = "Analyze again";
  }
}


// ── 4. Scrape user's code ─────────────────────

function scrapeCode() {
  // LeetCode uses Monaco editor — code lives in .view-line elements
  // Strategy: try multiple selectors as LeetCode updates their DOM often

  // Method A: Monaco view lines (most reliable)
  const viewLines = document.querySelectorAll(".view-lines .view-line");
  if (viewLines.length > 0) {
    const code = Array.from(viewLines)
      .map(line => line.innerText)
      .join("\n");

    const language = scrapeLanguage();
    return { code, language };
  }

  // Method B: CodeMirror fallback
  const cmLines = document.querySelectorAll(".CodeMirror-line");
  if (cmLines.length > 0) {
    const code = Array.from(cmLines)
      .map(line => line.innerText)
      .join("\n");
    return { code, language: scrapeLanguage() };
  }

  // Method C: textarea fallback
  const textarea = document.querySelector("textarea.inputarea");
  if (textarea && textarea.value) {
    return { code: textarea.value, language: scrapeLanguage() };
  }

  throw new Error("Could not read your code. Make sure you're on a problem page.");
}


function scrapeLanguage() {
  const selectors = [
    // New LeetCode UI (2024+)
    "[id^='headlessui-listbox-button'] span",
    "[id^='headlessui-listbox-button']",
    // Toolbar language label
    ".cursor-pointer.rounded.px-3.py-1",
    // Older selectors
    "[data-cy='lang-select']",
    ".ant-select-selection-item",
    // Generic fallback: any button near the editor containing a lang name
    "button[class*='lang']",
  ];

  const langs = ["C++","Python3","Python","Java","JavaScript","TypeScript",
                  "C","C#","Go","Rust","Swift","Kotlin","Ruby","Scala"];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim()) return el.innerText.trim();
  }

  // Last resort: scan all buttons for a known language name
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    const text = btn.innerText.trim();
    if (langs.some(l => text.startsWith(l))) return text;
  }

  return "unknown";
}


// ── 5. Scrape problem description ────────────

function scrapeProblem() {
  // Problem title — try multiple selectors (LeetCode changes these often)
  const titleSelectors = [
    "[data-cy='question-title']",
    ".mr-2.text-lg.font-medium",
    ".text-title-large",
    "h1",
  ];
  let title = "Unknown Problem";
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim()) { title = el.innerText.trim(); break; }
  }

  // Problem description
  const descSelectors = [
    "[data-track-load='description_content']",
    ".elfjS",                   // 2024 LeetCode class
    ".question-content__JfgR",
    ".content__u3I1",
    "[class*='description']",
  ];
  let description = "No description found.";
  for (const sel of descSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim()) {
      description = el.innerText.trim().slice(0, 1500);
      break;
    }
  }

  return { title, description };
}


// ── 6. Helpers + Render functions ────────────

// Sanitize all API strings before innerHTML injection (prevents XSS)
function sanitize(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Renders validation error when code has syntax/compile/logic errors
function renderValidationError(data) {
  const sidebar = document.getElementById("lcr-sidebar");
  sidebar.dataset.scoreTier = "low";

  document.getElementById("lcr-verdict").innerHTML =
    '<div class="lcr-validation-header">'
    + '<span class="lcr-validation-icon">' + sanitize(data.errorIcon || "⚠") + '</span>'
    + '<div>'
    + '<div class="lcr-validation-label">' + sanitize(data.errorLabel || "Code Issue") + '</div>'
    + '<div class="lcr-validation-summary">' + sanitize(data.errorSummary || "") + '</div>'
    + '</div></div>';

  document.getElementById("lcr-score-table").innerHTML =
    '<div class="lcr-score-base"><span>Base score</span><span>10</span></div>'
    + '<div class="lcr-divider"></div>'
    + '<div class="lcr-validation-zero-row">'
    + '<span class="lcr-validation-zero-label">Rating blocked</span>'
    + '<span class="lcr-validation-zero-reason">Fix errors first</span>'
    + '</div>';

  document.getElementById("lcr-final-score").innerHTML =
    '<div class="lcr-divider"></div>'
    + '<div class="lcr-final-row"><span>Final score</span>'
    + '<span class="lcr-score-badge lcr-score-invalid">— / 10</span></div>';

  const lines = Array.isArray(data.errorLines) ? data.errorLines : [];
  let html = '<div class="lcr-exp-section-label lcr-label-deducted">Issues found in your code</div>';
  if (lines.length > 0) {
    lines.forEach(function(err) {
      html += '<div class="lcr-error-line-card">'
        + '<div class="lcr-error-line-header">'
        + '<span class="lcr-error-line-num">Line ' + sanitize(String(err.line || "?")) + '</span>'
        + '<span class="lcr-error-line-issue">' + sanitize(err.issue || "") + '</span>'
        + '</div>'
        + (err.code ? '<div class="lcr-error-line-code">' + sanitize(err.code) + '</div>' : "")
        + '</div>';
    });
  } else {
    html += '<div class="lcr-explanation lcr-exp-deducted"><div class="lcr-exp-body">'
      + sanitize(data.errorSummary || "Unknown error.") + '</div></div>';
  }
  document.getElementById("lcr-explanations").innerHTML = html;

  document.getElementById("lcr-lang-tip").innerHTML = data.suggestion
    ? '<div class="lcr-validation-suggestion">'
      + '<span class="lcr-suggestion-label">How to fix it</span>'
      + '<div class="lcr-exp-fix">' + sanitize(data.suggestion) + '</div></div>'
    : '<div class="lcr-body-text" style="color:var(--lcr-text-muted)">Fix the error above and try again.</div>';

  document.getElementById("lcr-optimal").innerHTML =
    '<div class="lcr-body-text" style="color:var(--lcr-text-muted)">Rating unavailable until errors are resolved.</div>';
}

// Main results renderer — fully null-safe, handles all 7 bugs
function renderResults(data) {

  // BUG 1 FIX: Guard against undefined criteriaScores — the root cause of the crash
  if (!data || !Array.isArray(data.criteriaScores) || data.criteriaScores.length === 0) {
    document.getElementById("lcr-verdict").innerHTML =
      '<span class="lcr-quote" style="color:var(--lcr-red)">Rating data incomplete. Please try again.</span>';
    return;
  }

  const sidebar = document.getElementById("lcr-sidebar");
  sidebar.dataset.scoreTier = data.finalScore >= 8 ? "high" : data.finalScore >= 5 ? "mid" : "low";

  // ① BUG 7 FIX: Category badge + verdict
  const catHTML = data.detectedCategory
    ? '<div class="lcr-category-badge">'
      + '<span class="lcr-category-icon">🎯</span>'
      + '<span class="lcr-category-name">' + sanitize(data.detectedCategory) + '</span></div>'
      + (data.categoryRationale
          ? '<div class="lcr-category-rationale">' + sanitize(data.categoryRationale) + '</div>'
          : "")
    : "";

  document.getElementById("lcr-verdict").innerHTML =
    catHTML + '<span class="lcr-quote">&ldquo;' + sanitize(data.verdict) + '&rdquo;</span>';

  // ② Score breakdown table
  const groups = {};
  data.criteriaScores.forEach(function(c) {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  let tableHTML = '<div class="lcr-score-base"><span>Base score</span><span>10</span></div><div class="lcr-divider"></div>';
  for (const group in groups) {
    tableHTML += '<div class="lcr-group-label">' + sanitize(group) + '</div>';
    groups[group].forEach(function(c) {
      // BUG 3 FIX: correct class for partial (yellow) not lost (red)
      const scoreClass = c.status === "full"    ? "lcr-score-full"
                       : c.status === "partial" ? "lcr-score-partial"
                       : "lcr-score-lost";
      const scoreText  = c.status === "full"    ? "✓ 1"
                       : c.status === "partial" ? "½"
                       : "✗ 0";
      tableHTML += '<div class="lcr-criteria-row">'
        + '<span class="lcr-criteria-num">' + sanitize(String(c.number)) + '</span>'
        + '<span class="lcr-criteria-name">' + sanitize(c.criterion) + '</span>'
        + '<span class="lcr-criteria-score ' + scoreClass + '">' + scoreText + '</span>'
        + '</div>';
    });
  }
  document.getElementById("lcr-score-table").innerHTML = tableHTML;

  document.getElementById("lcr-final-score").innerHTML =
    '<div class="lcr-divider"></div><div class="lcr-final-row"><span>Final score</span>'
    + '<span class="lcr-score-badge">' + data.finalScore + ' / 10</span></div>';

  // ③ Explanations — earned first, then deducted
  const earned   = data.criteriaScores.filter(function(c) { return c.status === "full"; });
  const deducted = data.criteriaScores.filter(function(c) { return c.status !== "full"; });

  function buildCriterionCard(c) {
    const ded  = (data.deductions || []).find(function(d) { return d.criterion === c.criterion; });
    const lost = +(1 - c.earned).toFixed(1);
    // BUG 5 FIX: partial shows "−0.5" not "+0.5"
    const delta = c.status === "full"    ? "+1"
                : c.status === "partial" ? "−0.5"
                : "−" + lost;
    // BUG 4 FIX: correct badge class for partial
    const badgeClass = c.status === "full"    ? "lcr-badge-full"
                     : c.status === "partial" ? "lcr-badge-partial"
                     : "lcr-badge-lost";
    // BUG 6 FIX: sanitize all API strings
    return '<div class="lcr-explanation lcr-exp-' + c.status + '">'
      + '<div class="lcr-exp-header">'
      + '<span class="lcr-exp-num">' + sanitize(String(c.number)) + '</span>'
      + '<span class="lcr-exp-criterion">' + sanitize(c.criterion) + '</span>'
      + '<span class="lcr-exp-badge ' + badgeClass + '">' + delta + '</span></div>'
      + '<div class="lcr-exp-body">' + sanitize(c.comment || "") + '</div>'
      + (ded && ded.fix ? '<div class="lcr-exp-fix">Fix → ' + sanitize(ded.fix) + '</div>' : "")
      + '</div>';
  }

  let expHTML = "";
  if (earned.length > 0) {
    expHTML += '<div class="lcr-exp-section-label lcr-label-earned">✓ Points you earned</div>';
    earned.forEach(function(c) { expHTML += buildCriterionCard(c); });
  }
  if (deducted.length > 0) {
    expHTML += '<div class="lcr-exp-section-label lcr-label-deducted">✗ Where points were lost</div>';
    deducted.forEach(function(c) { expHTML += buildCriterionCard(c); });
  }
  document.getElementById("lcr-explanations").innerHTML = expHTML;

  // ④ Language tip + ⑤ Optimal approach
  document.getElementById("lcr-lang-tip").innerHTML =
    '<div class="lcr-body-text">' + sanitize(data.languageTip || "") + '</div>';
  document.getElementById("lcr-optimal").innerHTML =
    '<div class="lcr-body-text">' + sanitize(data.optimalApproach || "") + '</div>';
}

// ── 7. Chrome message helper ──────────────────

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}


// ── 8. Init — wait for LeetCode SPA to settle ─

// Broad selectors covering old + new LeetCode editor versions
const EDITOR_SELECTORS = [
  ".view-lines",
  ".CodeMirror",
  "[data-mode-id]",
  ".monaco-editor",
  "textarea.inputarea",
].join(", ");

function isEditorReady() {
  return !!document.querySelector(EDITOR_SELECTORS);
}

function init() {
  // Already ready? Inject immediately.
  if (isEditorReady()) {
    injectSidebar();
    return;
  }

  let injected = false;
  const observer = new MutationObserver(() => {
    if (!injected && isEditorReady()) {
      injected = true;
      observer.disconnect();
      injectSidebar();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Hard fallback — inject after 2s regardless of DOM state
  setTimeout(() => {
    if (!injected) {
      injected = true;
      observer.disconnect();
      injectSidebar();
    }
  }, 2000);
}

init();