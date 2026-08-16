# chrome-extensions

A collection of small Chrome extensions I built for myself. They are **not on the Chrome Web
Store** and never will be — which means they are unsigned, they require Developer Mode, and
they do not auto-update. Everything here is public in case it is useful to someone else, but
it is written for an audience of one, and issues may sit unanswered.

Each extension is independent. Nothing here is a library.

## Extensions

| Extension | What it does | Download | Source |
| --- | --- | --- | --- |
| Unload Tab | Unload tabs from the tab-strip right-click menu to free their memory | [Download](https://github.com/axing/chrome-extensions/releases/download/latest/unload-tab.zip) | [Source](./extensions/unload-tab) |

## Installing

Every extension installs the same way:

1. Download its `.zip` from the table above.
2. Unzip it somewhere you intend to **keep** — deleting the folder uninstalls the extension.
3. Open `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the unzipped folder.

Chrome will show a "Disable developer mode extensions" warning on some startups. That is
expected for anything installed outside the Web Store.

## Updating

There is no auto-update. To update:

1. Download the same link again — the download URLs never change.
2. Replace the contents of the folder you kept.
3. Go to `chrome://extensions` and click the reload arrow on the extension. (Restarting Chrome
   also works; unpacked extensions are re-read from disk on startup.)

Nothing will tell you an update exists. Watch the repo's releases on GitHub if you care.

## Working on this repo

Layout, naming rules, the release process, and the reasoning behind all of it live in
[CLAUDE.md](./CLAUDE.md). Short version: every directory under `extensions/` is one independent
extension, versions come from git tags rather than source files, and releasing is
`git tag <name>-v1.0.0 && git push --tags`.
