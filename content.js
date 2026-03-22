// ─────────────────────────────────────────────
//  LeetCode Code Rater — content.js
//  Injects sidebar + scrapes problem & code
// ─────────────────────────────────────────────

// ── 1. Inject sidebar into the page ──────────

function injectSidebar() {
  // Don't inject twice
  if (document.getElementById("lcr-sidebar")) return;
  if (document.getElementById("lcr-tab")) return;

  const sidebar = document.createElement("div");
  sidebar.id = "lcr-sidebar";
  sidebar.classList.add("lcr-collapsed");

  sidebar.innerHTML = `
    <!-- Sidebar content -->
    <div id="lcr-panel">

      <!-- Header -->
      <div id="lcr-header">
        <span id="lcr-title">Code Rater</span>
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

  // Tab is injected separately as a fixed element so it
  // never overlaps the editor when the sidebar is collapsed
  const tab = document.createElement("div");
  tab.id = "lcr-tab";
  tab.title = "LeetCode Code Rater";
  tab.innerHTML = '<span id="lcr-tab-icon">⚡</span>';
  document.body.appendChild(tab);

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
    const isCollapsed = sidebar.classList.toggle("lcr-collapsed");
    tab.classList.toggle("lcr-open", !isCollapsed);
  });

  closeBtn.addEventListener("click", () => {
    sidebar.classList.add("lcr-collapsed");
    tab.classList.remove("lcr-open");
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

    renderResults(response.data);
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


// ── 6. Render results into sidebar ───────────

function renderResults(data) {

  // Set score tier on sidebar for CSS color variables
  const sidebar = document.getElementById('lcr-sidebar');
  const tier = data.finalScore >= 8 ? 'high' : data.finalScore >= 5 ? 'mid' : 'low';
  sidebar.dataset.scoreTier = tier;

  // ① One-liner verdict
  document.getElementById("lcr-verdict").innerHTML =
    '<span class="lcr-quote">"' + data.verdict + '"</span>';

  // ② Score breakdown — grouped criteria table
  const groups = {};
  data.criteriaScores.forEach(function(c) {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const tableEl = document.getElementById("lcr-score-table");
  let tableHTML = '<div class="lcr-score-base"><span>Base score</span><span>10</span></div><div class="lcr-divider"></div>';

  for (const group in groups) {
    tableHTML += '<div class="lcr-group-label">' + group + '</div>';
    groups[group].forEach(function(c) {
      const scoreClass = c.status === "full" ? "lcr-score-full" : "lcr-score-lost";
      const scoreText  = c.status === "full" ? "✓ 1" : c.earned === 0.5 ? "½" : "✗ 0";
      tableHTML += '<div class="lcr-criteria-row">'
        + '<span class="lcr-criteria-num">' + c.number + '</span>'
        + '<span class="lcr-criteria-name">' + c.criterion + '</span>'
        + '<span class="lcr-criteria-score ' + scoreClass + '">' + scoreText + '</span>'
        + '</div>';
    });
  }
  tableEl.innerHTML = tableHTML;

  document.getElementById("lcr-final-score").innerHTML =
    '<div class="lcr-divider"></div>'
    + '<div class="lcr-final-row">'
    + '<span>Final score</span>'
    + '<span class="lcr-score-badge">' + data.finalScore + ' / 10</span>'
    + '</div>';


  // ③ Per-criterion explanations — earned FIRST, deductions after
  const expEl = document.getElementById("lcr-explanations");

  const earned   = data.criteriaScores.filter(function(c) { return c.status === "full"; });
  const deducted = data.criteriaScores.filter(function(c) { return c.status !== "full"; });

  function renderCriterion(c) {
    const ded = (data.deductions || []).find(function(d) { return d.criterion === c.criterion; });
    const lost = (1 - c.earned);
    const delta = c.status === "full" ? "+1" : (c.earned === 0.5 ? "+0.5" : "-" + lost);
    const badgeClass = c.status === "full" ? "lcr-badge-full" : "lcr-badge-lost";
    return '<div class="lcr-explanation lcr-exp-' + c.status + '">'
      + '<div class="lcr-exp-header">'
      + '<span class="lcr-exp-num">' + c.number + '</span>'
      + '<span class="lcr-exp-criterion">' + c.criterion + '</span>'
      + '<span class="lcr-exp-badge ' + badgeClass + '">' + delta + '</span>'
      + '</div>'
      + '<div class="lcr-exp-body">' + c.comment + '</div>'
      + (ded && ded.fix ? '<div class="lcr-exp-fix">Fix → ' + ded.fix + '</div>' : '')
      + '</div>';
  }

  let expHTML = "";

  if (earned.length > 0) {
    expHTML += '<div class="lcr-exp-section-label lcr-label-earned">✓ Points you earned</div>';
    earned.forEach(function(c) { expHTML += renderCriterion(c); });
  }

  if (deducted.length > 0) {
    expHTML += '<div class="lcr-exp-section-label lcr-label-deducted">✗ Where points were lost</div>';
    deducted.forEach(function(c) { expHTML += renderCriterion(c); });
  }

  expEl.innerHTML = expHTML;


  // ④ Language tip
  document.getElementById("lcr-lang-tip").innerHTML =
    '<div class="lcr-body-text">' + data.languageTip + '</div>';

  // ⑤ Optimal approach
  document.getElementById("lcr-optimal").innerHTML =
    '<div class="lcr-body-text">' + data.optimalApproach + '</div>';
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