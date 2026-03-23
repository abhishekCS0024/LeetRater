/**
 * Leet Rater — content.js
 *
 * Responsibilities:
 *  1. Detect when LeetCode's Monaco editor is ready
 *  2. Inject a collapsible sidebar panel (tab injected separately as a fixed element)
 *  3. Scrape problem description + user code on demand
 *  4. Send to background.js and render the structured response
 *
 * Design decisions:
 *  - Tab is a separate body element (position:fixed) — never overlaps the editor
 *  - All API strings are sanitized before innerHTML insertion
 *  - Null-safe throughout: no crash if API returns unexpected structure
 *  - buildCard() is module-level, not nested — avoids strict-mode SyntaxError
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const EDITOR_SELECTORS = [
  '.view-lines',
  '.CodeMirror',
  '[data-mode-id]',
  '.monaco-editor',
  'textarea.inputarea',
].join(', ');

const LANG_SELECTORS = [
  "[id^='headlessui-listbox-button'] span",
  "[id^='headlessui-listbox-button']",
  '.cursor-pointer.rounded.px-3.py-1',
  "[data-cy='lang-select']",
  '.ant-select-selection-item',
];

const KNOWN_LANGS = ['C++','Python3','Python','Java','JavaScript','TypeScript','C','C#','Go','Rust','Swift','Kotlin','Ruby','Scala'];

const TITLE_SELECTORS = [
  "[data-cy='question-title']",
  '.mr-2.text-lg.font-medium',
  '.text-title-large',
  'h1',
];

const DESC_SELECTORS = [
  "[data-track-load='description_content']",
  '.elfjS',
  '.question-content__JfgR',
  '.content__u3I1',
  "[class*='description']",
];

// ─── Init ─────────────────────────────────────────────────────────────────────

(function init() {
  if (isEditorReady()) {
    injectUI();
    return;
  }

  let injected = false;
  const observer = new MutationObserver(() => {
    if (!injected && isEditorReady()) {
      injected = true;
      observer.disconnect();
      injectUI();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Hard fallback — inject after 3 s regardless
  setTimeout(() => {
    if (!injected) {
      injected = true;
      observer.disconnect();
      injectUI();
    }
  }, 3000);
})();

function isEditorReady() {
  return !!document.querySelector(EDITOR_SELECTORS);
}

// ─── UI Injection ─────────────────────────────────────────────────────────────

function injectUI() {
  if (document.getElementById('lr-sidebar')) return;

  // ── Tab: independent fixed element, never inside sidebar ──
  // Sits at right: 0 when closed, shifts to right: var(--lr-panel-width) when open
  const tab = document.createElement('div');
  tab.id        = 'lr-tab';
  tab.title     = 'Leet Rater';
  tab.innerHTML = '<span id="lr-tab-icon">&#9889;</span>';
  document.body.appendChild(tab);

  // ── Sidebar panel ──
  const sidebar = document.createElement('div');
  sidebar.id = 'lr-sidebar';
  sidebar.classList.add('lr-collapsed');
  sidebar.innerHTML = `
    <div id="lr-panel">

      <div id="lr-header">
        <span id="lr-title">&#9889; LEET RATER</span>
        <button id="lr-close" title="Close" aria-label="Close sidebar">&#10005;</button>
      </div>

      <button id="lr-analyze-btn" aria-label="Analyze my solution">
        <span id="lr-btn-text">Analyze my solution</span>
      </button>

      <div id="lr-results" class="lr-hidden" role="region" aria-label="Analysis results">

        <div id="lr-verdict" class="lr-card" role="status"></div>

        <div class="lr-card">
          <div class="lr-section-title">Score Breakdown</div>
          <div id="lr-score-table"></div>
          <div id="lr-final-score"></div>
        </div>

        <div class="lr-card">
          <div class="lr-section-title">Point by Point</div>
          <div id="lr-explanations"></div>
        </div>

        <div class="lr-card lr-tip-card">
          <div class="lr-section-title">Language Tip</div>
          <div id="lr-lang-tip"></div>
        </div>

        <div class="lr-card lr-optimal-card">
          <div class="lr-section-title">Optimal Approach</div>
          <div id="lr-optimal"></div>
        </div>

      </div>

      <div id="lr-error" class="lr-hidden lr-error-box" role="alert"></div>

    </div>
  `;
  document.body.appendChild(sidebar);

  attachListeners(tab, sidebar);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function attachListeners(tab, sidebar) {
  tab.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('lr-collapsed');
    tab.classList.toggle('lr-open', !collapsed);
  });

  document.getElementById('lr-close').addEventListener('click', () => {
    sidebar.classList.add('lr-collapsed');
    tab.classList.remove('lr-open');
  });

  document.getElementById('lr-analyze-btn').addEventListener('click', handleAnalyze);
}

// ─── Analyze Handler ──────────────────────────────────────────────────────────

async function handleAnalyze() {
  const btn      = document.getElementById('lr-analyze-btn');
  const btnText  = document.getElementById('lr-btn-text');
  const results  = document.getElementById('lr-results');
  const errorBox = document.getElementById('lr-error');

  // Reset state
  results.classList.add('lr-hidden');
  errorBox.classList.add('lr-hidden');
  btn.disabled    = true;
  btnText.textContent = 'Analyzing\u2026';

  try {
    const { code, language }     = scrapeCode();
    const { title, description } = scrapeProblem();

    if (!code || code.trim().length < 5) {
      throw new Error('No code found. Please write your solution first.');
    }

    const response = await sendMessage({ action: 'rateCode', code, language, title, description });

    if (!response.ok) throw new Error(response.error || 'Unknown error from background.');

    if (response.data?.isValidationError) {
      renderValidationError(response.data);
    } else {
      renderRating(response.data);
    }

    results.classList.remove('lr-hidden');

  } catch (err) {
    errorBox.textContent = '\u26A0 ' + err.message;
    errorBox.classList.remove('lr-hidden');
    console.error('[LeetRater] Analysis failed:', err);
  } finally {
    btn.disabled    = false;
    btnText.textContent = 'Analyze again';
  }
}

// ─── Scraping ─────────────────────────────────────────────────────────────────

function scrapeCode() {
  // Method A: Monaco view lines
  const viewLines = document.querySelectorAll('.view-lines .view-line');
  if (viewLines.length > 0) {
    return { code: Array.from(viewLines).map(l => l.innerText).join('\n'), language: scrapeLanguage() };
  }
  // Method B: CodeMirror
  const cmLines = document.querySelectorAll('.CodeMirror-line');
  if (cmLines.length > 0) {
    return { code: Array.from(cmLines).map(l => l.innerText).join('\n'), language: scrapeLanguage() };
  }
  // Method C: Monaco hidden textarea
  const textarea = document.querySelector('textarea.inputarea');
  if (textarea?.value) {
    return { code: textarea.value, language: scrapeLanguage() };
  }
  throw new Error('Could not read your code. Make sure you are on a LeetCode problem page.');
}

function scrapeLanguage() {
  for (const sel of LANG_SELECTORS) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) return el.innerText.trim();
  }
  // Last resort: scan all buttons
  for (const btn of document.querySelectorAll('button')) {
    const text = btn.innerText.trim();
    if (KNOWN_LANGS.some(l => text.startsWith(l))) return text;
  }
  return 'unknown';
}

function scrapeProblem() {
  let title = 'Unknown Problem';
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) { title = el.innerText.trim(); break; }
  }

  let description = 'No description found.';
  for (const sel of DESC_SELECTORS) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) {
      description = el.innerText.trim().slice(0, 2000); // cap to save tokens
      break;
    }
  }

  return { title, description };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escapes HTML special chars — preserves emoji and unicode */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strips leading emoji from group names to prevent \U{} rendering bugs */
