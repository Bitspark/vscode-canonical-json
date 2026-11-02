# Canonical JSON (RFC 8785)

See the exact bytes that get hashed. This extension shows the **RFC 8785 (JSON Canonicalization Scheme, JCS)** canonical form of the JSON document in your editor, copies it or its SHA-256 digest, and explains why an input canonicalizes the way it does: which numbers are respelled, which property names collide after decoding escapes, and what makes a document impossible to canonicalize.

It is meant for developers who work with protocols, signatures or content digests built on JSON canonicalization, and who need to answer "why does my hash differ?" without guessing.

## A short demo

Synthetic input, open in an editor (saved or not):

```json
{
  "id": "A-1001",
  "amount": 12.50,
  "quantity": 1e3,
  "ref": 9007199254740993,
  "note": "caf\u00e9"
}
```

**Canonical JSON: Inspect Canonical JSON** opens this read-only document beside the editor. Its content is exactly the canonical text, nothing added:

```json
{"amount":12.5,"id":"A-1001","note":"café","quantity":1000,"ref":9007199254740992}
```

and shows the message `83 bytes · SHA-256 of canonical JSON: 06312f561ea6bded…` with the buttons **Copy SHA-256** and **Copy canonical JSON**. The Problems panel explains every number that changes:

| Severity | Message |
| --- | --- |
| Information | Number representation changes: 12.50 → 12.5 (same value, different spelling). |
| Information | Number representation changes: 1e3 → 1000 (same value, different spelling). |
| Information | Number representation changes: 9007199254740993 → 9007199254740992 (the decimal value differs; both denote the same IEEE 754 double). |
| Warning | Integer 9007199254740993 is outside the safe integer range; some applications cannot preserve it (safe integers are those within ±(2^53−1) = ±9007199254740991). |

A document that cannot be canonicalized gets an error at the exact location and no output. For `{"a": 1, "\u0061": 2}`:

| Severity | Message |
| --- | --- |
| Error | Duplicate property name "a" after decoding escapes: this object already has it. RFC 8785 requires unique property names. |

<!-- Screenshot: the editor with the demo input on the left, the "(canonical).json" preview on the right, the Problems panel listing the four number notices, and the byte count and SHA-256 notification. Marketplace images must be PNG/JPEG/GIF served over https; no SVG. -->

## Commands

All three commands read the **whole** text of the active editor's document through VS Code, including unsaved edits and untitled documents. None of them modifies the document. They are in the Command Palette whenever an editor is active, and in the editor context menu of JSON documents. A selection is ignored.

| Command | Reads | Shows or changes | Copies to the clipboard |
| --- | --- | --- | --- |
| **Canonical JSON: Inspect Canonical JSON** | The whole document | Publishes diagnostics (errors and notices) on the document. If there are no errors, opens a read-only virtual document (`canonical-json:` scheme) beside the editor whose content is exactly the canonical text, and shows the byte count and the first 16 hex digits of the SHA-256. If there are errors, no preview is shown and an earlier preview of this document is closed. | Nothing, unless you press **Copy SHA-256** or **Copy canonical JSON** on its message. |
| **Canonical JSON: Copy Canonical JSON** | The whole document | Publishes diagnostics. Refuses with an error message if the document has errors. If any number has a notice (see below), asks once: "This document's numbers change in canonical form (N values). Copy anyway?" with **Copy** and **Show Changes** (runs Inspect). | The canonical text. |
| **Canonical JSON: Copy SHA-256 of Canonical JSON** | The whole document | Same checks and confirmation as above. | The SHA-256 of the canonical text: 64 lowercase hexadecimal characters. |

Diagnostics and the preview are snapshots of the moment you ran a command. Editing the document clears its diagnostics; run Inspect again to refresh them and the preview.

## What the extension accepts

Input must be **strict RFC 8259 JSON**. It is read by a purpose-written parser that keeps each token's exact text and position; nothing is repaired or guessed.

**Errors** block the canonical output and the digest:

- Any syntax error: comments, trailing commas, single quotes, unquoted names, leading zeros, `NaN` and `Infinity`, unterminated strings, unescaped control characters in strings, invalid escapes, a byte order mark, content after the value, an empty document.
- **Duplicate property names**, compared after decoding escapes: `{"a":1,"\u0061":2}` has a duplicate.
- **Lone surrogates**: an unpaired high or low surrogate, escaped (`"\ud800"`) or present in the text.
- **Numbers that overflow** IEEE 754 double precision, such as `1e400`.
- Documents larger than **20 MiB** of UTF-8, or nested deeper than **1,000** levels.

**Notices** never block; they explain number spellings:

