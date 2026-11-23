# Releasing Rig

A release is a GitHub Release with the Windows installer attached. Pushing a version tag builds and publishes it.

## Before the first release

Set the repository variable `RIG_API_URL` to the server's address ending in `/api`, like `https://rig.<you>.workers.dev/api` (GitHub, Settings, Secrets and variables, Actions, Variables). The installer is built to sign in to that address, so the release fails straight away without it. [deploy.md](deploy.md) covers putting the server online.

## Cutting a release

1. Pick the version and write it everywhere: `pnpm version:set 0.2.0`. That changes every `package.json`, `tauri.conf.json`, the desktop crate's `Cargo.toml` and `Cargo.lock`, and the helper's `RigHelper.csproj`. `pnpm version:check` says whether they all agree.
2. Commit that on a branch, open a pull request and merge it into `main`.
3. Tag the merged commit and push the tag:
   ```
   git checkout main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. Watch Actions, Release. When it's done the release is under Releases, with the notes written for you.

You can also release without pushing a tag yourself: Actions, Release, Run workflow on main, and give the new tag. The workflow checks the version, tags main and publishes. To build and publish a tag again (say a step failed), do the same with the existing tag. Running it again for a tag that already has a release replaces its files and keeps its notes.

A tag with a hyphen, like `v0.2.0-beta.1`, is published as a pre-release.

## What the workflow does

[`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Checks the tag looks like `v1.2.3` and matches the version in every file (`node tools/version.mjs check v1.2.3`).
2. Runs the same checks as CI: types, tests, the website and desktop builds, the Rust tests and the helper build ([`.github/actions/check`](../.github/actions/check/action.yml)).
3. On Windows, builds the helper, runs its self-test, bundles it into the app and builds the installer with the server address from `RIG_API_URL`. CI's `windows` job uses the same steps ([`.github/actions/windows-installer`](../.github/actions/windows-installer/action.yml)).
4. Publishes the release `Rig 0.2.0` with `Rig-Setup-0.2.0-x64.exe`, its updater signature and `SHA256SUMS.txt`. The notes start with how to install, then list the merged pull requests, sorted by label ([`.github/release.yml`](../.github/release.yml): `feature` or `enhancement` under New, `bug` or `fix` under Fixes, `skip-changelog` left out).
5. Sends a full release to installed copies (see Updates).

The app shows its version in Settings, About, along with the server it signs in to. The website shows it at the bottom of the landing page. Both come from the root `package.json` at build time.

## Updates

Installed copies check for a newer release quietly, a few seconds after Rig opens and every six hours. When one is ready, a small notice shows in the corner with Update and Not now, and Settings, Updates shows the version and an "Update to X" button (also "Check for updates"). Nothing installs until the person picks Update; then Rig closes, the installer updates the app and the background recorder (Windows asks once), and Rig opens again (`apps/desktop/src/update.ts`, `packages/ui/src/pages/settings/UpdatesSection.tsx`). They ask the Rig server (`/api/updates`), which serves installers from an R2 bucket called `rig-updates`, because files on a private repo's releases can't be downloaded without access. The Deploy workflow creates the bucket; the Release workflow's `update` job uploads each full release to it and deletes the installers of all but the latest three ([`tools/publish-update.mjs`](../tools/publish-update.mjs)). Pre-releases stay on GitHub only.

Each update is signed with the updater key, and the app refuses one signed with any other key. Copies run from the code (`pnpm desktop`) never update themselves.

### Setting up the updater key (once)

1. Make the key pair, anywhere you have the repo and pnpm:
   ```
   pnpm --filter @rig/desktop tauri signer generate -w ~/.tauri/rig-updater.key
   ```
   A password is optional.
2. Copy the public half into the repo and merge it into `main`: `cp ~/.tauri/rig-updater.key.pub apps/desktop/src-tauri/updater.pub`.
3. Add the private half as the repository secret `TAURI_SIGNING_PRIVATE_KEY` (the whole contents of `~/.tauri/rig-updater.key`), and the password, if you set one, as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Keep a copy of the key file and its password somewhere safe, like a password manager. Without them, no new update can reach installed copies, and everyone has to reinstall by hand.

Until both halves are there, releases still publish to GitHub, but the installer has no updater and the `update` job says so.

The `CLOUDFLARE_API_TOKEN` secret needs Workers R2 Storage: Edit for the bucket. Storage stays far under R2's free 10 GB, and downloads cost nothing.

## The installer isn't signed yet

Windows shows "Windows protected your PC" for an installer without a code-signing certificate. The release notes tell people to choose More info, then Run anyway.

The repository is private, so only people with access to it can download the release files. To give the installer to anyone else, put it somewhere public and set `VITE_DOWNLOAD_URL` for the website's Download button.

## Later

- Code signing: buy a code-signing certificate (or use Azure Trusted Signing), add it as a secret and sign the installer in the Windows job, so the warning goes away.
