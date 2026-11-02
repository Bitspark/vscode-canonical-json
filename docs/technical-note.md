# Technical note

This note describes what the extension computes, which inputs it refuses and
why, and how its behavior is tested. It refers to RFC 8785, "JSON
Canonicalization Scheme (JCS)" (<https://www.rfc-editor.org/rfc/rfc8785>), and
RFC 8259, "The JavaScript Object Notation (JSON) Data Interchange Format".

## 1. What is computed

For the whole text of a document, the extension computes the RFC 8785
canonical form and the SHA-256 of its UTF-8 bytes. The work is split into:

- `src/jcs/parser.ts`: a purpose-written scanner and parser for strict RFC
  8259 JSON. It keeps each token's raw text and its source range (UTF-16 code
  unit offsets, as VS Code's `TextDocument.positionAt` expects).
- `src/jcs/numbers.ts`: reading numbers as IEEE 754 binary64, writing them in
  ECMAScript form, and the number notices.
- `src/jcs/serialize.ts`: serialization straight from the parse tree.
- `src/digest.ts`: the byte contract.
- `src/extension.ts`: commands, diagnostics, and the preview document.

The parse tree is never converted into JavaScript objects. An object built
from parsed members would enumerate integer-like keys in numeric order (`"2"`
before `"10"`), and would hide duplicate names by keeping only one of them.

## 2. Input policy

Input must be strict RFC 8259 JSON: exactly one value (top-level primitives
are allowed), whitespace only from space, tab, line feed and carriage return,
strings in double quotes with the escapes `\"`, `\\`, `\/`, `\b`, `\f`, `\n`,
`\r`, `\t` and `\uXXXX`, and numbers in the grammar
`-? (0 | [1-9][0-9]*) (\.[0-9]+)? ([eE][+-]?[0-9]+)?`.

The parser is not fault tolerant. The first syntax error ends parsing and is
reported with its position; nothing is repaired. Canonicalization is used
where exact bytes matter (signatures, content digests), so accepting
"JSON with comments", trailing commas or similar would make a digest depend on
how a tool chose to repair its input.

Problems in syntactically valid JSON (duplicate names, lone surrogates,
non-finite numbers) do not stop parsing; all of them are reported together.

### Errors (block output and hashing)

| Code | Condition | Why |
| --- | --- | --- |
| `syntax` | Any deviation from RFC 8259: comments, trailing commas, single quotes, unquoted names, leading zeros, `NaN`/`Infinity`, `+1`, `.5`, `1.`, unterminated strings, unescaped control characters (U+0000 to U+001F) in strings, invalid escapes, a byte order mark, non-JSON whitespace, content after the value, an empty document. | Not JSON. |
| `duplicate-name` | Two members of one object have the same name **after decoding escapes**: `{"a":1,"\u0061":2}`. | RFC 8785 section 3.1 requires I-JSON (RFC 7493), which forbids duplicate names. Parsers disagree on which duplicate wins (first, last, or error), so the canonical form would depend on the parser. |
| `lone-surrogate` | An unpaired high (U+D800 to U+DBFF) or low (U+DC00 to U+DFFF) surrogate, written as an escape (`"\ud800"`) or present directly in the text. | RFC 8785 section 3.2.2.2: lone surrogates "MUST cause a compliant JCS implementation to terminate with an appropriate error". They have no UTF-8 encoding. |
| `number-overflow` | A number whose nearest binary64 value is infinite: `1e400`, `-1.8e308`. | RFC 8785 section 3.2.2.3: Infinity is not permitted. |
| `input-too-large` | More than 20 MiB of UTF-8. | Resource limit; see Limits below. |
| `nesting-too-deep` | More than 1,000 nested arrays or objects. | Resource limit; see Limits below. |

A duplicate-name diagnostic points at the second name and links to the first.

### Notices (never block)

Notices explain how a number token's text changes in canonical form. They are
reported per token, with both spellings.