- **Number representation changes**, reported per value with both spellings: `1.0` → `1`, `1e3` → `1000`, `333333333.33333329` → `333333333.3333333`. The message says whether the decimal value is the same or differs.
- **Nonzero number becomes 0**: a separate warning for values too small for a double, such as `1e-400`.
- **Negative zero**: `-0` → `0` loses the negative-zero distinction.
- **Integers outside the safe integer range** ±(2^53−1): "outside the safe integer range; some applications cannot preserve it". `9007199254740992` is exactly representable and gets only this warning; `9007199254740993` is not, and also gets a representation change.

Top-level primitives (`"text"`, `42`, `true`, `null`) are valid documents.

## Numbers

RFC 8785 reads every JSON number as an IEEE 754 double (binary64) and writes it the way ECMAScript's `Number.prototype.toString` does: the shortest decimal that reads back as the same double, in exponent form for magnitudes below 1e-6 or from 1e21 up, and `-0` written as `0`. So the canonical spelling can differ from the source even when nothing is wrong. Not every difference is a loss of precision: `1.0` → `1` is the same value. When the decimal value does differ, both spellings still denote the same double.

An unchanged spelling does not prove that every consumer of the document reads the same value: an application that parses numbers as 64-bit integers or decimals sees `9007199254740993`, while one that uses doubles sees `9007199254740992`. RFC 8785 recommends sending such values as strings. See the [technical note](https://github.com/Bitspark/vscode-canonical-json/blob/main/docs/technical-note.md) for details.

## The digest

The SHA-256 is computed over exactly the UTF-8 bytes of the canonical text: no byte order mark, no trailing newline, nothing else. It is shown and copied as lowercase hexadecimal. If you save the copied canonical text to a file without adding a newline, `sha256sum` of that file prints the same digest.

## Limits

- 20 MiB (20,971,520 bytes) of UTF-8 input; larger documents are refused with an error.
- Nesting deeper than 1,000 arrays or objects is refused with an error.
- At most 1,000 diagnostics are listed per document; a final diagnostic counts the rest.
- Canonicalization runs in the extension host. Typical documents take milliseconds; a document near the size limit takes a few seconds, during which a progress notification is shown.

## Conformance evidence

The test suite runs on every change and gates every release:

- RFC 8785's own examples: the section 3.2.2 sample with its canonical text (3.2.3) and UTF-8 bytes (3.2.4), the sorting example of section 3.2.3, and all 26 number samples of Appendix B.
- The reference test data of [cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization): all six input/output pairs, byte for byte.
- The first 1,000,000 values of that project's ES6 number test sequence, whose serialization reproduces the published SHA-256 checksums at 1,000, 10,000, 100,000 and 1,000,000 lines.
- A differential test against the independent [`canonicalize`](https://www.npmjs.com/package/canonicalize) package (text and SHA-256) on 4,000 seeded random documents with randomized escaping and number spellings, plus injected duplicates and lone surrogates.
- Explicit cases for every error and notice above, the limits, and the digest byte contract (a known digest checked with Node.js crypto and cross-checked with Python's hashlib).
- A smoke test of the packaged `.vsix` in VS Code Insiders: untitled unsaved documents, the clipboard, the preview and diagnostics.

## Privacy

What the code guarantees:

- The extension makes **no network requests** and collects **no telemetry**.
- Document contents are **never logged**.
- The clipboard is written **only** by the explicit copy commands and the copy buttons of the Inspect message.
- All processing happens in the VS Code extension host on your machine (or wherever your extension host runs, for remote development).

## Support

Report problems and questions as [GitHub issues](https://github.com/Bitspark/vscode-canonical-json/issues). A useful report contains the extension and VS Code versions, the command you ran, a small synthetic document that reproduces the behavior (never real secrets or personal data), and the output or diagnostic you expected and the one you got.

The scope is deliberately narrow: RFC 8785 canonicalization and SHA-256 of whole JSON documents. Expect essential fixes (wrong canonical output, wrong digest, crashes, security issues) and routine maintenance within a modest budget; feature requests outside this scope are likely to be declined. Security issues: see [SECURITY.md](https://github.com/Bitspark/vscode-canonical-json/blob/main/SECURITY.md).

## How this extension is made

This extension is developed with AI coding assistants. Bitspark GmbH reviews each release and stands behind its implementation and support. It has not been independently audited.

## Links

- Source: <https://github.com/Bitspark/vscode-canonical-json>
- Issues: <https://github.com/Bitspark/vscode-canonical-json/issues>
- Security policy: <https://github.com/Bitspark/vscode-canonical-json/blob/main/SECURITY.md>
- RFC 8785: <https://www.rfc-editor.org/rfc/rfc8785>

Licensed under the Apache License 2.0.