function cleanGroup(name) {
  return (name || 'General')
    .replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s\u26A1\u2699\uFE0F]+/gu, '')
    .trim();
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Render: Validation Error ─────────────────────────────────────────────────

function renderValidationError(data) {
  document.getElementById('lr-sidebar').dataset.scoreTier = 'low';

  document.getElementById('lr-verdict').innerHTML =
    `<div class="lr-val-header">
       <span class="lr-val-icon">${sanitize(data.errorIcon || '⚠')}</span>
       <div>
         <div class="lr-val-label">${sanitize(data.errorLabel || 'Code Issue')}</div>
         <div class="lr-val-summary">${sanitize(data.errorSummary || '')}</div>
       </div>
     </div>`;

  document.getElementById('lr-score-table').innerHTML =
    `<div class="lr-score-base"><span>Base score</span><span>10</span></div>
     <div class="lr-divider"></div>
     <div class="lr-val-blocked">
       <span class="lr-val-blocked-label">Rating blocked</span>
       <span class="lr-val-blocked-badge">Fix errors first</span>
     </div>`;

  document.getElementById('lr-final-score').innerHTML =
    `<div class="lr-divider"></div>
     <div class="lr-final-row">
       <span>Final score</span>
       <span class="lr-score-badge lr-score-invalid">&#8212;&nbsp;/&nbsp;10</span>
     </div>`;

  const lines = Array.isArray(data.errorLines) ? data.errorLines : [];
  let expHTML = '<div class="lr-section-label lr-label-deducted">Issues in your code</div>';
  if (lines.length > 0) {
    expHTML += lines.map(err =>
      `<div class="lr-error-line">
         <div class="lr-error-line-header">
           <span class="lr-error-line-num">Line ${sanitize(String(err.line || '?'))}</span>
           <span class="lr-error-line-issue">${sanitize(err.issue || '')}</span>
         </div>
         ${err.code ? `<div class="lr-error-line-code">${sanitize(err.code)}</div>` : ''}
       </div>`
    ).join('');
  } else {
    expHTML += `<div class="lr-exp-body">${sanitize(data.errorSummary || 'Unknown error.')}</div>`;
  }
  document.getElementById('lr-explanations').innerHTML = expHTML;

  document.getElementById('lr-lang-tip').innerHTML = data.suggestion
    ? `<div class="lr-val-suggestion">
         <span class="lr-suggestion-label">How to fix</span>
         <div class="lr-exp-fix">${sanitize(data.suggestion)}</div>
       </div>`
    : `<div class="lr-body-text lr-muted">Fix the error above and try again.</div>`;

  document.getElementById('lr-optimal').innerHTML =
    `<div class="lr-body-text lr-muted">Rating unavailable until errors are resolved.</div>`;
}

