# Chrome extensions

I built these small Chrome extensions for myself. They are not on the Chrome Web Store and never
will be. They are unsigned, require Developer Mode, and do not update automatically. The code is
public in case someone else finds it useful, but I maintain it for myself and may leave issues
unanswered.

Each extension is independent. Nothing here is a library.

## Extensions

| Extension | What it does | Download | Source |
| --- | --- | --- | --- |
| Unload Tab | Unload tabs from the tab-strip right-click menu to free their memory | [Download](https://github.com/axing/chrome-extensions/releases/download/latest/unload-tab.zip) | [Source](./extensions/unload-tab) |
| Google Meet Auto Join | Click Join on a Meet pre-call screen at a time you set | [Download](https://github.com/axing/chrome-extensions/releases/download/latest/meet-auto-join.zip) | [Source](./extensions/meet-auto-join) |

## Install

Every extension installs the same way:

1. Download its `.zip` from the table above.
2. Unzip it into a folder you intend to keep. Deleting the folder uninstalls the extension.
3. Open `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the unzipped folder.

Chrome will show a "Disable developer mode extensions" warning on some startups. That is
expected for anything installed outside the Web Store.

## Update

There is no auto-update. To update:

1. Download the zip from the same link. The download URLs never change.
2. Replace the contents of the folder you kept.
3. Go to `chrome://extensions` and click the reload arrow on the extension. (Restarting Chrome
   also works; unpacked extensions are re-read from disk on startup.)

Nothing will tell you an update exists. Watch the repo's releases on GitHub if you care.

## Work on this repo

[CLAUDE.md](./CLAUDE.md) explains the layout, naming rules, release process, and the reasons for
them. Each directory under `extensions/` is an independent extension. Versions come from git tags
rather than source files. To release one, run `git tag <name>-v1.0.0 && git push --tags`.
