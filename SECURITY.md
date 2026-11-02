# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** through GitHub's private
vulnerability reporting: open the repository's **Security** tab at
<https://github.com/Bitspark/vscode-canonical-json/security> and choose
**Report a vulnerability**. Do not open a public issue for a vulnerability.

A useful report describes the affected version, the steps or a small
synthetic input that reproduces the problem, and the impact you expect (for
example: a document whose displayed canonical form or digest differs from what
RFC 8785 requires, a hang or crash on crafted input, or data leaving the
machine).

We acknowledge reports, investigate them, and publish fixes and advisories
through this repository. Please give us a reasonable time to release a fix
before disclosing details publicly.

## Supported versions

Only the latest published version receives security fixes.

## Scope

In scope: the extension's code in this repository and the packaged `.vsix`
published under the `bitspark` publisher. Out of scope: VS Code itself, other
extensions, and the security of systems that consume canonical JSON or its
digests.
