// content.js — Fully automated $...$ → Notion inline equation converter

// Guard against double initialization (manifest injection + programmatic re-injection)
(function() {
if (window._notionEqConverterInit) return;
window._notionEqConverterInit = true;

const ROOTS = [".notion-page-content", ".notion-frame", "main", "body"];
const HUD_Z = 2147483646;
const STEP_DELAY = 20;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const isEditable = el => !!el && (el.getAttribute("contenteditable") === "true" || el.isContentEditable);
const isCodeCtx = el => el.closest?.(".notion-code-block, pre, code");
const isMathAlready = el => el.closest?.(".notion-equation, .katex");

// --- hotkey detector: real Notion inline-equation (we don't block it)
function isInlineEqHotkey(e) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return e.key === "E" && e.shiftKey && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey;
}

// Programmatically fire Notion's inline equation hotkey (Ctrl/Cmd+Shift+E)
function fireInlineEquationHotkey() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const target = document.activeElement || document.body;
  const opts = {
    key: "E",
    code: "KeyE",
    keyCode: 69,
    which: 69,
    shiftKey: true,
    ctrlKey: !isMac,
    metaKey: isMac,
    altKey: false,
    bubbles: true,
    cancelable: true,
    composed: true
  };
  target.dispatchEvent(new KeyboardEvent("keydown", opts));
  target.dispatchEvent(new KeyboardEvent("keyup", opts));
}

// Collect text nodes containing $
function* textNodes(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.indexOf("$") === -1) return NodeFilter.FILTER_REJECT;
      if (!n.parentElement) return NodeFilter.FILTER_REJECT;
      if (!isEditable(n.parentElement)) return NodeFilter.FILTER_REJECT;
      if (isCodeCtx(n.parentElement)) return NodeFilter.FILTER_REJECT;
      if (isMathAlready(n.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let cur; while ((cur = w.nextNode())) yield cur;
}

// Find $...$ / $$...$$ (with \$ escape)
function findDollarSpans(text) {
  const spans = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    let open = -1, dbl = false;
    for (let j = i; j < n; j++) {
      if (text[j] === "\\") { j++; continue; }
      if (text[j] === "$") { dbl = (j + 1 < n && text[j + 1] === "$"); open = j; break; }
    }
    if (open === -1) break;
    const openLen = dbl ? 2 : 1;

    let k = open + openLen, close = -1;
    for (; k < n; k++) {
      if (text[k] === "\\") { k++; continue; }
      if (text[k] === "$") {
        if (dbl) { if (k + 1 < n && text[k + 1] === "$") { close = k + 2; break; } }
        else { close = k + 1; break; }
      }
    }
    if (close === -1) { i = open + 1; continue; }

    const innerStart = open + openLen;
    const innerEnd = close - (dbl ? 2 : 1);
    if (innerEnd > innerStart) spans.push({ open, innerStart, innerEnd, close, dbl });
    i = close;
  }
  return spans;
}

// HUD + highlight
function makeHUD() {
  let hud = document.getElementById("eq-hud");
  if (hud) return hud;
  hud = document.createElement("div");
  hud.id = "eq-hud";
  Object.assign(hud.style, {
    position: "fixed", top: "8px", right: "8px",
    background: "rgba(20,20,20,0.9)", color: "#fff",
    font: "12px system-ui, sans-serif", padding: "8px 10px",
    borderRadius: "8px", zIndex: String(HUD_Z), pointerEvents: "none",
    boxShadow: "0 2px 12px rgba(0,0,0,0.3)", maxWidth: "360px", lineHeight: "1.4"
  });
  hud.innerHTML =
    "<b>$ → equation</b><br/>" +
    "Auto-converting... Press <b>ESC</b> to stop";
  document.documentElement.appendChild(hud);
  return hud;
}
const hideHUD = () => { const h = document.getElementById("eq-hud"); if (h) h.style.display = "none"; };

function updateHUD(converted, total) {
  const hud = makeHUD();
  hud.innerHTML =
    `<b>$ → equation</b> (${converted}/${total})<br/>` +
    `Auto-converting... Press <b>ESC</b> to stop`;
  hud.style.display = "block";
}

