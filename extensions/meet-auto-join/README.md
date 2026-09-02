# Google Meet Auto Join

A panel on the Google Meet pre-call screen. Set a time, tick a box, walk away. At that time it
clicks **Join** for you.

Grown out of a Tampermonkey userscript, so it does one small thing and asks for nothing it does
not need.

## What it does

- Appears on the Meet "green room" screen, bottom right, once per tab load.
- The time field starts at one minute from now. Change it to whatever you like.
- Tick **Enable auto join** and it counts down out loud in the status line. Pressing Enter in
  the time field ticks that box for you, so setting a time is one gesture.
- Tick **Turn mic and camera off** and it switches off whichever of the two is currently on.
  That choice is remembered for next time.
- At the target time it clicks the join control, then removes itself.
- It also removes itself if you join by hand, or press the **×**.

The join control is matched by its visible label, so it copes with **Join now**, **Ask to join**
and **Join anyway** alike.

## Permissions

None declared. The only thing Chrome asks about is the content-script match,
`https://meet.google.com/*`, which it presents as **"Read and change your data on
meet.google.com"**.

The saved checkbox lives in `localStorage` on `meet.google.com`, which a content script already
shares with the page. That keeps the `storage` permission out of the manifest. Clearing site
data for Meet forgets the setting; re-ticking the box is the whole recovery.

## Install

1. Download `meet-auto-join.zip` from the [latest
   release](https://github.com/axing/chrome-extensions/releases/download/latest/meet-auto-join.zip).
2. Unzip it somewhere you intend to **keep** — deleting the folder uninstalls the extension.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select
   the unzipped folder.

## Traps

Things a reasonable agent (or a future you) will try to "fix". Do not.

- **The time field is set once and never refreshed, by decision.** The userscript this grew from
  rewrote the field every second so it always read "now + 1 minute". That is what produced its
  famous `--:--` bug, and an input that rewrites itself while you are typing in it is its own
  problem. The field is now written once, when the panel appears. It therefore goes stale if the
  panel sits untouched, and the panel says *"That time has already passed"* rather than guessing
  a new time for you. That warning is the designed behaviour, not a missing feature.
- **The old bug was string arithmetic, not the ticker.** `pad2(getMinutes() + 1)` produces
  `"09:60"` at 09:59, which `<input type="time">` rejects and renders as `--:--`. It fired **24
  times a day**, once every hour at `:59`, and once more at 23:59 for the hour. `defaultTimeValue()`
  now adds 60000 to the epoch and reads the fields back off the resulting `Date`, so the rollover
  is the platform's problem. Never reintroduce arithmetic on the padded string.
- **Timing uses a repeating tick, not one long `setTimeout`.** This looks like the more
  complicated choice and it is the correct one. Chrome throttles a tab you have not looked at for
  five minutes down to roughly one wake-up per minute, **aligned to the whole minute**. Targets
  here are always whole minutes, so the aligned wake-up lands on the target — but a one-shot timer
  aimed at 10:00:00.000 can be rounded *past* its own moment and land at 10:01. A tick that asks
  "is it time yet?" against the wall clock cannot overshoot: it is already sitting on that
  boundary. `JOIN_TOLERANCE_MS` fires the click up to a second early to absorb the millisecond
  either side. Do not "simplify" this back to a single timer.
- **`setAccurateInterval`'s drift correction is not what defeats the throttling.** It keeps a
  repeating tick from slowly sliding off the second over a long countdown, which matters for the
  countdown text. The throttling is survived by the *shape* — a poll against the clock — not by
  the correction. Both are worth having; do not confuse them.
- **Retries are bounded by wall clock, not by attempt count.** `JOIN_WINDOW_MS` is 30 seconds of
  real time. Counting 30 attempts instead would run for half an hour in a throttled tab, because
  the tab only ticks once a minute.
- **Mic and camera are read before they are clicked.** `isAvOn()` checks `data-is-muted`, falling
  back to whether the label starts with "Turn off". A blind click would switch **on** a device
  that some other extension had already switched off. If you use one of those, this one stays out
  of its way.
- **Mic and camera are switched off once, when the panel appears — not again at join time.** If
  you deliberately turn your camera back on after that, auto-join will not fight you.
- **The panel does not come back for a second meeting in the same tab, by decision.** Meet is a
  single-page app; leaving a call and opening another meeting does not reload the document, and
  `window.__meetAutoJoinLoaded` blocks a second run. Press F5 for the panel. Watching the URL for
  meeting-code changes was considered and dropped as more moving parts than it is worth.
- **Nothing survives a reload, by decision.** The armed time is not saved anywhere. If the tab
  reloads, arm it again. Saving it would mean a per-meeting-code store and code to expire old
  entries, for a case that rarely happens on a pre-call screen.
- **A past time is rejected, never rolled to tomorrow.** `23:59` as a default therefore warns
  instead of arming, since `00:00` today is in the past. That is a one-minute-a-day edge and the
  warning is the right answer to it.
- **The exact join label is preferred over a loose match.** `findJoinButton()` looks for an exact
  text match first. A loose match can land on an outer wrapper whose text merely *contains* the
  button's, and clicking a wrapper does nothing.
- **There is no calendar integration**, and adding it was considered and rejected. It would mean
  OAuth, a Google API client, token refresh, and a background worker, to replace one click on a
  link you already have in the invite.
- **`"version": "0.0.0"` in the manifest is deliberate.** The git tag is the only version; CI
  injects it at build time.
