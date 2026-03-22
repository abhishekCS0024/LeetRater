# ⚡ LeetCode Code Rater

A Chrome extension that rates your LeetCode solution out of 10
with detailed, constructive feedback — like a senior dev reviewing your PR.

---

## 📁 File Structure

```
leetcode-rater/
├── manifest.json     ← Extension config & permissions
├── content.js        ← Injects sidebar + scrapes code & problem
├── styles.css        ← Dark sidebar UI (LeetCode-matched theme)
├── background.js     ← Service worker: prompt builder + API call
├── settings.html     ← Popup: pilot toggle + Groq API key input
├── settings.js       ← Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🚀 How to load in Chrome (Developer Mode)

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `leetcode-rater/` folder
5. The extension appears in your toolbar

> ⚠ You need actual PNG icon files in the `icons/` folder.
> For testing, create 3 plain 16×16, 48×48, 128×128 orange square PNGs,
> or remove the `icons` block from manifest.json temporarily.

---

## 🧪 Testing in Pilot Mode (no API key needed)

1. Open any LeetCode problem, e.g.:
   `https://leetcode.com/problems/two-sum/`
2. Write any solution in the editor
3. You'll see an orange **⚡ tab** on the right edge of the screen
4. Click it to open the sidebar
5. Click **"Analyze my solution"**
6. After ~2 seconds you'll see the full mock rating

The mock response simulates a real rating with:
- A one-liner verdict
- 3 deductions with explanations and fix hints
- A language tip
- An optimal approach description

---

## 🔑 Switching to real Groq API (when ready)

1. Get a free API key at: https://console.groq.com/keys
2. Click the extension icon in the Chrome toolbar
3. In the settings popup:
   - Toggle **Pilot mode OFF**
   - Paste your Groq API key
   - Click **Save settings**
4. Go back to LeetCode and analyze — it now calls the real API

The model used is `llama-3.3-70b-versatile` — fast, free tier available,
and highly capable for code review tasks.

---

## 🧠 Scoring Rubric (10 points)

| # | Category | Criterion |
|---|----------|-----------|
| 1 | 🧠 Understanding | Problem understanding |
| 2 | 🧠 Understanding | Approach selection |
| 3 | ⚙️ Implementation | Correctness |
| 4 | ⚙️ Implementation | Edge case handling |
| 5 | ⚙️ Implementation | Efficiency awareness |
| 6 | 🧹 Craftsmanship | Code clarity |
| 7 | 🧹 Craftsmanship | Variable naming |
| 8 | 🧹 Craftsmanship | Modularity |
| 9 | 🧩 Technical Depth | Language usage |
| 10 | 🧩 Technical Depth | Best practices |

---

## 🗺 What's next (future ideas)

- [ ] Rating history saved per problem
- [ ] Hint mode (suggestions without spoiling the approach)
- [ ] Support for LeetCode's dark/light theme detection
- [ ] Export feedback as markdown notes

---

## ⚙️ Troubleshooting

**Sidebar doesn't appear?**
→ Make sure you're on a `/problems/` URL, not the explore page.
→ Try refreshing the page — the MutationObserver has a 3s fallback.

**"Could not read your code" error?**
→ Write at least a few lines of code in the editor before analyzing.
→ LeetCode sometimes changes their DOM — open an issue.

**API errors?**
→ Check your Groq key is correct and has remaining quota.
→ Make sure pilot mode is OFF in settings.