function showDoneHUD(count) {
  const hud = makeHUD();
  hud.innerHTML = `<b>Done!</b> Converted ${count} equation(s).`;
  hud.style.display = "block";
  setTimeout(() => { hud.style.display = "none"; }, 3000);
}

function highlightSelection(range) {
  let box = document.getElementById("eq-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "eq-box";
    Object.assign(box.style, {
      position: "fixed", border: "2px solid #3fb950", borderRadius: "4px",
      background: "transparent", zIndex: String(HUD_Z), pointerEvents: "none"
    });
    document.documentElement.appendChild(box);
  }
  const rects = range.getClientRects();
  if (!rects.length) { box.style.display = "none"; return; }
  const r = rects[0];
  Object.assign(box.style, {
    left: `${r.left - 2}px`, top: `${r.top - 2}px`,
    width: `${r.width + 4}px`, height: `${r.height + 4}px`, display: "block"
  });
}
const hideHighlight = () => { const b = document.getElementById("eq-box"); if (b) b.style.display = "none"; };

// Selection helpers
function focusEditableFrom(node) {
  let el = node.parentElement;
  while (el && !isEditable(el)) el = el.parentElement;
  if (el) el.focus({ preventScroll: true });
  return el;
}
function setSelectionInTextNode(node, start, end) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}
async function deleteSelection() {
  document.execCommand?.("delete");
  const a = document.activeElement;
  a?.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "deleteContent" }));
  await sleep(STEP_DELAY);
}

// Count total equations in the page (used once at start for HUD)
function countEquations() {
  let count = 0;
  const roots = new Set();
  for (const s of ROOTS) document.querySelectorAll(s).forEach(n => roots.add(n));
  if (!roots.size) roots.add(document.body);
  for (const root of roots) {
    for (const tn of textNodes(root)) {
      count += findDollarSpans(tn.nodeValue).length;
    }
  }
  return count;
}

// Find the FIRST equation in the live DOM (fresh scan each time)
function findNextEquation() {
  const roots = new Set();
  for (const s of ROOTS) document.querySelectorAll(s).forEach(n => roots.add(n));
  if (!roots.size) roots.add(document.body);
  for (const root of roots) {
    for (const tn of textNodes(root)) {
      const spans = findDollarSpans(tn.nodeValue);
      if (spans.length) return { tn, span: spans[0] };
    }
  }
  return null;
}

// Guide state
let guide = null;

function stopGuide() {
  if (!guide) return;
  if (guide.retryTimer) clearTimeout(guide.retryTimer);
  if (guide.skipTimer) clearTimeout(guide.skipTimer);
  hideHUD(); hideHighlight();
  window.removeEventListener("keydown", onKey, true);
  if (guide.mo) { guide.mo.disconnect(); guide.mo = null; }
  guide = null;
}

async function goStep() {
  if (!guide) return;
  if (guide.retryTimer) { clearTimeout(guide.retryTimer); guide.retryTimer = null; }
  if (guide.skipTimer) { clearTimeout(guide.skipTimer); guide.skipTimer = null; }

  // Fresh DOM scan — always get a live text node, never a stale reference
  const item = findNextEquation();
  if (!item) {
    const count = guide.converted;
    stopGuide();
    showDoneHUD(count);
    return;
  }

  const { tn } = item;
  const s = findDollarSpans(tn.nodeValue)[0];

  const ed = focusEditableFrom(tn);
  if (!ed) {
    // Safety: prevent infinite loop if a node can't be focused
    guide.consecutiveSkips = (guide.consecutiveSkips || 0) + 1;
    if (guide.consecutiveSkips > 10) { stopGuide(); return; }
    await sleep(50);
    return goStep();
  }
  guide.consecutiveSkips = 0;

  // remove right delimiter first (so left-side offsets stay valid)
  setSelectionInTextNode(tn, s.innerEnd, s.close);
  await deleteSelection();

  // remove left delimiter
  setSelectionInTextNode(tn, s.open, s.innerStart);
  await deleteSelection();

  // select inner expression
  const innerLen = s.innerEnd - s.innerStart;
  const r = setSelectionInTextNode(tn, s.open, s.open + innerLen);
  highlightSelection(r);

  guide.converted++;
  updateHUD(guide.converted, guide.total);

  // arm "auto-advance after Notion wraps as equation"
  armAutoAdvance();

  // Automatically fire the inline equation hotkey
  await sleep(50);
  if (guide) fireInlineEquationHotkey();
}

