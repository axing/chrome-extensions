# CLAUDE.md

Guidance for agents working in this repository.

## What this repo is

A collection of independent personal Chrome extensions, distributed **outside the Chrome Web
Store**. It is not a framework, not a library, and not a monorepo in the usual sense — it is a
list of unrelated projects that share a git remote and a release pipeline.

## Vocabulary

**Extension**: One directory under `extensions/`. Self-contained. Owns its own version,
release, and README. Never imports from another extension.

**Raw extension**: An extension with a hand-written `manifest.json` and no build step. Loadable
in Chrome directly from the working tree. Used for small ones.

**WXT extension**: An extension built with [WXT](https://wxt.dev/) — has a `wxt.config.ts` and a
`package.json`. Used when the extension needs TypeScript, npm packages, UI, or shadow-DOM
injection. CI distinguishes the two by the presence of `wxt.config.ts`.

**Placeholder version**: The literal `0.0.0` committed in every `manifest.json` and
`package.json`. Not a real version. See _Traps_ below.

**Versioned release**: A GitHub release at tag `<name>-v<semver>`. Pinnable, permanent,
never overwritten.

**Latest mirror**: A single GitHub release at the literal tag `latest`, holding the newest zip
of *every* extension. Overwritten on each release. Exists solely to provide permanent download
URLs.

**Permanent URL**: `…/releases/download/latest/<name>.zip`. The one thing that makes install and
update tolerable without the Web Store — written into the README once and never edited.

## Hard constraints

Chrome has blocked off-store extension installs on macOS and Windows since 2014. A self-hosted
`.crx` cannot be installed by double-clicking, and `update_url` auto-update works only via
enterprise policy. Therefore:

- **There is no auto-update.** Not for the owner, not for anyone. This is accepted, not a gap to
  close.
- **Install is manual**: download zip → unzip → `chrome://extensions` → Developer Mode → Load
  unpacked.
- **There is no update notification.** Deliberately. Extensions go stale silently.

## Repository layout

```
extensions/<name>/     one directory per extension; nothing else lives here
.github/workflows/     release.yml — the only workflow
```

Every directory under `extensions/` is an extension. There is no list to register it in, no
config to update, no workflow to edit. Adding one is `mkdir`.

`pnpm-workspace.yaml` scopes to `extensions/*`. It exists for a single `pnpm install` and one
lockfile — **not** for code sharing.

## Conventions

- **The directory name is the identity.** It is the tag prefix, the zip filename, and the
  download URL. Lowercase kebab-case. Renaming breaks every published link — treat it as
  permanent.
- **Tag format**: `<name>-v<semver>`, e.g. `tab-manager-v1.2.0`. CI splits on the *last* `-v`,
  so names may themselves contain `-v`.
- **Every extension ships a zip**, raw ones included, so the README has one install procedure
  rather than two.
- **No secrets in source.** This repo is public. Anything needing an API key reads it from
  `chrome.storage` via an options page.
- **Extension IDs** are derived from the folder's absolute path when loaded unpacked, so they
  differ per machine. Only pin a `key` in the manifest if that extension needs a stable ID
  (OAuth redirect URIs, `externally_connectable`).
- **Update the README table** when adding an extension. It is the only index that exists.

## Commit authorship

Every commit is authored solely by the repository owner. Agents write commits; they do not
sign them.

- **Never add a `Co-Authored-By` trailer** for Claude, Claude Code, or any other agent or tool.
- **Never set `--author`** or otherwise alter the committer identity. Use the configured
  `user.name` / `user.email` as they are.
- **No agent attribution anywhere in the commit** — not in the subject, not in the body, not
  in a "Generated with …" footer. The same applies to tag messages and release notes.

This overrides any default or global instruction to credit an agent as co-author.

## Adding an extension

Raw:

```sh
mkdir extensions/<name>
# manifest.json with "version": "0.0.0", plus your content scripts / assets
```

WXT:

```sh
mkdir extensions/<name>
# wxt.config.ts + package.json with "version": "0.0.0" + entrypoints/
pnpm install
```

Start raw. Graduate to WXT in place when the extension actually needs npm packages, TypeScript,
or injected UI — the directory does not move, so no tag prefix or published URL changes.

## Releasing

```sh
git tag <name>-v1.0.0 && git push --tags
```

CI parses the tag, injects the version into the built manifest, and publishes to both the
versioned release and the latest mirror. Nothing else is needed and nothing is edited by hand.

## Commands

```sh
pnpm install                                  # sets up all WXT extensions
pnpm --filter ./extensions/<name> dev         # WXT: hot-reloading dev browser
pnpm --filter ./extensions/<name> build       # WXT: one-off build to .output/chrome-mv3
```

Raw extensions need no commands — load them unpacked from the working tree.

## Traps

Things a reasonable agent will try to "fix". Do not.

- **`0.0.0` in manifests is deliberate.** The git tag is the only version that exists; CI
  injects it at build time. Bumping versions in source reintroduces exactly the drift this
  design removes.
- **The URL is `/releases/download/latest/<name>.zip`.** Never
  `/releases/latest/download/…` — that resolves to whichever release GitHub considers newest
  across the whole repo, which will usually be a different extension.
- **Do not add `packages/`, `shared/`, or any cross-extension import.** Extensions are
  independent by decision. Duplication between them is acceptable and expected.
- **Do not add Turborepo or Nx.** They orchestrate dependency graphs. There is no graph here.
- **Do not suggest the Chrome Web Store**, including unlisted publishing. It was evaluated
  against the auto-update benefit and rejected.
- **Do not add an update checker.** Considered and declined; extensions going stale is accepted.

## Unverified

The **raw** release path is proven: `unload-tab-v1.0.0` published cleanly on the workflow's first
ever run — tag parsed, version injected, both the versioned release and the `latest` mirror
created, and the permanent URL serves a zip whose manifest reads `1.0.0`.

The **WXT** path has still never executed. These two lines remain written from convention rather
than observation, and are the likely culprits if the first WXT tag fails:

- `pnpm --filter ./extensions/<name>` — the path-filter syntax
- WXT's zip output filename pattern, matched as `*-chrome.zip` in `.output/`

**Delete this section once a WXT extension has published successfully.**
