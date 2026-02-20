async function run(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { t: "RUN_CONVERT" });
  } catch {
    // Content script not loaded (e.g. tab opened before install, or extension reloaded).
    // Inject programmatically and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"]
      });
      // Brief delay for the script to initialize its message listener
      await new Promise(r => setTimeout(r, 150));
      await chrome.tabs.sendMessage(tabId, { t: "RUN_CONVERT" });
    } catch (e) {
      console.warn("[Notion Eq] Could not run conversion:", e.message);
    }
  }
}

chrome.commands.onCommand.addListener(async c => {
  if (c !== "convert_inline_equations") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  run(tab.id);
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;
  run(tab.id);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "convert_inline_equations",
    title: "Convert $…$ to inline equations",
    contexts: ["all"],
    documentUrlPatterns: ["https://www.notion.so/*", "https://*.notion.site/*"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "convert_inline_equations") return;
  if (!tab?.id) return;
  run(tab.id);
});
