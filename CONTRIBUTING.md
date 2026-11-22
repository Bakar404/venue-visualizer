# Contributing

## Setup and tests

On macOS or Linux, install Node.js 22+, pnpm 10+, Python 3.11+, [uv](https://docs.astral.sh/uv/), and ffmpeg.
Run these commands from the repository root:

```bash
make setup
make test
pnpm --filter @vv/scene test
pnpm --filter web exec playwright install chromium
pnpm --filter web e2e
```

`make test` runs the Python and web unit suites. Playwright starts the web app in mock mode and does not need the
API, worker, or a signed-in AI CLI. On Linux, add `--with-deps` to the Playwright install command if system libraries
are missing. For live development, see the [README setup](README.md#setup) and run `make doctor` to check your tools.

## Proof-driven changes

For a bug fix, write and run a failing regression test before changing the implementation. Save the failure to
`docs/proof/<id>-red.txt`. After the fix, run the same test and save the passing output to
`docs/proof/<id>-green.txt`; include screenshots for UI changes. Keep secrets and personal data out of all evidence.

Keep commits focused and use a short, imperative subject. A conventional prefix such as `fix(web):` or `ci:` helps
identify the change.

## Cutting a release

1. Update [CHANGELOG.md](CHANGELOG.md) with a dated `## [X.Y.Z] - YYYY-MM-DD` section and update the compare links.
2. Bump the versions in the root, web, schema, and scene `package.json` files and `services/pyproject.toml`. Refresh
   affected lockfiles and run `node scripts/check-versions.mjs`.
3. Merge to `main` and make sure you're on the merged commit locally.
4. Create an annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`.
5. Push the tag: `git push origin vX.Y.Z`.

The tag must match all five versions. The release workflow reruns CI before publishing the matching changelog
section to GitHub Releases. For a prerelease such as `vX.Y.Z-rc.1`, use the same `X.Y.Z-rc.1` version in the changelog
and manifests.