// ─── Render: Rating ───────────────────────────────────────────────────────────

function renderRating(data) {
  // Guard — never crash if API returns unexpected structure
  if (!data || !Array.isArray(data.criteriaScores) || data.criteriaScores.length === 0) {
    document.getElementById('lr-verdict').innerHTML =
      '<span class="lr-quote lr-error-text">Rating data is incomplete. Please try again.</span>';
    return;
  }

  const sidebar = document.getElementById('lr-sidebar');
  sidebar.dataset.scoreTier = data.finalScore >= 8 ? 'high' : data.finalScore >= 5 ? 'mid' : 'low';

  // ① Category badge + verdict
  const catBadge = data.detectedCategory
    ? `<div class="lr-category-badge">
         <span class="lr-category-icon">&#127919;</span>
         <span class="lr-category-name">${sanitize(data.detectedCategory)}</span>
       </div>
       ${data.categoryRationale ? `<div class="lr-category-rationale">${sanitize(data.categoryRationale)}</div>` : ''}`
    : '';

  document.getElementById('lr-verdict').innerHTML =
    catBadge + `<span class="lr-quote">&ldquo;${sanitize(data.verdict)}&rdquo;</span>`;

  // ② Score breakdown — grouped, emoji stripped from group names
  const groups = {};
  data.criteriaScores.forEach(c => {
    const key = cleanGroup(c.group);
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });

  let tableHTML = `<div class="lr-score-base"><span>Base score</span><span>10</span></div>
                   <div class="lr-divider"></div>`;
  for (const [group, criteria] of Object.entries(groups)) {
    tableHTML += `<div class="lr-group-label">${sanitize(group)}</div>`;
    tableHTML += criteria.map(c => {
      const cls  = c.status === 'full' ? 'lr-score-full' : c.status === 'partial' ? 'lr-score-partial' : 'lr-score-lost';
      const text = c.status === 'full' ? '&#10003;&nbsp;1' : c.status === 'partial' ? '&frac12;' : '&#10007;&nbsp;0';
      return `<div class="lr-criteria-row">
                <span class="lr-criteria-num">${sanitize(String(c.number))}</span>
                <span class="lr-criteria-name">${sanitize(c.criterion)}</span>
                <span class="lr-criteria-score ${cls}">${text}</span>
              </div>`;
    }).join('');
  }
  document.getElementById('lr-score-table').innerHTML = tableHTML;

  document.getElementById('lr-final-score').innerHTML =
    `<div class="lr-divider"></div>
     <div class="lr-final-row">
       <span>Final score</span>
       <span class="lr-score-badge">${data.finalScore}&nbsp;/&nbsp;10</span>
     </div>`;

  // ③ Point-by-point — earned first, deductions after
  const earned   = data.criteriaScores.filter(c => c.status === 'full');
  const deducted = data.criteriaScores.filter(c => c.status !== 'full');

  let expHTML = '';
  if (earned.length > 0) {
    expHTML += '<div class="lr-section-label lr-label-earned">&#10003; Points you earned</div>';
    expHTML += earned.map(c => buildCard(c, data.deductions)).join('');
  }
  if (deducted.length > 0) {
    expHTML += '<div class="lr-section-label lr-label-deducted">&#10007; Where points were lost</div>';
    expHTML += deducted.map(c => buildCard(c, data.deductions)).join('');
  }
  document.getElementById('lr-explanations').innerHTML = expHTML;

  // ④ ⑤ Language tip + optimal
  document.getElementById('lr-lang-tip').innerHTML =
    `<div class="lr-body-text">${sanitize(data.languageTip || '')}</div>`;
  document.getElementById('lr-optimal').innerHTML =
    `<div class="lr-body-text">${sanitize(data.optimalApproach || '')}</div>`;
}

// ─── Build Criterion Card ─────────────────────────────────────────────────────

/**
 * Module-level (not nested inside renderRating) to avoid
 * nested function declaration issues in strict mode.
 */
function buildCard(c, deductions) {
  const ded   = (deductions || []).find(d => d.criterion === c.criterion);
  const lost  = +(1 - c.earned).toFixed(1);
  const delta = c.status === 'full'    ? '+1'
              : c.status === 'partial' ? '&#8722;0.5'
              : `&#8722;${lost}`;
  const badge = c.status === 'full'    ? 'lr-badge-full'
              : c.status === 'partial' ? 'lr-badge-partial'
              : 'lr-badge-lost';

  return `<div class="lr-exp lr-exp-${c.status}">
            <div class="lr-exp-header">
              <span class="lr-exp-num">${sanitize(String(c.number))}</span>
              <span class="lr-exp-criterion">${sanitize(c.criterion)}</span>
              <span class="lr-exp-badge ${badge}">${delta}</span>
            </div>
            <div class="lr-exp-body">${sanitize(c.comment || '')}</div>
            ${ded?.fix ? `<div class="lr-exp-fix">Fix &#8594; ${sanitize(ded.fix)}</div>` : ''}
          </div>`;
}