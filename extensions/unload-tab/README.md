# Unload Tab

Chrome's answer to Firefox's **Unload Tab**. Right-click a tab in the tab strip and choose
**Unload Tab** — the page's renderer process is dropped and its memory returned to the system.
The tab stays where it is; it reloads when you next click it.

Works on a multi-selection: shift- or cmd-click several tabs, right-click any of them, and all
of them unload at once.

## Requirements

**Chrome 150 or newer.** Extensions could not add items to the tab-strip right-click menu until
Chrome 150 (June 2026) introduced the `"tab"` context for `chrome.contextMenus`. On anything
older the extension installs but the menu item never appears.

## Permissions

`contextMenus`, `scripting`, and `host_permissions: ["<all_urls>"]` — which Chrome presents as
**"Read and change all your data on the websites you visit"**.

That warning exists solely for the unloaded-tab marker. The extension injects one function into a
tab immediately before unloading it, purely to swap the favicon; it reads nothing, stores nothing,
and sends nothing anywhere. `chrome.tabs.discard()` itself needs no permission at all.

If you would rather not grant that, delete `scripting` and `host_permissions` from
`manifest.json` and drop the `unload()` wrapper in `background.js` back to a bare
`chrome.tabs.discard(t.id)`. That leaves `markUnloaded()`, `restoreFavicon()`, `markTab()`,
`awaitFaviconChange()`, `sleep()`, the three `FAVICON_*` constants and `FALLBACK_ICON` unused
(everything except `MENU_ID`), so delete those too.
Unloading keeps working; you just lose the marker. There is no way to have the marker without
the permission — see _Traps_.

## Tuning

If an unloaded tab flickers back to its original favicon, raise `FAVICON_SETTLE_MS` in
`background.js`. Raising `FAVICON_TIMEOUT_MS` will **not** help — see _Traps_ for why.

## Install

1. Download `unload-tab.zip` from the [latest
   release](https://github.com/axing/chrome-extensions/releases/download/latest/unload-tab.zip).
2. Unzip it somewhere you intend to **keep** — deleting the folder uninstalls the extension.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select
   the unzipped folder.

## Seeing which tabs are unloaded

An unloaded tab shows its **own favicon, greyed out** — so it still reads as the site it belongs
to, just muted. The real colour returns by itself the moment you click the tab and it reloads.

When the favicon cannot be greyed, the tab falls back to a **white dotted ring**. That happens
when the icon is served cross-origin without CORS headers, which makes it unreadable by canvas:
with `crossOrigin` set the image fails to load, and without it `toDataURL()` throws on a tainted
canvas. There is no third option, so the fallback exists to keep *some* signal on the tab.

The fallback ring is white because it sits in the tab strip, which is dark here. It will not show
up against a light tab theme; recolour it by editing the regeneration command in `background.js`.

The extension's own icon (`icons/*.png`, shown on `chrome://extensions` and in the puzzle-piece
Extensions menu — there is no toolbar button, as the manifest declares no `action`) is the same
ring on a dark tile. Those surfaces follow light/dark mode, so unlike the tab marker it carries
its own background rather than depending on one.

Chrome's own indicator — the dotted ring at `chrome://settings/performance` → **Inactive tabs
appearance** — does *not* apply here. Chromium tags every discard with a reason, and that ring is
wired to `PROACTIVE` (Memory Saver) discards. Anything an extension requests is `EXTERNAL`, and
`chrome.tabs.discard()` takes no reason parameter, so the treatment cannot be opted into. That is
why this extension marks tabs itself.

For a definitive answer, open `chrome://discards`. The **Discarded** column tells you the truth
about any tab's state, which is more reliable than watching Task Manager.

## Traps

Things a reasonable agent (or a future you) will try to "fix". Do not.

- **There is no page context menu, by decision.** Right-clicking a web page always targets the
  tab you are currently viewing, and Chrome flatly refuses to discard the active tab. A menu item
  there could only no-op, mislead, or steal your focus. It was requested, evaluated, and dropped
  — not overlooked.
- **The active tab is skipped, by decision.** If your selection includes the tab you are looking
  at, the others unload and that one stays. Do not "fix" this by switching to a neighbouring tab
  first — silently moving the user's focus is a worse behaviour than doing nothing, and it cannot
  work at all when the window has only one tab.
- **There is no unsaved-form-data guard, by decision.** You asked for a specific tab to unload;
  it unloads. Unsaved input in that tab is lost.
- **There is no keyboard shortcut, by decision.** A shortcut fires on the active tab, which is
  exactly the tab that can never be unloaded.
- **The favicon must be swapped BEFORE `discard()`, never after.** This ordering is the whole
  trick and looks wrong at a glance. A discarded tab has no renderer, so nothing can be injected
  into it — but the tab strip goes on painting the last favicon the renderer reported, and Chrome
  does not re-fetch it while the tab is discarded. So the marker set moments before the discard
  survives it. Do not "simplify" `unload()` by discarding first, and do not remove the
  `awaitFaviconChange()` wait — discarding before the renderer reports the change loses the
  marker. (`chrome.tabs` has no favicon setter at all; `tabs.update()` takes no `favIconUrl`.)
- **`FAVICON_SETTLE_MS` is a floor and must not be removed.** It is the delay *after* Chrome
  reports the swapped favicon and *before* `discard()`. `tabs.onUpdated` fires within a few
  milliseconds of the DOM change, but Chrome has not yet committed that favicon to the state the
  tab strip keeps for a discarded tab; discard inside that window and the icon silently reverts
  to the page's original. `FAVICON_TIMEOUT_MS` is a *ceiling* on waiting for the notification and
  is a different thing entirely — raising it does nothing, because the notification arrives long
  before the ceiling is reached. If the marker reverts, raise the **floor**. Auto Tab Discard
  carries the same delay as its `favicon-delay` pref (100ms on Chrome).
- **`markUnloaded()` must stay `async` and keep returning its promise.** `executeScript` waits
  for a returned promise to settle, and that wait is the only thing stopping `discard()` from
  firing while the favicon image is still decoding. A fire-and-forget `img.onload` — the obvious
  way to write this — resolves instantly and loses the marker every time. What it resolves *to*
  matters as well: the `originals` it returns are the only record of the icon links it removed,
  and `restoreFavicon()` cannot undo the marker without them.
- **Neither `markUnloaded()` nor `restoreFavicon()` may reference a constant defined in this
  file.** Both bodies are serialised and run in the page, where the service worker's scope does
  not exist. Everything they need is passed through `args`. Tests enforce this.
- **The greyscale fallback is not dead code.** A cross-origin favicon served without CORS headers
  cannot be read into a canvas by any route, so roughly any site using a CDN-hosted icon lands on
  the dotted ring instead. Verified against real pages, not assumed.
- **The fallback icon must stay a `data:` URI.** Do not "tidy" `FALLBACK_ICON` in `background.js`
  into a `chrome.runtime.getURL("icons/32.png")` call — that was tried and it silently fails. Swapping
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
  URIs. The tab then keeps its original icon and simply looks un-marked — the same outcome as a
  `chrome://` page, and the unload itself still works. Unverified against a real CSP-restricted
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
  prevent it by re-checking `active` before injecting instead — the tab can be activated at any
  point during the settle delay, long after the injection has run, so a pre-check closes almost
  none of the window. Note the `window.stop()` is *not* recoverable: a load aborted mid-flight
  stays aborted until the user reloads. That is accepted.
- **`"version": "0.0.0"` in the manifest is deliberate.** The git tag is the only version; CI
  injects it at build time.
