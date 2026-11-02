# Releasing

This runbook covers publishing `bitspark.canonical-json` to the Visual Studio
Marketplace. It ends with a checklist that applies to every Bitspark
extension.

## Rules

- **Only through the release workflow.** Releases are published only by
  `.github/workflows/release.yml`, dispatched on `main`. Nobody publishes from
  a workstation, and no Marketplace personal access token exists for this
  extension.
- **Only from a reviewed commit on `main`.** The commit was merged through a
  reviewed pull request and its CI run (`ci.yml`) is green. The workflow
  refuses to run on any other ref.
- **Behind the protected `release` environment.** The workflow has two jobs.
  `package` runs without credentials: it installs, type-checks, tests, packages
  the `.vsix`, and uploads it with a contents listing. `publish` uses the
  `release` environment and waits for the developer's approval before it gets
  an OpenID Connect token and publishes **the exact file** that `package`
  built (its SHA-256 is checked).
- **Inspect before approving.** The approval is the pause in which the built
  package is checked (step 4 below). Never approve a run you did not dispatch
  or cannot attribute.
- **Microsoft trusted publishing.** `vsce publish --oidc` exchanges the job's
  GitHub OIDC token for a short-lived Marketplace credential. The trust is
  configured on the Marketplace side for this repository, workflow and
  environment.

## One-time setup

1. Create `Bitspark/vscode-canonical-json` on GitHub. Protect `main`: pull
   requests with at least one review, CI required, no force pushes.
2. Enable private vulnerability reporting (Settings → Code security), as
   promised in `SECURITY.md`.
3. Create the environment `release`: required reviewer is the developer
   responsible for the release; deployment branches limited to `main`; no
   environment secrets are needed for the Marketplace.
4. On the Marketplace publisher `bitspark`, add a trusted publishing policy for
   repository `Bitspark/vscode-canonical-json`, workflow `release.yml`,
   environment `release`. Follow Microsoft's current documentation for the
   exact steps.

## Release steps

1. **Prepare.** In a pull request: set the new `version` in `package.json`
   (`npm version <x.y.z> --no-git-tag-version` updates `package-lock.json`
   too) and add a `CHANGELOG.md` section marked "(unreleased)". Merge after
   review and green CI.
2. **Optional local check.** `npm ci && npm run typecheck && npm test &&
   npm run test:integration && npm run package`.
3. **Dispatch.** Actions → Release → Run workflow on `main`, or
   `gh workflow run release.yml --ref main`.
4. **Inspect the package** once the `package` job is green. Download the
   artifacts `vsix` and `vsix-contents` from the run.
   - `vsix-contents.txt` lists exactly: `extension/LICENSE.txt`,
     `extension/NOTICE`, `extension/changelog.md`,
     `extension/dist/extension.js`, `extension/media/icon.png`,
     `extension/package.json`, `extension/readme.md`, plus vsce's
     `[Content_Types].xml` and `extension.vsixmanifest`.
   - The version in the file name and manifest is the intended one.
   - The SHA-256 in the listing matches the downloaded `.vsix`.
   - Optionally install the `.vsix` into a clean VS Code profile and run the
     three commands on the README demo document; Copy SHA-256 must give
     `06312f561ea6bdedbe5ab3d741c2676020bfa4ae2be9e3ae54413baf6bff9e74`.
5. **Approve** the pending `publish` deployment only if every check holds. In
   the approval comment, state what was checked.
6. **Verify.** Read the `publish` job's log (not only its status) for the
   vsce result. Check the Marketplace listing shows the new version, and
   install it from the Marketplace into a clean profile once.
7. **Record.** In a follow-up pull request, replace "(unreleased)" in
   `CHANGELOG.md` with the exact publication date and time (UTC) taken from
   the `publish` job log, and create an annotated tag `v<x.y.z>` on the
   released commit. Every release has its publication date recorded.

## Stopping publishing and shipping a fix

- **Stop one release:** reject the pending `publish` deployment, or cancel the
  run, before it publishes.
- **Stop all publishing:** disable the workflow (Actions → Release → Disable
  workflow, or `gh workflow disable release.yml`) and revoke the Marketplace
  trusted publishing policy for this repository. Either one alone blocks the
  workflow from publishing; do both if the repository or a workflow may be
  compromised.
- **Ship a fix:** published versions are never overwritten. Fix on `main`
  through a reviewed pull request, bump the patch version, and release it
  through the normal steps. Security fixes are coordinated through a private
  advisory (see `SECURITY.md`). Removing a version or the extension from the
  Marketplace is a last resort taken through publisher management; record it
  in `CHANGELOG.md`.

## Every trusted workflow is an entry point to the whole publisher

A workflow that the Marketplace trusts to publish under `bitspark` can be
used to publish under the whole publisher, not only "its" extension. Treat
each trusted workflow as a key to every Bitspark extension:

- Keep the set of trusted repositories, workflows and environments minimal,
  and review it whenever one is added or removed.
- Every repository with a trusted workflow needs a protected `main`, a
  protected release environment with required reviewers, third-party actions
  pinned to full commit SHAs, and reviewed changes to `.github/workflows/`.
- Revoke the policy of any repository that is archived, transferred, or no
  longer released.

## Ownership and recovery

These entries come from a separate account process and must be filled before
the first release.

- **Owner identity:** TODO (person and account that own the `bitspark`
  Marketplace publisher and the GitHub repository).
- **Second owner:** TODO (a second person with owner rights on the publisher
  and the repository, so that no single account is a point of failure).
- **Recovery method:** TODO (how ownership is recovered if an owner account is
  lost or compromised, and where that procedure is kept).

## Open VSX

Publishing to Open VSX is planned once the `bitspark` namespace is verified
on open-vsx.org. Until then the Open VSX step in `release.yml` stays
commented out. Enabling it means: add `ovsx` as a pinned dev dependency, give
the `release` environment the credential Open VSX requires, enable the step,
and extend this runbook's verification step to the Open VSX listing.

## Release checklist for every Bitspark extension

- [ ] **Clear company responsibility:** Bitspark GmbH is named as
      responsible; owner and second owner are recorded; the README states who
      stands behind the extension.
- [ ] **Understood behavior:** the README states what each command reads,
      changes and copies; the reviewer understands every change in the
      release; tests and the packaged smoke test pass.
- [ ] **Rights:** `LICENSE` is present; `NOTICE` covers all third-party
      material; icons and media are our own or licensed.
- [ ] **Reviewed packaging:** the `.vsix` contents listing was inspected
      against the allow-list before approval; no tests, source maps, secrets
      or unexpected dependencies ship.
- [ ] **Viable support path:** issues are open, private vulnerability
      reporting is enabled, and the support scope and maintenance budget are
      stated.
- [ ] The publication date of the release is recorded.
