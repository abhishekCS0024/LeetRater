// ─────────────────────────────────────────────
//  LeetCode Code Rater — settings.js
// ─────────────────────────────────────────────

const pilotToggle    = document.getElementById("pilot-toggle");
const apiKeyInput    = document.getElementById("api-key-input");
const toggleVis      = document.getElementById("toggle-visibility");
const saveBtn        = document.getElementById("save-btn");
const statusMsg      = document.getElementById("status-msg");

// ── Load saved settings on open ───────────────
chrome.storage.local.get(["groqApiKey", "pilotMode"], (data) => {
  pilotToggle.checked = data.pilotMode !== false; // default: pilot ON
  apiKeyInput.value   = data.groqApiKey || "";
  updateSaveLabel();
});

// ── Toggle key visibility ─────────────────────
toggleVis.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type    = isPassword ? "text" : "password";
  toggleVis.textContent = isPassword ? "Hide" : "Show";
});

// ── Pilot toggle changes save label ──────────
pilotToggle.addEventListener("change", updateSaveLabel);

function updateSaveLabel() {
  saveBtn.textContent = pilotToggle.checked
    ? "Save settings (pilot mode on)"
    : "Save settings";
}

// ── Save ──────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const key    = apiKeyInput.value.trim();
  const isPilot = pilotToggle.checked;

  if (!isPilot && !key) {
    showStatus("error", "Please enter a Groq API key, or enable pilot mode.");
    return;
  }

  // Validate Groq key format — must start with "gsk_" and be at least 20 chars
  if (!isPilot && (!key.startsWith("gsk_") || key.length < 20)) {
    showStatus("error", "Invalid key format. Groq keys start with 'gsk_'.");
    return;
  }

  chrome.storage.local.set(
    { groqApiKey: key, pilotMode: isPilot },
    () => {
      // Also notify background.js to pick up the new settings
      chrome.runtime.sendMessage({ action: "settingsUpdated", pilotMode: isPilot });
      showStatus("success", isPilot
        ? "Saved! Running in pilot mode."
        : "API key saved. Pilot mode disabled."
      );
    }
  );
});

// ── Show status message ───────────────────────
function showStatus(type, message) {
  statusMsg.textContent  = message;
  statusMsg.className    = `status ${type}`;
  statusMsg.style.display = "block";
  setTimeout(() => { statusMsg.style.display = "none"; }, 3000);
}