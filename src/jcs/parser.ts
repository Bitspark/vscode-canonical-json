/**
 * A strict RFC 8259 JSON scanner and parser written for canonicalization.
 *
 * It keeps every token's raw text and source range, so that problems can be
 * reported at their exact location and number spellings can be compared with
 * their canonical form. It is not fault tolerant: the first syntax error ends
 * parsing. Problems that are syntactically valid JSON but cannot be
 * canonicalized (duplicate names, lone surrogates, non-finite numbers) are
 * collected and parsing continues, so all of them are reported at once.
 *
 * Offsets are UTF-16 code unit indices into the input string, which is what
 * VS Code's `TextDocument.positionAt` expects.
 */

import { abbreviate, type Issue, type SourceRange } from './issues.ts';
import { numberNotices } from './numbers.ts';

export const MAX_DEPTH = 1000;

export type ValueNode = ObjectNode | ArrayNode | StringNode | NumberNode | LiteralNode;

export interface ObjectNode extends SourceRange {
  readonly kind: 'object';
  readonly members: readonly Member[];
}

export interface Member {
  readonly name: StringNode;
  readonly value: ValueNode;
}

export interface ArrayNode extends SourceRange {
  readonly kind: 'array';
  readonly elements: readonly ValueNode[];
}

export interface StringNode extends SourceRange {
  readonly kind: 'string';
  /** The token exactly as written, including quotes and escapes. */
  readonly raw: string;
  /** The decoded value (UTF-16 code units). */
  readonly value: string;
}

export interface NumberNode extends SourceRange {
  readonly kind: 'number';
  /** The token exactly as written. */
  readonly raw: string;
  /** The nearest IEEE 754 binary64 value; may be non-finite (an error). */
  readonly value: number;
}

export interface LiteralNode extends SourceRange {
  readonly kind: 'literal';
  readonly raw: 'true' | 'false' | 'null';
}

/** Receives issues as the parser finds them. */
export interface IssueSink {
  add(issue: Issue): void;
  /** Called once for every number token that produced at least one notice. */
  numberChanged(): void;
}

export interface ParseResult {
  /** The parse tree, or undefined when parsing stopped at a syntax or limit error. */
  readonly root: ValueNode | undefined;
}

