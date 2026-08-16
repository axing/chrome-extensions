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

// How long the page may spend loading and greying the existing favicon before
// giving up and using FALLBACK_ICON. Measured at ~20ms in practice.
const FAVICON_READ_TIMEOUT_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fallback marker: icons/inactive.png, recoloured white and inlined at 32px.
// Used only when the tab's own favicon cannot be greyed — a cross-origin icon
// served without CORS headers cannot be read into a canvas, either because the
// load fails (crossOrigin set) or because toDataURL() throws on a tainted
// canvas (crossOrigin unset). Both were confirmed against a real page.
// Regenerate with:
//
//   magick icons/inactive.png -alpha extract \
//     -morphology Dilate Disk:2.5 -resize 32x32 mask.png
//   magick -size 32x32 xc:white mask.png -alpha off \
//     -compose CopyOpacity -composite -strip marker.png
//   base64 -i marker.png | tr -d '\n'
//
// The source is pure black with the shape held entirely in its alpha channel,
// so "invert" is just "paint it white" — building the mask and stamping it onto
// a white canvas keeps RGB white by construction, where -negate plus -resize
// bleeds black into the semi-transparent edges. The dilate is what keeps the
// thin dotted ring legible once it is scaled down to favicon size.
//
// This MUST be a data: URI, not chrome.runtime.getURL(). Chrome re-fetches the
// favicon when the <link> is swapped, and if that fetch fails it silently keeps
// the old icon — which is what an extension URL does here. A data: URI cannot
// fail and needs no web_accessible_resources entry.
const FALLBACK_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAADUUlEQVRIx42VT2xVRRTGfzPzWv60rxChgYRapeU1UjAQUqpSjSQmrsCmgRBN2BqtiXHhwhiCsTsWusBYUnZNECEQAqG7iqJUgRIIFII11tKEllh8FOMjSMHe+7G4c/uuffcRzizu3JlzZs75znfOGJEqBochJAAyAASkqpr01VTl1NVMiZIlRNTQxutM8QWOT6jmDL9QmN1NipLD+m+97kqS/hJCBUnSHS2fo4XQ/0JwBFTyMmeo4QSTNHCEKgz/sp0bLGYbD9nMzzzCEcRGluIsIMt3/MSbFKhkkka20c5bdNDIbap5wBa+p58sQdEu9sAgajnNGo5Tyx0aGORr/mMMWEkFH9LKDZaSp4Nf2Uw+hjQz6/4MzaxhjEu8gWVdAqZh4F3gJI+4xHqayZHHMVME0XhIatUlaaOQkZGTlZGRlZOREdoo6XNllbCKJ8/qS9WqR2fVIps4sjiMkFWLzmq/Vmif6qN8ZLz7u3iPEaqY4mIZyghDyEXusoB2OrG8jyU0Mogl/I4okOclDFCG335vkKUswpJjCpPBErCOZzjELRb7u8qJMMBV/qaOd3iRH7FRbMv0sbp1X2uFXEn0yeGE1uq+vlKnlgiZIjXbNKSmuUQtGVaoSUNqi/8yWEK2sIrlTDP+xADi8MaZZiuv8gfHsJFTP0g6qAEtTE3g3GQu1IAOSjot5CJOj3u+PeeRLi/Gaw0DNyMqWwImgHaep+KpDqjgBeYDE4CNYGnWN2pSt3qeKoQe7VNOvWoWsslKOKUrvgrKmxuhIZ0qHmc9slXs5QDX6YvaTBn3hejjGgfoptpb+tyukDSt8+pXq1zZYnJqVb/OaVpSXWRpgRDHLbqYxyQXGGSDv89hMRgszvu0gUEucJt5dDGBI4w7UlR9A7SwgwY6uMfWlBD6yHKcUQ5zmddiq7ilWUJqWMYIhnP8xmqusJeQm0A9lo9YzzCr2URAI3kKWMJkSwuxFChgGaGOPloJuc55ZhAZXmE/WUZ4m1EaGfUXxuROwOSEdkuSJrVAO9WpQ/pWH2in5utPSdJnQi4JcVq2c+rVUaGMf1LuqVLosHqVK9UufRuLj0YNe1gJjPEp/5TsxuRIqV7rKZPcMhgMmo38iQckvYkkKK/yGMC9U3MN+SxQAAAAAElFTkSuQmCC";

// Created in onInstalled rather than at top level: the service worker restarts
// constantly, and contextMenus.create() throws on a duplicate id.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Unload Tab",
    contexts: ["tab"],
  });
});

