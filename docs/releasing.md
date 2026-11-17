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

To build and publish a tag again (say a step failed), use Actions, Release, Run workflow, and give the tag. Running it again for a tag that already has a release replaces its files and keeps its notes.

A tag with a hyphen, like `v0.2.0-beta.1`, is published as a pre-release.

## What the workflow does

[`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Checks the tag looks like `v1.2.3` and matches the version in every file (`node tools/version.mjs check v1.2.3`).
2. Runs the same checks as CI: types, tests, the website and desktop builds, the Rust tests and the helper build ([`.github/actions/check`](../.github/actions/check/action.yml)).
3. On Windows, builds the helper, runs its self-test, bundles it into the app and builds the installer with the server address from `RIG_API_URL`. CI's `windows` job uses the same steps ([`.github/actions/windows-installer`](../.github/actions/windows-installer/action.yml)).
4. Publishes the release `Rig 0.2.0` with `Rig-Setup-0.2.0-x64.exe` and `SHA256SUMS.txt`. The notes start with how to install, then list the merged pull requests, sorted by label ([`.github/release.yml`](../.github/release.yml): `feature` or `enhancement` under New, `bug` or `fix` under Fixes, `skip-changelog` left out).

The app shows its version in Settings, About, along with the server it signs in to. The website shows it at the bottom of the landing page. Both come from the root `package.json` at build time.

## The installer isn't signed yet

Windows shows "Windows protected your PC" for an installer without a code-signing certificate. The release notes tell people to choose More info, then Run anyway.

The repository is private, so only people with access to it can download the release files. To give the installer to anyone else, put it somewhere public and set `VITE_DOWNLOAD_URL` for the website's Download button.

## Later

- Code signing: buy a code-signing certificate (or use Azure Trusted Signing), add it as a secret and sign the installer in the Windows job, so the warning goes away.
- Auto-update: Tauri's updater needs a signing key pair (the private key as a secret) and a public place to host the update files and `latest.json`, since files on a private repo's releases can't be downloaded without access.
