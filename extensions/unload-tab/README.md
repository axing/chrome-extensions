# Unload Tab

This extension adds an **Unload Tab** item to Chrome's tab strip context menu, like Firefox's
Unload Tab command. Choosing it drops the page's renderer process and returns its memory to the
system. The tab stays in place and reloads when you click it.

It also works on multiple selected tabs. Shift-click or Command-click several tabs, then
right-click one of them to unload them together.

## Requirements

Chrome 150 or newer is required. Chrome 150 (June 2026) introduced the `"tab"` context for
`chrome.contextMenus`, which lets extensions add items to the tab strip context menu. On older
versions, the extension installs but its menu item does not appear.

## Permissions

`contextMenus`, `scripting`, and `host_permissions: ["<all_urls>"]`. Chrome presents this as
**"Read and change all your data on the websites you visit"**.

The unloaded-tab marker causes that warning. Immediately before unloading a tab, the extension
injects a function to swap its favicon. It reads the favicon links but collects, stores, and sends
no other page data. `chrome.tabs.discard()` itself needs no permission.

If you would rather not grant that, delete `scripting` and `host_permissions` from
`manifest.json` and drop the `unload()` wrapper in `background.js` back to a bare
`chrome.tabs.discard(t.id)`. That leaves `markUnloaded()`, `restoreFavicon()`, `markTab()`,
`awaitFaviconChange()`, `sleep()`, the three `FAVICON_*` constants and `FALLBACK_ICON` unused
(everything except `MENU_ID`), so delete those too. Unloading still works without the marker.
The marker requires the permission, as explained in
_Traps_.

## Tuning

If an unloaded tab reverts to its original favicon, raise `FAVICON_SETTLE_MS` in
`background.js`. Raising `FAVICON_TIMEOUT_MS` will not help. _Traps_ explains why.

## Install

