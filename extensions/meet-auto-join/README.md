# Google Meet Auto Join

The extension adds a panel to the Google Meet pre-call screen. Set a time and enable auto join.
At that time, it clicks **Join** for you.

It began as a Tampermonkey userscript and requests only the access this task needs.

## What it does

- Appears centered just above the Meet "green room" footer, once per tab load.
- The first row holds **Auto join at**, the time field, and the status. The second row holds the
  mic and camera options.
- The time field starts at one minute from now. You can change it. When the minute arrow step
  wraps from `59` to `00` or back, the hour changes too.
- Tick **Auto join at** to show the countdown in the status line. Press Enter in the time
  field to toggle auto join.
- Tick **Turn mic off** or **Turn camera off** to switch off either device if it is on. Each
  choice is remembered separately for next time.
- At the target time it clicks the join control, then removes itself.
- It also removes itself if you join by hand.

The extension finds the join control by its visible label. It recognizes **Join now**, **Ask to
join**, and **Join anyway**.

## Permissions

The manifest declares no permissions. Chrome asks about the content script's site match,
`https://meet.google.com/*`, which it presents as **"Read and change your data on
meet.google.com"**.

The extension saves the mic and camera choices in `localStorage` on `meet.google.com`, which the
content script shares with the page. It therefore needs no `storage` permission. Existing users'
combined choice carries over to both options. Clearing Meet's site data removes the choices;
tick the boxes again to restore them.

## Install

1. Download `meet-auto-join.zip` from the [latest
   release](https://github.com/axing/chrome-extensions/releases/download/latest/meet-auto-join.zip).
2. Unzip it into a folder you intend to keep. Deleting the folder uninstalls the extension.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select
   the unzipped folder.

## Verified against real Meet

The DOM selectors worked in Chrome against a live Meet pre-call screen on **2026-09-02**, at
`v1.0.0`. The panel appeared, the countdown started, and **Turn mic and camera off** switched
both devices off.

Meet's markup is not a public API and may change. If the extension stops working, inspect
`data-is-muted` and the real buttons' `aria-label` text before changing the selectors.

## Traps

These choices are deliberate. Keep their reasons in mind when changing the extension.

- **The time field is set once when the panel appears.** The earlier userscript rewrote it every
  second to show "now + 1 minute". That caused the `--:--` bug and changed the input while a user
  typed. The current value can become stale if the panel sits untouched. In that case, the panel
  says *"That time has already passed"* instead of choosing a new time.
- **The old bug was string arithmetic, not the ticker.** `pad2(getMinutes() + 1)` produces
  `"09:60"` at 09:59, which `<input type="time">` rejects and renders as `--:--`. It occurred
  once each hour at `:59`, including 23:59, for 24 times a day. `defaultTimeValue()` now adds
  60000 to the epoch and reads the fields from the resulting `Date`, which handles the rollover.
  Keep arithmetic on the timestamp rather than the padded string.
- **Timing uses a repeating tick.** Chrome throttles a tab that has been hidden for five minutes
  to roughly one wake-up per minute, aligned to the whole minute. Targets are whole minutes, so
  the aligned wake-up lands on the target. A single `setTimeout` aimed at 10:00:00.000 can be
  rounded past that moment and run at 10:01. The repeating tick checks the wall clock on each
  wake-up. `JOIN_TOLERANCE_MS` allows a click up to one second early to absorb rounding around
  the boundary. Keep the repeating tick.
- **`setAccurateInterval` corrects drift in the countdown.** It keeps the tick aligned to the
  second over a long countdown. Checking the wall clock on each tick handles tab throttling.
  Keep both behaviors.
- **Retries use a wall-clock deadline.** `JOIN_WINDOW_MS` is 30 seconds of real time. In a
  throttled tab, 30 attempts could take half an hour because the tab may tick once a minute.
- **Mic and camera are read before they are clicked.** `isAvOn()` checks `data-is-muted`, falling
  back to whether the label starts with "Turn off". A blind click would switch **on** a device
  that some other extension had already switched off. If you use one of those, this one stays out
  of its way.
- **The selected devices are switched off when the panel appears or when their boxes are ticked.**
  If you deliberately turn your camera back on after that, auto join leaves it on.
- **The requested Meet element uses a specific XPath.** The extension adds 80px of bottom
  padding to that element while the panel is present and restores its previous inline padding
  when the panel goes away. Meet can change this path when it changes its markup.
- **The panel does not return for a second meeting in the same tab.** Meet is a single-page app.
  Leaving a call and opening another meeting does not reload the document, and
  `window.__meetAutoJoinLoaded` blocks a second run. Press F5 for the panel. Watching the URL for
  meeting-code changes was considered and dropped as more moving parts than it is worth.
- **The armed time does not survive a reload.** The time is not saved anywhere. If the tab
  reloads, arm it again. Saving it would mean a per-meeting-code store and code to expire old
  entries, for a case that rarely happens on a pre-call screen.
- **A past time is rejected rather than rolled to tomorrow.** `23:59` as a default therefore warns
  instead of arming, since `00:00` today is in the past. That is a one-minute-a-day edge and the
  warning is the right answer to it.
- **The exact join label is preferred over a loose match.** `findJoinButton()` looks for an exact
  text match first. A loose match can land on an outer wrapper whose text merely *contains* the
  button's, and clicking a wrapper does nothing.
- **There is no calendar integration.** Adding it was considered and rejected. It would mean
  OAuth, a Google API client, token refresh, and a background worker, to replace one click on a
  link you already have in the invite.
- **`"version": "0.0.0"` in the manifest is deliberate.** The git tag is the only version; CI
  injects it at build time.
