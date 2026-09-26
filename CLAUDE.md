# CLAUDE.md

Guidance for agents working in this repository.

## What this repo is

This repository contains independent personal Chrome extensions distributed outside the Chrome Web
Store. It is neither a framework nor a library. The extensions share a git remote and a release
pipeline, but no code. They are unrelated projects rather than a conventional monorepo.

## Writing

Use the repository's `writing-for-agents` and `unslop` skills when writing or editing AI
instruction Markdown files, README files, and code comments. Read their instructions in
`.agents/skills/writing-for-agents/SKILL.md` and `.agents/skills/unslop/SKILL.md`. Keep the
original meaning, technical facts, decisions, and instructions when revising existing text.
Check the final diff against the original before finishing.

## Vocabulary

**Extension:** An extension occupies one directory under `extensions/`. It owns its version,
release, and README, and never imports from another extension.

**Raw extension:** A small extension with a hand-written `manifest.json` and no build step. Chrome
can load it directly from the working tree.

**WXT extension:** An extension built with [WXT](https://wxt.dev/). It has a `wxt.config.ts` and a
`package.json`. Used when the extension needs TypeScript, npm packages, UI, or shadow-DOM
injection. CI distinguishes the two by the presence of `wxt.config.ts`.

**Placeholder version:** The literal `0.0.0` committed in every `manifest.json` and
`package.json`. Not a real version. See _Traps_ below.

**Versioned release:** A GitHub release at tag `<name>-v<semver>`. Users can pin it, and the
release is never overwritten.

**Latest mirror:** A single GitHub release at the literal tag `latest`. It holds the newest zip
of *every* extension and is overwritten on each release to provide permanent download URLs.

**Permanent URL:** `…/releases/download/latest/<name>.zip`. This URL lets users install and
update outside the Web Store. Write it into the README once and leave it unchanged.

## Hard constraints

Chrome has blocked off-store extension installs on macOS and Windows since 2014. A self-hosted
`.crx` cannot be installed by double-clicking, and `update_url` auto-update works only via
enterprise policy. Therefore:

- **There is no auto-update.** Not for the owner, not for anyone. This is accepted, not a gap to
  close.
- **Install is manual.** Download the zip, unzip it, open `chrome://extensions`, turn on
  Developer Mode, and select Load unpacked.
- **There is no update notification.** Deliberately. Extensions go stale silently.

## Repository layout

```
extensions/<name>/     one directory per extension; nothing else lives here
.github/workflows/     release.yml, the only workflow
```

Every directory under `extensions/` is an extension. There is no list to register it in, no
config to update, no workflow to edit. Adding one is `mkdir`.

`pnpm-workspace.yaml` scopes to `extensions/*`. It exists for a single `pnpm install` and one
lockfile. Extensions do not share code.

## Conventions

- **The directory name is the identity.** It is the tag prefix, the zip filename, and the
  download URL. Use lowercase kebab-case. Renaming breaks every published link, so treat it as
  permanent.
- **Tag format:** `<name>-v<semver>`, e.g. `tab-manager-v1.2.0`. CI splits on the *last* `-v`,
  so names may themselves contain `-v`.
- **Every extension ships a zip**, including raw ones, so the README has one install procedure
  rather than two.
- **No secrets in source.** This repo is public. Anything needing an API key reads it from
  `chrome.storage` via an options page.
- **Extension IDs** come from the folder's absolute path when loaded unpacked, so they
  differ per machine. Only pin a `key` in the manifest if that extension needs a stable ID
  (OAuth redirect URIs, `externally_connectable`).
- **Update the README table** when adding an extension. It is the only index that exists.

## Git workflow

- Work on a branch for every task that changes tracked files, including small documentation
  changes. Create one branch per task when starting from `main` or when no branch was designated.
  If the owner designates an existing branch, use it.
- Commit only changes belonging to the task. Leave unrelated working-tree changes alone. Split
  separable work by category into distinct commits when practical.
- Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for every
  commit: `<type>[optional scope]: <description>`. Choose the type by the work done, such as
  `feat`, `fix`, `docs`, or `chore`.
- Create no pull requests for branches created by the owner or an agent.
- After completing and verifying the task, summarize the changes for the owner to review in
  VS Code. Wait for the owner's response before committing. If the owner requests more changes,
  make and verify them, then send an updated summary and wait again.
- Only when the owner says `wrap it up`, commit the task changes and push the task branch to
  `origin` as a backup. Keep the remote branch for periodic review and cleanup.
- Then merge the task branch into local `main`, using a fast-forward merge when possible, and
  push `main` to `origin`. If remote `main` has advanced, fetch and reconcile the histories
  cleanly before pushing. Stop and report conflicts or uncertainty about someone else's work.
  Never force-push.

### Handoff

For every task that changes tracked files, read [`HANDOFF.md`](HANDOFF.md) when starting. Check
its claims against the current branch, working tree, and relevant files. Correct stale claims
before continuing.

Read and follow the repository's [handoff skill](.agents/skills/handoff/SKILL.md) to create and
maintain the tracked root `HANDOFF.md`. For this repository, that file replaces the skill's OS
temporary directory destination. Follow the skill's other rules: suggest relevant skills, link
to existing artifacts instead of copying them, and redact sensitive information.

- Keep `In flight` current while working. Record the task goal, branch, progress, next action, and
  blockers. Update it after meaningful progress or a change of direction, including when work is
  ready for owner review.
- Keep `Open items` to concrete tasks planned for the next session. Remove completed, abandoned,
  and stale items. Use `None` when there are no such tasks.
- When the owner says `wrap it up` and the work is ready to merge, clear `In flight` and refresh
  `Open items` before committing. Then follow the commit, push, and merge steps above. If those
  steps leave work unresolved, record the active issue in `In flight` again.

### Commit authorship

Every commit is authored solely by the repository owner. Agents write commits; they do not
sign them.

- **Never add a `Co-Authored-By` trailer** for Claude, Claude Code, or any other agent or tool.
- **Never set `--author`** or otherwise alter the committer identity. Use the configured
  `user.name` / `user.email` as they are.
- **No agent attribution anywhere in the commit.** This includes the subject, body, and any
  "Generated with …" footer. The same applies to tag messages and release notes.

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
or injected UI. The directory stays in place, so its tag prefix and published URL stay the same.

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

Raw extensions need no commands. Load them unpacked from the working tree.

## Traps

These choices are deliberate. Keep their reasons in mind when changing the repository.

- **`0.0.0` in manifests is deliberate.** The git tag is the only version that exists; CI
  injects it at build time. Bumping versions in source reintroduces exactly the drift this
  design removes.
- **The URL is `/releases/download/latest/<name>.zip`.** Never
  `/releases/latest/download/…`. That resolves to whichever release GitHub considers newest
  across the whole repo, which will usually be a different extension.
- **Do not add `packages/`, `shared/`, or any cross-extension import.** Extensions are
  independent by decision. Duplication between them is acceptable and expected.
- **Do not add Turborepo or Nx.** They orchestrate dependency graphs. There is no graph here.
- **Do not suggest the Chrome Web Store**, including unlisted publishing. It was evaluated
  against the auto-update benefit and rejected.
- **Do not add an update checker.** Considered and declined; extensions going stale is accepted.

## Unverified

The **raw** release path is proven. The workflow's first run published `unload-tab-v1.0.0`,
parsed the tag, injected the version, created both releases, and served a zip from the permanent
URL whose manifest reads `1.0.0`.

The **WXT** path has still never executed. These two lines remain written from convention rather
than observation, and are the likely culprits if the first WXT tag fails:

- `pnpm --filter ./extensions/<name>`, specifically the path-filter syntax
- WXT's zip output filename pattern, matched as `*-chrome.zip` in `.output/`

**Delete this section once a WXT extension has published successfully.**