// Wait until the selection is inside a Notion equation (or equation node appears), then go next
function armAutoAdvance() {
  if (!guide) return;

  // Detect when the selection is inside a rendered equation OR the equation dialog appears.
  function selectionInsideEquation() {
    const sel = window.getSelection();
    const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode) : null;
    return node && (node.closest(".notion-equation") || node.closest(".katex"));
  }

  if (guide.mo) { guide.mo.disconnect(); guide.mo = null; }
  let rafId = null;
  let doneClickedOnce = false;

  guide.mo = new MutationObserver(() => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(async () => {
      if (!guide) return;

      // 1) If the Notion equation dialog is open, auto-click Done
      const dlg = findEquationDialog();
      if (dlg && !doneClickedOnce) {
        const ok = await autoClickDialogDone(dlg);
        if (ok) {
          doneClickedOnce = true;
          // Wait for dialog to close and for Notion to insert the equation
          setTimeout(() => {
            if (guide) goStep();
          }, 150);
          return;
        }
      }

      // 2) Fallback: if Notion rendered inline immediately (no dialog), advance
      if (selectionInsideEquation()) {
        setTimeout(() => { if (guide) goStep(); }, 100);
      }
    });
  });

  guide.mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true
  });

  // Retry hotkey if no conversion detected after 1s
  guide.retryTimer = setTimeout(() => {
    if (guide) fireInlineEquationHotkey();
  }, 1000);

  // Skip this equation if conversion still not detected after 3s
  guide.skipTimer = setTimeout(() => {
    if (guide) goStep();
  }, 3000);
}

// Find the inline equation dialog by looking for a contenteditable editor inside a role="dialog".
function findEquationDialog() {
  const editor = document.querySelector('div[role="dialog"] [contenteditable="true"][data-content-editable-leaf="true"]');
  return editor ? editor.closest('div[role="dialog"]') : null;
}

// Close the equation dialog. Language-agnostic (works with Done, 완료, 完了, etc.)
async function autoClickDialogDone(dialogEl) {
  if (!dialogEl) return false;

  await new Promise(r => setTimeout(r, 20));

  const buttons = Array.from(dialogEl.querySelectorAll('div[role="button"]'));

  // Strategy 1: Match known confirm-button labels across languages
  const confirmLabels = ['done', '완료', '完了', '完成', 'terminé', 'fertig', 'hecho'];
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (confirmLabels.some(label => text.includes(label))) {
      btn.click();
      return true;
    }
  }

  // Strategy 2: Click button that contains an SVG icon (the ↵ enter icon)
  for (const btn of buttons) {
    if (btn.querySelector('svg')) {
      btn.click();
      return true;
    }
  }

  // Strategy 3: Fallback — click the last button (typically the confirm action)
  if (buttons.length) {
    buttons[buttons.length - 1].click();
    return true;
  }

  // Strategy 4: Simulate Enter on the equation input field
  const input = dialogEl.querySelector('[contenteditable="true"]');
  if (input) {
    const enterOpts = {
      key: "Enter", code: "Enter", keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true
    };
    input.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
    input.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
    return true;
  }

  return false;
}

// Key handling: ESC to exit, let Notion hotkey through
function onKey(e) {
  if (!guide) return;

  // Do NOT prevent the real Notion hotkey — we want Notion to receive it.
  if (isInlineEqHotkey(e)) {
    return;
  }

  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

  if (e.key === "Escape") {
    e.preventDefault(); stopGuide();
  }
}

// Start guided run
async function runGuided() {
  if (guide) return; // Already running — prevent duplicate invocation
  const total = countEquations();
  if (!total) return;
  guide = { converted: 0, total, mo: null, consecutiveSkips: 0 };
  window.addEventListener("keydown", onKey, true);
  await goStep();
}

chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m?.t === "RUN_CONVERT") {
    runGuided();
    sendResponse({ ok: true });
  }
});

})(); // end initialization guard
