const MENU_ID = "unload-tab";

// Ceiling: how long to wait for Chrome to report the swapped favicon before
// giving up on the notification. Raising this alone does nothing — see below.
const FAVICON_TIMEOUT_MS = 1500;

// Floor: how long to wait AFTER the swap is reported, before dropping the
// renderer. This is the load-bearing delay. tabs.onUpdated fires within a few
// milliseconds of the DOM change, but Chrome has not yet committed the new
// favicon to the state the tab strip keeps for a discarded tab — discard in
// that window and the icon reverts. Auto Tab Discard carries the same delay
// (its 'favicon-delay' pref, 100ms on Chrome).
const FAVICON_SETTLE_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// icons/32.png, inlined. This MUST be a data: URI, not chrome.runtime.getURL().
// Chrome re-fetches the favicon when the <link> is swapped, and if that fetch
// fails it silently keeps the old icon — which is what an extension URL does
// here. A data: URI cannot fail and needs no web_accessible_resources entry.
const ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA5ElEQVR42mNgQAKqya/5gbgeiM8D8X8q4/NQs/kZsAGgRDwQv6eBxegYZEc8Nsv/0xnHIwf7+wFwwHtwdEDj5f8A4XoGchLciRu//qMDkBg5CZOBHJdT0QH/Rx0w6oBRBwxuBxjlvPl/7eHv/+QCkF6QGRSFALmOIMZykqJg7ZHvRFsOUkuTNECMI0ixnKxEiM8RpFpOdi4om/sJw3KQGN2yIbojyLWcIgfAHEGJ5RQ7gBp4cDvAt+EduIilBIPMINsB0V0f/lMKQGYQcsD5AXTA+UHRLB/YjsmAd80GRed0ILvnAKEHcgfGQpR6AAAAAElFTkSuQmCC";

// Created in onInstalled rather than at top level: the service worker restarts
// constantly, and contextMenus.create() throws on a duplicate id.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Unload Tab",
    contexts: ["tab"],
  });
});

// Runs in the page. Swaps the favicon for the extension's icon so the tab reads
// as unloaded in the strip.
//
// This must happen BEFORE discarding. A discarded tab has no renderer, so there
// is nothing left to inject into — but the tab strip keeps painting the last
// favicon the renderer reported, and Chrome never re-fetches it while discarded.
// So the marker survives. The real favicon comes back on its own when the tab
// reloads on activation.
function markUnloaded(iconUrl) {
  // Stop any in-flight load, so the page cannot overwrite the icon afterwards.
  window.stop();

  // Matches rel="icon", "shortcut icon", "apple-touch-icon", any case.
  for (const link of document.querySelectorAll('link[rel*="icon" i]')) {
    link.remove();
  }

  document.head?.appendChild(
    Object.assign(document.createElement("link"), {
      rel: "icon",
      type: "image/png",
      href: iconUrl,
    }),
  );
}

// Resolves once Chrome reports the new favicon, so we do not tear down the
// renderer before it has told the browser process about the change.
function awaitFaviconChange(tabId) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo.favIconUrl) finish();
    };
    const timer = setTimeout(finish, FAVICON_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function unload(tab) {
  try {
    // Listen before injecting, or a fast favicon update races past us.
    const marked = awaitFaviconChange(tab.id);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: markUnloaded,
      args: [ICON],
    });
    await marked;

    // Do not remove. Discarding immediately after the swap is reported loses
    // the marker; the tab strip reverts to the page's original favicon.
    await sleep(FAVICON_SETTLE_MS);
  } catch {
    // chrome:// pages, the Web Store, PDFs and some file:// URLs refuse
    // injection. Unloading still works there; the tab just keeps its own icon.
  }

  // Swallow per-tab failures so one bad tab does not abort the batch.
  await chrome.tabs.discard(tab.id).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;

  const highlighted = await chrome.tabs.query({
    highlighted: true,
    windowId: tab.windowId,
  });

  // Right-clicking a tab outside the current selection acts on that tab alone,
  // rather than on a selection the user was not pointing at.
  const inSelection = highlighted.some((t) => t.id === tab.id);
  const targets = inSelection ? highlighted : [tab];

  await Promise.all(
    targets
      // Chrome refuses to discard the active tab; already-discarded is a no-op.
      .filter((t) => t.id != null && !t.active && !t.discarded)
      .map((t) => unload(t)),
  );
});
