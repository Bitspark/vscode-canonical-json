# Changelog

All notable changes to this extension are recorded here. Each release also
records its exact Marketplace publication date (see docs/RELEASING.md).

## 0.1.0 (unreleased)

Initial version.

- **Inspect Canonical JSON**: validates the whole active document (including
  unsaved edits), publishes diagnostics, opens the RFC 8785 canonical text in a
  read-only document beside the editor, and shows its byte count and SHA-256.
- **Copy Canonical JSON** and **Copy SHA-256 of Canonical JSON**: refuse on
  errors and ask once before copying when numbers change in canonical form.
- Strict RFC 8259 input. Errors: syntax, duplicate property names after
  decoding escapes, lone surrogates, numbers that overflow, input over 20 MiB,
  nesting deeper than 1,000. Notices: number representation changes, nonzero
  numbers that become 0, negative zero, integers outside the safe integer
  range.
