# chrome-extensions

A collection of small Chrome extensions I built for myself. They are **not on the Chrome Web
Store** and never will be — which means they are unsigned, they require Developer Mode, and
they do not auto-update. Everything here is public in case it is useful to someone else, but
it is written for an audience of one, and issues may sit unanswered.

Each extension is independent. Nothing here is a library.

## Extensions

| Extension | What it does | Download | Source |
| --- | --- | --- | --- |
| _none yet_ | | | |

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

## Repository conventions

Notes to my future self.

**Layout.** Every directory under `extensions/` is one extension. Small ones are plain folders
with a hand-written `manifest.json`, loadable as-is. Larger ones use
[WXT](https://wxt.dev/) — TypeScript, generated manifests, hot reload, shadow-DOM UI helpers.
CI detects which by looking for `wxt.config.ts`. There is no shared code and no wiring to
update: a new extension is a new directory.

**The directory name is the identity.** It becomes the tag prefix, the zip filename, and the
download URL. Lowercase kebab-case. Renaming one breaks every published link, so treat it as
permanent.

**Versions live only in git tags.** `manifest.json` and `package.json` carry `0.0.0` forever
and are never hand-edited. CI parses the tag and injects the real version at build time, so the
two cannot drift apart.

**Releasing** is one command:

```sh
git tag tab-manager-v1.2.0 && git push --tags
```

CI builds that extension and publishes it twice — to a versioned release you can pin or roll
back to, and to a rolling `latest` release that provides the permanent download URL:

```
https://github.com/axing/chrome-extensions/releases/download/latest/<name>.zip
```

Note the URL shape. `/releases/latest/download/…` is **wrong** here — it resolves to whichever
release GitHub considers newest across the whole repo, which will usually be a different
extension.

**No secrets in source.** Anything needing an API key reads it from `chrome.storage` via an
options page. This repository is public.

**Extension IDs** are derived from the folder's absolute path when loaded unpacked, so they
differ per machine. Only pin a `key` in the manifest if that extension needs a stable ID —
OAuth redirect URIs, `externally_connectable`.

## Local development

```sh
pnpm install          # sets up every WXT extension; raw folders need nothing
```

- **Raw extensions** — load unpacked straight from the working tree. `git pull` then reload.
- **WXT extensions** — `pnpm --filter ./extensions/<name> dev` opens a Chrome profile with the
  extension loaded and reloads it on save. For a one-off build,
  `pnpm --filter ./extensions/<name> build` then load `extensions/<name>/.output/chrome-mv3`.
