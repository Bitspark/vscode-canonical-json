# Contributing

Pull requests are welcome. No contributor agreement is required; contributions
are accepted under the repository's license (Apache-2.0).

The extension's scope is deliberately narrow (see the README's Support
section). Before starting larger work, please open an issue to discuss it.

## Build and test

Requirements: Node.js 24 (the tests run TypeScript directly through Node's
type stripping) and npm.

```sh
npm ci
npm run typecheck          # tsc, no emit
npm test                   # unit, conformance and differential tests
npm run build              # bundle src/ into dist/extension.js with esbuild
npm run package            # vsce package -> canonical-json-<version>.vsix
npm run test:integration   # package, unpack, and smoke-test in VS Code Insiders
```

`test:integration` downloads the latest VS Code Insiders into `.vscode-test/`
unless `VSCODE_EXECUTABLE_PATH` points to an installed Insiders executable. It
removes `ELECTRON_RUN_AS_NODE` from its environment before starting VS Code.

Source files use only erasable TypeScript syntax (`erasableSyntaxOnly`,
`verbatimModuleSyntax`) and import local files with their `.ts` extension, so
Node can run them without a compile step.

`npm run icon` regenerates `media/icon.png` (requires Python with Pillow).

## Layout

- `src/jcs/`: the canonicalizer (parser, number semantics, serializer). No VS
  Code dependency.
- `src/digest.ts`: the SHA-256 byte contract.
- `src/extension.ts`: the three commands, diagnostics and the preview.
- `test/unit/`: Node test runner suites. `test/fixtures/rfc8785/` holds
  examples transcribed from RFC 8785; `test/vectors/` holds third-party test
  data (see NOTICE). Treat the vectors as data and keep them unchanged.
- `test/integration/`: the packaged smoke test.
- `docs/`: the technical note and the release runbook.

## Issues

Use GitHub issues for bugs and questions. Include the extension and VS Code
versions, the command you ran, a small synthetic document that reproduces the
behavior (never real secrets or personal data), and what you expected versus
what you got. Report security problems privately as described in
[SECURITY.md](SECURITY.md).

## Changes to behavior

Any change to canonical output, digests, or the error/notice policy needs a
test that shows the old and new behavior, and an entry in `CHANGELOG.md`.