// Runs in the page. Greys out the tab's own favicon so it still reads as the
// site it belongs to, just muted. Falls back to FALLBACK_ICON when the favicon
// cannot be read into a canvas. Returns { status, originals }, where status is
// "grayscale" or "fallback" and originals describes the icon links it replaced.
//
// This must happen BEFORE discarding. A discarded tab has no renderer, so there
// is nothing left to inject into — but the tab strip keeps painting the last
// favicon the renderer reported, and Chrome never re-fetches it while discarded.
// So the marker survives. The real favicon comes back on its own when the tab
// reloads on activation.
//
// Must stay async and RETURN the promise: executeScript waits for a returned
// promise to settle, and that is the only thing keeping discard() from firing
// while the image is still decoding. The resolved value carries the page's
// original icon links so the swap can be undone if the discard is refused.
// Every value it needs arrives as an argument: this body is serialised and run
// in the page, where the service worker's constants do not exist.
async function markUnloaded(fallbackIcon, tabFavicon, readTimeoutMs) {
  // Stop any in-flight load, so the page cannot overwrite the icon afterwards.
  window.stop();

  // Read the source before removing anything. Matches rel="icon",
  // "shortcut icon" and "apple-touch-icon", any case.
  const links = [...document.querySelectorAll('link[rel*="icon" i]')];
  const source =
    tabFavicon || links.map((l) => l.href).find(Boolean) || "/favicon.ico";

  const grey = await new Promise((resolve) => {
    const img = new Image();
    // Required, or a cross-origin favicon taints the canvas and toDataURL()
    // throws. With it, such a favicon fails to load instead — either way it
    // cannot be greyed, so both routes fall through to the fallback icon.
    img.crossOrigin = "anonymous";
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), readTimeoutMs);
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d");
        ctx.filter = "grayscale(100%)";
        ctx.drawImage(img, 0, 0, 32, 32);
        done(canvas.toDataURL("image/png"));
      } catch {
        done(null); // tainted canvas
      }
    };
    img.src = source;
  });

  // Captured before removal so restoreFavicon() can put them back. Attributes
  // rather than outerHTML, so rebuilding never goes through innerHTML. href is
  // read as an attribute to keep relative URLs relative.
  const originals = links.map((link) => ({
    rel: link.getAttribute("rel"),
    type: link.getAttribute("type"),
    sizes: link.getAttribute("sizes"),
    href: link.getAttribute("href"),
  }));

  for (const link of links) {
    link.remove();
  }

  document.head?.appendChild(
    Object.assign(document.createElement("link"), {
      rel: "icon",
      type: "image/png",
      href: grey || fallbackIcon,
    }),
  );

  return { status: grey ? "grayscale" : "fallback", originals };
}

// Runs in the page. Undoes markUnloaded() when the discard is refused, so a tab
// that stays loaded does not sit there wearing an unload marker.
//
// Only the favicon is recoverable. markUnloaded() also calls window.stop(), and
// an aborted load cannot be resumed — that damage stands until the user
// reloads. Prevention is not possible either: the tab can be activated at any
// point during the settle delay, long after the injection has run.
//
// Like markUnloaded(), this is serialised into the page and takes everything it
// needs as arguments.
function restoreFavicon(originals) {
  for (const link of document.querySelectorAll('link[rel*="icon" i]')) {
    link.remove();
  }

  for (const attributes of originals) {
    const link = document.createElement("link");
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== null) link.setAttribute(name, value);
    }
    document.head?.appendChild(link);
  }
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

// Marks the tab and waits for the marker to stick. Returns the icon links it
// replaced, or null if the page was left untouched. Never throws.
//
// The try covers the injection alone. awaitFaviconChange() and sleep() resolve
// but never reject, so widening it would only hide a future failure.
async function markTab(tab) {
  // Listen before injecting, or a fast favicon update races past us.
  const marked = awaitFaviconChange(tab.id);

  let result;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: markUnloaded,
      // tab.favIconUrl is the icon Chrome already resolved for this tab, which
      // beats re-deriving one from the DOM. Needs host permissions, which the
      // marker requires anyway.
      args: [FALLBACK_ICON, tab.favIconUrl ?? null, FAVICON_READ_TIMEOUT_MS],
    });
    result = injection?.result;
  } catch {
    // chrome:// pages, the Web Store, PDFs and some file:// URLs refuse
    // injection. Unloading still works there; the tab just keeps its own icon.
    // The awaitFaviconChange listener is left to expire at its own ceiling.
    return null;
  }

  await marked;

  // Do not remove. Discarding immediately after the swap is reported loses
  // the marker; the tab strip reverts to the page's original favicon.
  await sleep(FAVICON_SETTLE_MS);

  return result?.originals ?? null;
}

async function unload(tab) {
  const originals = await markTab(tab);

  try {
    await chrome.tabs.discard(tab.id);
  } catch {
    // Chrome refused, most often because the user clicked this tab during the
    // settle delay and made it the active one. The page is already marked, so
    // put its own icons back rather than leaving a loaded tab looking
    // unloaded. Failures here are swallowed too: one bad tab must not abort
    // the batch.
    if (originals) {
      await chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: restoreFavicon,
          args: [originals],
        })
        .catch(() => {});
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;

  // A rejection here would surface as an unhandled rejection in the service
  // worker. Degrading to "no selection" is correct: the fallback below then
  // acts on the tab that was actually right-clicked.
  const highlighted = await chrome.tabs
    .query({ highlighted: true, windowId: tab.windowId })
    .catch(() => []);

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
