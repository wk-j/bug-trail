# Releasing

Releases are built by [GoReleaser](https://goreleaser.com) from `.goreleaser.yaml`. Pushing a
`v*` tag runs `.github/workflows/release.yml`, which:

1. runs `go vet`, `go test` and `bug-trail validate examples/*.json`,
2. builds `bug-trail` for macOS and Linux (amd64 and arm64) with
   `-ldflags "-X main.version=<tag without the v>"`, the same flag the Dockerfile sets, so
   `bug-trail version` reports the release,
3. publishes a GitHub release with the archives and `checksums.txt`,
4. commits the updated cask `Casks/bug-trail.rb` to
   [wk-j/homebrew-tap](https://github.com/wk-j/homebrew-tap).

## Install with Homebrew

```bash
brew install wk-j/tap/bug-trail
bug-trail version
```

Upgrade with `brew upgrade bug-trail`. Without Homebrew, download an archive from the
[releases page](https://github.com/wk-j/bug-trail/releases) or run
`go install github.com/wk-j/bug-trail@latest`.

The binaries aren't signed or notarized; the cask removes the macOS quarantine flag after
installing so Gatekeeper lets `bug-trail` run.

## One-time setup

The tap repository `wk-j/homebrew-tap` already exists. The workflow's own `GITHUB_TOKEN` can only
write to `wk-j/bug-trail`, so GoReleaser needs a second token to push the cask to the tap:

1. Create a fine-grained personal access token with access to **only** `wk-j/homebrew-tap` and
   the permission **Contents: Read and write**.
2. Add it to `wk-j/bug-trail` as the Actions secret `HOMEBREW_TAP_GITHUB_TOKEN`
   (Settings → Secrets and variables → Actions, or
   `gh secret set HOMEBREW_TAP_GITHUB_TOKEN -R wk-j/bug-trail`).

Renew the token before it expires; a release with an expired token publishes the GitHub release
but fails to update the cask.

### Without the token

If `HOMEBREW_TAP_GITHUB_TOKEN` isn't set, the workflow still publishes the GitHub release but
skips the push to the tap. It uploads the generated cask as the `homebrew-cask` artifact of the
run; push it by hand from a clone of the tap:

```bash
gh run download <run-id> -R wk-j/bug-trail -n homebrew-cask -D ../homebrew-tap/Casks
cd ../homebrew-tap && git add Casks/bug-trail.rb && git commit -m "bug-trail 0.3.0" && git push
```

## Cut a release

1. Set `version` in `main.go` to the new version (it is what a plain `go build` reports).
2. Commit, then tag and push:

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. Watch the `release` workflow in the Actions tab. When it finishes,
   `brew update && brew upgrade bug-trail` installs the new version.

## Try it locally

With GoReleaser v2 installed (`brew install goreleaser`):

```bash
goreleaser check                       # validate .goreleaser.yaml
goreleaser release --snapshot --clean  # build everything into dist/ without publishing
```

`dist/` is ignored by git. A pull request that changes `.goreleaser.yaml` or the workflow runs
`goreleaser check` and the same snapshot build in CI.
