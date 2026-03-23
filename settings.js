'use strict';

/**
 * Leet Rater — settings.js
 *
 * Handles: API key load/save, show/hide toggle, status card update.
 * All chrome.* calls are guarded — settings popup can open before
 * the service worker wakes, making chrome.runtime temporarily unavailable.
 */

const apiKey  = document.getElementById('api-key');
const toggleV = document.getElementById('toggle-vis');
const saveBtn = document.getElementById('save-btn');
const status  = document.getElementById('status');
const keyCard = document.getElementById('key-card');
const keyDot  = document.getElementById('key-dot');
const keyTitle= document.getElementById('key-card-title');
const keySub  = document.getElementById('key-card-sub');

// ── Load saved key on popup open ──────────────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get('groqApiKey', data => {
    if (data.groqApiKey) {
      apiKey.value    = data.groqApiKey;
      saveBtn.textContent = 'Update API Key';
      setCard(true);
    }
  });
}

// ── Show / Hide toggle ────────────────────────────────────────────────────────
toggleV.addEventListener('click', () => {
  const isHidden   = apiKey.type === 'password';
  apiKey.type      = isHidden ? 'text' : 'password';
  toggleV.textContent = isHidden ? 'Hide' : 'Show';
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const key = apiKey.value.trim();

  if (!key) {
    showStatus('error', 'Please enter your Groq API key.');
    return;
  }

  if (!key.startsWith('gsk_') || key.length < 20) {
    showStatus('error', "Invalid key — Groq keys start with 'gsk_'.");
    return;
  }

  if (typeof chrome === 'undefined' || !chrome.storage) {
    showStatus('error', 'Extension error. Please reload the popup.');
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving\u2026';

  chrome.storage.local.set({ groqApiKey: key }, () => {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Update API Key';
    setCard(true);
    showStatus('success', '✓ API key saved — you can now analyze solutions.');

    // Notify background service worker.
    // Wrapped in try/catch because chrome.runtime can be undefined
    // in MV3 when the service worker is inactive.
    try {
      if (chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'settingsUpdated' }, () => {
          void chrome.runtime.lastError; // intentionally consumed
        });
      }
    } catch {
      // Service worker asleep — safe to ignore, key is already persisted
    }
  });
});

// ── Status card ───────────────────────────────────────────────────────────────
function setCard(saved) {
  keyCard.className       = saved ? 'key-card saved' : 'key-card';
  keyDot.className        = saved ? 'key-dot saved'  : 'key-dot';
  keyTitle.textContent    = saved ? 'API key saved'   : 'No API key saved';
  keySub.textContent      = saved ? 'Ready to analyze code' : 'Required to analyze code';
}

// ── Status message ────────────────────────────────────────────────────────────
let statusTimer = null;
function showStatus(type, msg) {
  clearTimeout(statusTimer);
  status.textContent   = msg;
  status.className     = 'status ' + type;
  status.style.display = 'block';
  statusTimer = setTimeout(() => { status.style.display = 'none'; }, 4500);
}