| Code | Severity | Condition |
| --- | --- | --- |
| `number-representation` | Information | The canonical spelling differs from the source token: `1.0` → `1`, `1e3` → `1000`, `333333333.33333329` → `333333333.3333333`. The message states whether the two spellings have the **same decimal value** (only the spelling changed) or a **different decimal value** (the source denotes a decimal that binary64 cannot hold exactly; both spellings read back as the same double). |
| `number-underflow` | Warning | A nonzero source value becomes `0` because it is smaller than the smallest subnormal double: `1e-400`. |
| `negative-zero` | Warning | `-0`, `-0.0`, `-0e5` become `0`: the canonical form loses the negative-zero distinction. |
| `unsafe-integer` | Warning | The value is an integer outside ±(2^53−1): "outside the safe integer range; some applications cannot preserve it". Reported whether or not the spelling changes: `9007199254740992` (exactly representable, unchanged) gets only this warning; `9007199254740993` (not representable, becomes `9007199254740992`) also gets a representation change. |

Not every difference is described as a loss of precision, because most are
not: `1.0` → `1` and `1e3` → `1000` are the same value.

The copy commands ask one confirmation per document when any number token
has a notice ("This document's numbers change in canonical form (N values).
Copy anyway?"), where N counts tokens, not notices.

## 3. Number semantics

RFC 8785 section 3.2.2.3 defines numbers through ECMAScript:

- **Reading.** A JSON number token denotes the IEEE 754 binary64 value nearest
  to its exact decimal value, ties to even (`Number(token)` in ECMAScript).
  For example `9007199254740993` lies exactly between `2^53` and `2^53 + 2`
  and reads as `2^53 = 9007199254740992`.
- **Writing.** `Number.prototype.toString`: the shortest decimal digit string
  that reads back as the same double, in plain notation for magnitudes from
  1e-6 up to (excluding) 1e21 and exponent notation (`1e+21`, `1e-7`)
  otherwise; `-0` is written `0`.

The canonical spelling is therefore a function of the binary64 value, not of
the source text.

### Why an unchanged spelling does not prove that meaning is preserved

When the canonical spelling equals the source token, the canonicalization did
not alter that token's text. That says nothing about how the applications
that read the document interpret it:

- An application that parses integers into 64-bit integers or big integers
  distinguishes `9007199254740992` from `9007199254740993`; an application
  that uses doubles cannot. The unsafe-integer warning marks such values even
  when their spelling is unchanged.
- An application that reads numbers as decimals sees `0.1` as exactly one
  tenth; binary64 holds `0.1000000000000000055511151231257827...`. Both
  agree on the spelling `0.1` but not on the value.
- Some languages give `1` and `1.0` different types (integer versus float).
  The canonical form writes both as `1`.
- Applications that use 32-bit floats, fixed-point, or schema-specific
  interpretations have their own ranges and rounding.

The extension verifies the RFC 8785 transformation. Whether every consumer of
a document agrees with binary64 semantics is a property of those consumers;
RFC 8785 Appendix D recommends sending numbers that need more range or
precision as strings.

## 4. Strings and property order

Strings are written as ECMAScript's `JSON.stringify(string)` writes them:
`\b \t \n \f \r` for those five controls, `\u00xx` with lowercase hex for the other
controls below U+0020, `\"` and `\\`, and every other character literally
(including `/`, U+007F, U+2028 and U+2029). There is no Unicode
normalization: `"A\u030a"` and `"\u00c5"` stay different.

Object members are sorted by the UTF-16 code units of their **decoded**
names, compared as unsigned integers (plain JavaScript string comparison),
independent of locale. Array order is preserved.

## 5. The byte contract

- The canonical text is encoded as UTF-8. It contains no lone surrogates
  (they are errors), so the encoding is exact.
- There is no byte order mark and no trailing newline.
- The digest is SHA-256 over exactly those bytes, shown and copied as 64
  lowercase hexadecimal characters.
- The byte count shown by Inspect is the length of that UTF-8 encoding.
- The preview document's content is exactly the canonical text. The copy
  commands are the reference for the bytes: saving the preview through "Save
  As" goes through the editor's save settings, such as
  `files.insertFinalNewline`, which can add bytes.

## 6. Limits and resource use

- **Size:** inputs larger than 20 MiB (20,971,520 bytes) of UTF-8 are refused
  before parsing. The check is linear and allocation-free; strings with more
  UTF-16 code units than the limit are refused without scanning, because every
  code unit takes at least one UTF-8 byte.
- **Depth:** more than 1,000 nested arrays or objects are refused when the
  1,001st level opens. Parsing and serialization recurse once per level, so
  the stack use is bounded.
- **Reported issues:** at most 1,000 issues are kept with locations; the rest
  are counted and summarized in one extra diagnostic.
- **Time:** canonicalization runs synchronously in the extension host. Typical
  documents take milliseconds. A document near the 20 MiB limit takes seconds
  (about 2 to 5 seconds on a loaded development machine); documents of 1 Mi
  UTF-16 code units or more show a progress notification meanwhile.

## 7. Test strategy

`npm test` runs these suites with Node's test runner directly on the
TypeScript sources:

- **RFC 8785 examples** (`test/unit/rfc8785.test.ts`): the section 3.2.2
  sample, its canonical text from section 3.2.3 and its UTF-8 bytes from
  section 3.2.4 byte for byte; the section 3.2.3 sorting example; all 26
  rows of Appendix B (bit patterns to spelling, and each spelling as input).
- **Reference vectors** (`test/unit/vectors.test.ts`): the six input/output
  pairs of cyberphone/json-canonicalization, compared with the expected
  output files and their hex dumps; each output is a fixed point.
- **ES6 number sequence**: the deterministic sequence described in that
  project's `testdata/README.md` is regenerated locally; serializing its first
  1,000,000 values reproduces the published SHA-256 checksums at 1,000,
  10,000, 100,000 and 1,000,000 lines. The first 20,000 also go through the
  full parser.
- **Differential test** (`test/unit/oracle.test.ts`): 4,000 documents from a
  seeded generator (randomized whitespace, escapes, integer-like keys,
  surrogate pairs, control characters and number spellings) are
  canonicalized and compared, as text and as SHA-256, with the independent
  `canonicalize` npm package applied to `JSON.parse` output. Generated
  documents avoid duplicates, lone surrogates and numbers that overflow,
  underflow or leave the safe integer range, where the two approaches
  legitimately differ. Injected decoded duplicates and lone surrogates must
  always be refused. `FUZZ_SEED` and `FUZZ_DOCUMENTS` select other runs.
- **Policy and serialization cases** (`test/unit/policy.test.ts`,
  `test/unit/serialize.test.ts`): every syntax error class with its position,
  decoded duplicates, lone surrogates (escaped, raw, reversed pairs, in
  names), valid pairs (escaped, raw, mixed), overflow, underflow, `-0`, the
  safe-integer boundaries ±9007199254740991/2/3, nesting at and over the limit,
  the size limit in bytes rather than code units, the issue cap, integer-like
  key order, escaping rules, top-level primitives, and empty containers.
- **Digest** (`test/unit/digest.test.ts`): the RFC sample's digest computed
  with Node.js crypto and cross-checked with Python's `hashlib`; no byte order
  mark, no trailing newline, UTF-8 byte counts.
- **Manifest and bundle** (`test/unit/manifest.test.ts`): exactly three
  commands, their menus, no settings, no runtime dependencies, the
  `.vscodeignore` allow-list, and a bundle that imports only `vscode` and
  `node:crypto`.

`npm run test:integration` packages the extension with `vsce`, unpacks the
`.vsix`, checks its file list and the bundle's imports, and runs a smoke suite
in VS Code Insiders against the unpacked package: Copy SHA-256 on an untitled,
unsaved document checked through the clipboard; Copy Canonical JSON; a
document passed as the command argument; Inspect's preview content, placement
and focus; a decoded duplicate producing an error diagnostic with no preview
and no clipboard change; and diagnostics clearing on edit.

Not covered by automation: the modal confirmation of the copy commands (VS
Code offers no API to answer a modal dialog from a test) and the progress
notification for large documents. Both are small and reviewed by reading the
code.