1. Download `unload-tab.zip` from the [latest
   release](https://github.com/axing/chrome-extensions/releases/download/latest/unload-tab.zip).
2. Unzip it into a folder you intend to keep. Deleting the folder uninstalls the extension.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select
   the unzipped folder.

## Seeing which tabs are unloaded

An unloaded tab shows a greyscale version of its own favicon. The original color returns when you
click the tab and it reloads.

When the favicon cannot be converted to greyscale, the tab shows a white dotted ring. A
cross-origin icon without CORS headers cannot be read by canvas. With `crossOrigin` set, the image
fails to load. Without it, `toDataURL()` throws on a tainted canvas. The ring still marks the tab.

The fallback ring is white because it sits in the tab strip, which is dark here. It will not show
up against a light tab theme; recolour it by editing the regeneration command in `background.js`.

The extension's own icon (`icons/*.png`) appears on `chrome://extensions` and in the puzzle-piece
Extensions menu. The manifest declares no `action`, so there is no toolbar button. The icon is
the same ring on a dark tile. Those surfaces follow light and dark mode, so the icon includes its
own background.

Chrome's dotted ring under **Inactive tabs appearance** at `chrome://settings/performance` does
not apply here. Chromium tags every discard with a reason, and that ring applies to `PROACTIVE`
(Memory Saver) discards. Extension requests are `EXTERNAL`, and `chrome.tabs.discard()` takes no
reason parameter. This extension therefore marks tabs itself.

To check a tab's state, open `chrome://discards` and read the **Discarded** column. It is more
reliable than Task Manager for this purpose.

## Traps

These choices are deliberate. Keep their reasons in mind when changing the extension.

- **There is no page context menu.** Right-clicking a web page targets the active tab, which
  Chrome refuses to discard. A menu item there could do nothing, mislead the user, or move focus.
  This option was requested, evaluated, and rejected.
- **The active tab is skipped.** If a selection includes the tab you are viewing, the others
  unload and the active tab stays. Do not switch to a neighboring tab first. That would move the
  user's focus without asking and would fail when the window has only one tab.
- **There is no unsaved-form-data guard.** You asked for a specific tab to unload;
  it unloads. Unsaved input in that tab is lost.
- **There is no keyboard shortcut.** A shortcut fires on the active tab, which is
  exactly the tab that can never be unloaded.
- **Swap the favicon before `discard()`.** A discarded tab has no renderer, so the extension
  cannot inject code into it. The tab strip keeps painting the last favicon the renderer reported
  and does not fetch it again while the tab is discarded. The marker therefore survives the
  discard. Keep the `awaitFaviconChange()` wait too. Discarding before the renderer reports the
  change loses the marker. `chrome.tabs` has no favicon setter, and `tabs.update()` takes no
  `favIconUrl`.
- **Keep `FAVICON_SETTLE_MS` as the minimum delay.** It runs after Chrome reports the new favicon
  and before `discard()`. `tabs.onUpdated` fires within a few milliseconds of the DOM change, but
  Chrome has not yet committed the icon to the state retained for a discarded tab. Discarding then
  restores the original icon. `FAVICON_TIMEOUT_MS` limits the wait for the notification. Raising
  that limit does nothing because the notification arrives before it. If the marker reverts,
  raise `FAVICON_SETTLE_MS`. Auto Tab Discard uses a similar `favicon-delay` setting, 100 ms on
  Chrome.
- **`markUnloaded()` must stay `async` and keep returning its promise.** `executeScript` waits
  for a returned promise to settle, and that wait is the only thing stopping `discard()` from
  firing while the favicon image is still decoding. A fire-and-forget `img.onload` resolves
  instantly and loses the marker every time. The `originals` in the resolved value are the only
  record of the icon links it removed. `restoreFavicon()` cannot undo the marker without them.
- **Neither `markUnloaded()` nor `restoreFavicon()` may reference a constant defined in this
  file.** Both bodies are serialised and run in the page, where the service worker's scope does
  not exist. Everything they need is passed through `args`. Tests enforce this.
- **The greyscale fallback is not dead code.** A cross-origin favicon served without CORS headers
  cannot be read into a canvas by any route, so roughly any site using a CDN-hosted icon lands on
  the dotted ring instead. Verified against real pages, not assumed.
- **The fallback icon must stay a `data:` URI.** Do not "tidy" `FALLBACK_ICON` in `background.js`
  into a `chrome.runtime.getURL("icons/32.png")` call. That was tried and silently failed. Swapping
  the `<link rel="icon">` makes Chrome **re-fetch** the favicon (verified: mutating the link
  fires a real network request), and when that fetch fails Chrome quietly keeps the *previous*
  icon rather than showing nothing. An extension URL does not survive that path. A `data:` URI
  cannot fail, needs no `web_accessible_resources`, and removes the network round-trip that made
  the `awaitFaviconChange()` timeout a race. Auto Tab Discard, the reference implementation,
  likewise always ends up at a `canvas.toDataURL()` string.
- **A strict page CSP can defeat the marker, and that is not a bug to chase.** Because swapping
  the `<link rel="icon">` makes Chrome re-fetch the favicon (see the bullet above), that fetch is
  an image load governed by the page's own `img-src` directive. A site serving `img-src 'self'`
  without `data:` blocks both the greyscale result and `FALLBACK_ICON`, since both are `data:`
  URIs. The tab then keeps its original icon and appears unmarked, just as a `chrome://` page
  does. Unloading still works. This has not been verified against a real CSP-restricted
  site; the mechanism is established but the exact fallback rendering is inferred from the
  failed-fetch behaviour documented above. There is no fix worth having: the alternatives are a
  `web_accessible_resources` URL, which was already tried and fails worse, or injecting into the
  page's own origin, which this extension will not do.
- **The marker cannot be made permission-free.** Any favicon change means touching the page's
  DOM, which means `scripting` + host permissions. `activeTab` cannot substitute: it is granted
  for the *active* tab, and this extension never unloads the active tab.
- **The marker is undone if the discard is refused.** `unload()` marks the page and only then
  calls `discard()`, so a tab the user clicks during the settle delay becomes active, Chrome
  refuses to discard it, and a perfectly loaded tab is left wearing an unload marker.
  `restoreFavicon()` puts its own icon links back. Do not "simplify" this away, and do not try to
  prevent it by re-checking `active` before injecting instead. The tab can be activated at any
  point during the settle delay, long after the injection has run, so a pre-check closes almost
  none of the window. Note the `window.stop()` is *not* recoverable: a load aborted mid-flight
  stays aborted until the user reloads. That is accepted.
- **`"version": "0.0.0"` in the manifest is deliberate.** The git tag is the only version; CI
  injects it at build time.