/** Thrown internally to stop at the first syntax or limit error. */
class Stop extends Error {
  readonly issue: Issue;
  constructor(issue: Issue) {
    super(issue.message);
    this.issue = issue;
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isJsonWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isWordChar(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    isDigit(c) ||
    c === 0x5f || // _
    c === 0x24 // $
  );
}

function isHex(c: number): boolean {
  return isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

function hex4(c: number): string {
  return c.toString(16).toUpperCase().padStart(4, '0');
}

/** "U+00A0" for a code unit, or the character itself in backticks when printable ASCII. */
function describeChar(c: number): string {
  if (c > 0x20 && c < 0x7f) return `\`${String.fromCharCode(c)}\``;
  return `U+${hex4(c)}`;
}

const LITERALS = ['true', 'false', 'null'] as const;

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

class Parser {
  private readonly text: string;
  private readonly sink: IssueSink;
  private pos = 0;

  constructor(text: string, sink: IssueSink) {
    this.text = text;
    this.sink = sink;
  }

  parseDocument(): ValueNode | undefined {
    try {
      this.skipWhitespace();
      if (this.pos >= this.text.length) {
        this.fail(this.pos, this.pos, 'The document is empty: expected a JSON value.');
      }
      const root = this.parseValue(0);
      this.skipWhitespace();
      if (this.pos < this.text.length) {
        this.unexpected('after the JSON value; a document holds exactly one value');
      }
      return root;
    } catch (e) {
      if (e instanceof Stop) {
        this.sink.add(e.issue);
        return undefined;
      }
      throw e;
    }
  }

  // ---- errors -------------------------------------------------------------

  private fail(start: number, end: number, message: string, code: Issue['code'] = 'syntax'): never {
    throw new Stop({ code, severity: 'error', start, end, message });
  }

  /** End of the current line (or of the text), for ranges that run to it. */
  private lineEnd(from: number): number {
    const n = this.text.indexOf('\n', from);
    const end = n < 0 ? this.text.length : n;
    return end > from && this.text.charCodeAt(end - 1) === 0x0d ? end - 1 : end;
  }

  /**
   * Reports the token at the current position as unexpected, recognizing the
   * common non-JSON constructs so the message says what is wrong.
   * `context` completes the sentence "Unexpected ... <context>".
   */
  private unexpected(context: string, valueExpected = false): never {
    const { text, pos } = this;
    if (pos >= text.length) {
      this.fail(pos, pos, `Unexpected end of input ${context}.`);
    }
    const c = text.charCodeAt(pos);
    const next = text.charCodeAt(pos + 1);
    if (c === 0x2f && (next === 0x2f || next === 0x2a)) {
      let end: number;
      if (next === 0x2f) {
        end = this.lineEnd(pos);
      } else {
        const close = text.indexOf('*/', pos + 2);
        end = close < 0 ? text.length : close + 2;
      }
      this.fail(pos, end, 'Comments are not allowed in JSON.');
    }
    if (c === 0x27) {
      const close = text.indexOf("'", pos + 1);
      const lineEnd = this.lineEnd(pos);
      const end = close >= 0 && close < lineEnd ? close + 1 : pos + 1;
      this.fail(pos, end, 'Single-quoted strings are not allowed in JSON; use double quotes.');
    }
    if (isWordChar(c) && !isDigit(c)) {
      let end = pos;
      while (end < text.length && isWordChar(text.charCodeAt(end))) end++;
      const word = text.slice(pos, end);
      const shown = abbreviate(word);
      if (word === 'NaN' || word === 'Infinity') {
        this.fail(pos, end, `${word} is not a JSON value; RFC 8785 cannot represent it.`);
      }
      const lower = word.toLowerCase();
      if (lower === 'true' || lower === 'false' || lower === 'null') {
        this.fail(pos, end, `\`${shown}\` is not a JSON literal; literals are lowercase: true, false, null.`);
      }
      if (valueExpected && LITERALS.some((literal) => literal.startsWith(lower) || lower.startsWith(literal))) {
        this.fail(pos, end, `\`${shown}\` is not a JSON literal; expected true, false or null.`);
      }
      this.fail(pos, end, `Unexpected word \`${shown}\` ${context}. Strings and property names must be in double quotes.`);
    }
    if (c === 0xfeff) {
      this.fail(pos, pos + 1, 'Unexpected byte order mark (U+FEFF); it is not JSON whitespace.');
    }
    if (isHighSurrogate(c) && isLowSurrogate(next)) {
      const cp = text.codePointAt(pos) ?? c;
      this.fail(pos, pos + 2, `Unexpected character U+${cp.toString(16).toUpperCase()} ${context}.`);
    }
    if (/\s/.test(text[pos] ?? '')) {
      this.fail(
        pos,
        pos + 1,
        `Unexpected character ${describeChar(c)} ${context}. JSON whitespace is only space, tab, line feed and carriage return.`,
      );
    }
    this.fail(pos, pos + 1, `Unexpected ${describeChar(c)} ${context}.`);
  }

  // ---- scanning -----------------------------------------------------------

  private skipWhitespace(): void {
    const { text } = this;
    let p = this.pos;
    while (p < text.length && isJsonWhitespace(text.charCodeAt(p))) p++;
    this.pos = p;
  }

  private parseValue(depth: number): ValueNode {
    this.skipWhitespace();
    const { text, pos } = this;
    if (pos >= text.length) this.unexpected('where a value was expected', true);
    const c = text.charCodeAt(pos);
    switch (c) {
      case 0x7b: // {
        return this.parseObject(depth + 1);
      case 0x5b: // [
        return this.parseArray(depth + 1);
      case QUOTE:
        return this.parseString();
      case 0x74: // t
      case 0x66: // f
      case 0x6e: // n
        return this.parseLiteral();
      case 0x2d: // -
        return this.parseNumber();
      case 0x2b: // +
        return this.fail(pos, pos + 1, 'A leading `+` is not allowed in JSON numbers.');
      case 0x2e: // .
        return this.fail(pos, pos + 1, 'JSON numbers must start with a digit (write 0.5, not .5).');
      default:
        if (isDigit(c)) return this.parseNumber();
        return this.unexpected('where a value was expected', true);
    }
  }

  private checkDepth(depth: number, start: number): void {
    if (depth > MAX_DEPTH) {
      this.fail(
        start,
        start + 1,
        `Nesting is deeper than ${MAX_DEPTH} levels; this extension refuses documents nested deeper than ${MAX_DEPTH}.`,
        'nesting-too-deep',
      );
    }
  }

  private parseObject(depth: number): ObjectNode {
    const { text } = this;
    const start = this.pos;
    this.checkDepth(depth, start);
    this.pos++;
    const members: Member[] = [];
    const seen = new Map<string, StringNode>();
    this.skipWhitespace();
    if (text.charCodeAt(this.pos) === 0x7d) {
      this.pos++;
      return { kind: 'object', start, end: this.pos, members };
    }
    let lastComma = -1;
    for (;;) {
      this.skipWhitespace();
      const c = text.charCodeAt(this.pos);
      if (c !== QUOTE) {
        if (c === 0x7d && lastComma >= 0) {
          this.fail(lastComma, lastComma + 1, 'Trailing comma before `}` is not allowed in JSON.');
        }
        if (this.pos >= text.length) {
          this.fail(this.pos, this.pos, 'Unexpected end of input: an object is not closed with `}`.');
        }
        this.unexpected('where a property name was expected');
      }
      const name = this.parseString();
      this.skipWhitespace();
      if (text.charCodeAt(this.pos) !== 0x3a) {
        this.unexpected('after a property name; expected `:`');
      }
      this.pos++;
      const value = this.parseValue(depth);
      const first = seen.get(name.value);
      if (first === undefined) {
        seen.set(name.value, name);
      } else {
        const shown = abbreviate(JSON.stringify(name.value));
        const escaped = first.raw !== name.raw ? ' after decoding escapes' : '';
        this.sink.add({
          code: 'duplicate-name',
          severity: 'error',
          start: name.start,
          end: name.end,
          message:
            `Duplicate property name ${shown}${escaped}: this object already has it. ` +
            `RFC 8785 requires unique property names.`,
          related: { start: first.start, end: first.end, message: `First occurrence of ${shown}` },
        });
      }
      members.push({ name, value });
      this.skipWhitespace();
      const d = text.charCodeAt(this.pos);
      if (d === 0x2c) {
        lastComma = this.pos;
        this.pos++;
        continue;
      }
      if (d === 0x7d) {
        this.pos++;
        return { kind: 'object', start, end: this.pos, members };
      }
      if (this.pos >= text.length) {
        this.fail(this.pos, this.pos, 'Unexpected end of input: an object is not closed with `}`.');
      }
      if (d === QUOTE) {
        this.fail(this.pos, this.pos + 1, 'Missing `,` between object members.');
      }
      this.unexpected('after an object member; expected `,` or `}`');
    }
  }

  private parseArray(depth: number): ArrayNode {
    const { text } = this;
    const start = this.pos;
    this.checkDepth(depth, start);
    this.pos++;
    const elements: ValueNode[] = [];
    this.skipWhitespace();
    if (text.charCodeAt(this.pos) === 0x5d) {
      this.pos++;
      return { kind: 'array', start, end: this.pos, elements };
    }
    let lastComma = -1;
    for (;;) {
      this.skipWhitespace();
      if (text.charCodeAt(this.pos) === 0x5d && lastComma >= 0) {
        this.fail(lastComma, lastComma + 1, 'Trailing comma before `]` is not allowed in JSON.');
      }
      if (this.pos >= text.length) {
        this.fail(this.pos, this.pos, 'Unexpected end of input: an array is not closed with `]`.');
      }
      elements.push(this.parseValue(depth));
      this.skipWhitespace();
      const d = text.charCodeAt(this.pos);
      if (d === 0x2c) {
        lastComma = this.pos;
        this.pos++;
        continue;
      }
      if (d === 0x5d) {
        this.pos++;
        return { kind: 'array', start, end: this.pos, elements };
      }
      if (this.pos >= text.length) {
        this.fail(this.pos, this.pos, 'Unexpected end of input: an array is not closed with `]`.');
      }
      this.unexpected('after an array element; expected `,` or `]`');
    }
  }

  private parseLiteral(): LiteralNode {
    const { text } = this;
    const start = this.pos;
    let end = start;
    while (end < text.length && isWordChar(text.charCodeAt(end))) end++;
    const word = text.slice(start, end);
    if (word === 'true' || word === 'false' || word === 'null') {
      this.pos = end;
      return { kind: 'literal', start, end, raw: word };
    }
    return this.unexpected('where a value was expected', true);
  }

  private parseNumber(): NumberNode {
    const { text } = this;
    const start = this.pos;
    let p = start;
    if (text.charCodeAt(p) === 0x2d) {
      p++;
      if (!isDigit(text.charCodeAt(p))) {
        if (text.startsWith('Infinity', p)) {
          this.fail(start, p + 8, '-Infinity is not a JSON value; RFC 8785 cannot represent it.');
        }
        this.fail(start, p + (p < text.length ? 1 : 0), 'Expected a digit after `-`.');
      }
    }
    if (text.charCodeAt(p) === 0x30) {
      p++;
      if (isDigit(text.charCodeAt(p))) {
        let q = p;
        while (isDigit(text.charCodeAt(q))) q++;
        this.fail(start, q, 'Leading zeros are not allowed in JSON numbers.');
      }
    } else {
      while (isDigit(text.charCodeAt(p))) p++;
    }
    if (text.charCodeAt(p) === 0x2e) {
      p++;
      if (!isDigit(text.charCodeAt(p))) {
        this.fail(start, p, 'Expected a digit after the decimal point.');
      }
      while (isDigit(text.charCodeAt(p))) p++;
    }
    const e = text.charCodeAt(p);
    if (e === 0x65 || e === 0x45) {
      p++;
      const sign = text.charCodeAt(p);
      if (sign === 0x2b || sign === 0x2d) p++;
      if (!isDigit(text.charCodeAt(p))) {
        this.fail(start, p, 'Expected a digit in the exponent.');
      }
      while (isDigit(text.charCodeAt(p))) p++;
    }
    const after = text.charCodeAt(p);
    if (isWordChar(after) || after === 0x2e) {
      let q = p;
      while (q < text.length && (isWordChar(text.charCodeAt(q)) || text.charCodeAt(q) === 0x2e)) q++;
      this.fail(start, q, `Invalid number \`${abbreviate(text.slice(start, q))}\`.`);
    }
    this.pos = p;
    const raw = text.slice(start, p);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.sink.add({
        code: 'number-overflow',
        severity: 'error',
        start,
        end: p,
        message:
          `Number ${abbreviate(raw)} is too large for an IEEE 754 double (it overflows to ` +
          `${value > 0 ? '' : '-'}Infinity); RFC 8785 cannot represent it.`,
      });
    } else {
      const notices = numberNotices(raw, value, start, p);
      if (notices.length > 0) {
        for (const notice of notices) this.sink.add(notice);
        this.sink.numberChanged();
      }
    }
    return { kind: 'number', start, end: p, raw, value };
  }

  private parseString(): StringNode {
    const { text } = this;
    const start = this.pos;
    let p = start + 1;
    let value = '';
    let chunk = p;
    /** Every surrogate code unit in the decoded value, with its source range. */
    const surrogates: { index: number; start: number; end: number; escaped: boolean }[] = [];
    for (;;) {
      if (p >= text.length) {
        this.fail(start, this.lineEnd(start), 'Unterminated string: missing closing `"`.');
      }
      const c = text.charCodeAt(p);
      if (c === QUOTE) {
        value += text.slice(chunk, p);
        p++;
        break;
      }
      if (c === BACKSLASH) {
        value += text.slice(chunk, p);
        const kind = text[p + 1];
        if (kind === 'u') {
          let ok = true;
          for (let k = 2; k < 6; k++) {
            if (!isHex(text.charCodeAt(p + k))) {
              ok = false;
              break;
            }
          }
          if (!ok) {
            let q = p + 2;
            while (q < p + 6 && q < text.length && isHex(text.charCodeAt(q))) q++;
            this.fail(p, q, `Invalid Unicode escape \`${text.slice(p, q)}\`: \\u needs exactly four hex digits.`);
          }
          const unit = parseInt(text.slice(p + 2, p + 6), 16);
          if (isHighSurrogate(unit) || isLowSurrogate(unit)) {
            surrogates.push({ index: value.length, start: p, end: p + 6, escaped: true });
          }
          value += String.fromCharCode(unit);
          p += 6;
        } else if (kind !== undefined && Object.hasOwn(ESCAPES, kind)) {
          value += ESCAPES[kind];
          p += 2;
        } else if (kind === undefined) {
          this.fail(start, this.lineEnd(start), 'Unterminated string: missing closing `"`.');
        } else {
          const shown = String.fromCodePoint(text.codePointAt(p + 1) ?? 0);
          if (shown.charCodeAt(0) < 0x20) {
            this.fail(p, p + 2, `Invalid escape sequence: \`\\\` followed by control character U+${hex4(shown.charCodeAt(0))}.`);
          }
          this.fail(p, p + 1 + shown.length, `Invalid escape sequence \`\\${shown}\` in a string.`);
        }
        chunk = p;
        continue;
      }
      if (c < 0x20) {
        if (c === 0x0a || c === 0x0d) {
          this.fail(
            p,
            p + 1,
            'Unescaped line break in a string: strings cannot span lines (write \\n), or the closing `"` is missing.',
          );
        }
        this.fail(p, p + 1, `Control character U+${hex4(c)} must be escaped in a string.`);
      }
      if (isHighSurrogate(c) || isLowSurrogate(c)) {
        surrogates.push({ index: value.length + (p - chunk), start: p, end: p + 1, escaped: false });
      }
      p++;
    }
    this.pos = p;
    if (surrogates.length > 0) this.checkSurrogates(value, surrogates);
    return { kind: 'string', start, end: p, raw: text.slice(start, p), value };
  }

  private checkSurrogates(
    value: string,
    surrogates: readonly { index: number; start: number; end: number; escaped: boolean }[],
  ): void {
    for (let i = 0; i < surrogates.length; i++) {
      const s = surrogates[i]!;
      const unit = value.charCodeAt(s.index);
      if (isHighSurrogate(unit) && isLowSurrogate(value.charCodeAt(s.index + 1))) {
        i++; // the low half of this pair is the next recorded surrogate
        continue;
      }
      const how = s.escaped ? `escaped as \`${this.text.slice(s.start, s.end)}\`` : 'written directly in the text';
      const why = isHighSurrogate(unit)
        ? 'a high surrogate must be followed by a low surrogate'
        : 'a low surrogate must follow a high surrogate';
      this.sink.add({
        code: 'lone-surrogate',
        severity: 'error',
        start: s.start,
        end: s.end,
        message: `Lone surrogate U+${hex4(unit)} (${how}): ${why}. RFC 8785 requires valid Unicode strings.`,
      });
    }
  }
}

export function parse(text: string, sink: IssueSink): ParseResult {
  return { root: new Parser(text, sink).parseDocument() };
}
