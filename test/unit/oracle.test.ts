// Differential test against an independent implementation: the `canonicalize`
// npm package (listed in RFC 8785 Appendix G), applied to JSON.parse output.
// Documents are generated from a seeded PRNG with randomized formatting and
// escaping, and contain no duplicate names, lone surrogates, or numbers that
// overflow, underflow or leave the safe integer range.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import oracle from 'canonicalize';
import { digestCanonical } from '../../src/digest.ts';
import { canonicalize } from '../../src/jcs/canonicalize.ts';
import { BS, chr, prng, sha256Hex } from './helpers.ts';

const SEED = Number(process.env.FUZZ_SEED ?? 0x8785);
const DOCUMENTS = Number(process.env.FUZZ_DOCUMENTS ?? 4000);

class Generator {
  private readonly rand: () => number;
  constructor(seed: number) {
    this.rand = prng(seed);
  }

  int(n: number): number {
    return Math.floor(this.rand() * n);
  }

  chance(p: number): boolean {
    return this.rand() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  ws(): string {
    return this.chance(0.6) ? '' : this.pick([' ', '\n', '\t', '\r\n', '  ', '\n    ']);
  }

  /** A decoded string value: valid UTF-16 (surrogates only in pairs). */
  stringValue(): string {
    const length = this.pick([0, 1, 2, 3, 5, 8, 13]);
    let out = '';
    for (let i = 0; i < length; i++) {
      switch (this.int(6)) {
        case 0:
        case 1:
          out += chr(0x20 + this.int(0x5f)); // printable ASCII, including " and \
          break;
        case 2:
          out += chr(this.int(0x20)); // C0 controls
          break;
        case 3: {
          let unit = 0x80 + this.int(0xfffe - 0x80);
          if (unit >= 0xd800 && unit <= 0xdfff) unit -= 0x800;
          out += chr(unit);
          break;
        }
        case 4:
          out += String.fromCodePoint(0x10000 + this.int(0x100000)); // astral: a surrogate pair
          break;
        default:
          out += this.pick(['/', chr(0x7f), chr(0x2028), chr(0x2029), chr(0xfeff), 'a', '1', '_']);
      }
    }
    return out;
  }

  hex4(unit: number): string {
    const hex = unit.toString(16).padStart(4, '0');
    return this.chance(0.5) ? hex : hex.toUpperCase();
  }

  /** JSON source text for a decoded value, with a random choice of escapes. */
  encodeString(value: string): string {
    const short: Record<number, string> = { 0x08: 'b', 0x09: 't', 0x0a: 'n', 0x0c: 'f', 0x0d: 'r', 0x22: '"', 0x5c: BS, 0x2f: '/' };
    let out = '"';
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      const mustEscape = unit < 0x20 || unit === 0x22 || unit === 0x5c;
      const shortEscape = short[unit];
      if (shortEscape !== undefined && (mustEscape || unit === 0x2f) && this.chance(0.6)) {
        out += BS + shortEscape;
      } else if (mustEscape || this.chance(0.15)) {
        out += `${BS}u${this.hex4(unit)}`;
      } else {
        out += value[i];
      }
    }
    return `${out}"`;
  }

  /** A number spelling whose value is finite, not underflowing and not an unsafe integer. */
  number(): string {
    for (;;) {
      let text: string;
      switch (this.int(4)) {
        case 0: {
          // A random binary64 value, spelled the ECMAScript way or with extra zeros.
          const view = new DataView(new ArrayBuffer(8));
          view.setUint32(0, this.int(0x100000000));
          view.setUint32(4, this.int(0x100000000));
          const v = view.getFloat64(0);
          if (!Number.isFinite(v)) continue;
          text = String(v);
          break;
        }
        case 1: {
          // A small integer, sometimes with a redundant fraction or exponent.
          const n = String(this.int(2001) - 1000);
          text = n + this.pick(['', '', '.0', '.00', 'e0', 'E+00', '.50e1']);
          break;
        }
        case 2:
          text = String(Math.floor((this.rand() * 2 - 1) * Number.MAX_SAFE_INTEGER));
          break;
        default: {
          // A hand-spelled decimal: optional fraction and exponent.
          const intPart = this.chance(0.3) ? '0' : String(1 + this.int(999999));
          const frac = this.chance(0.5) ? `.${String(this.int(1e9)).padStart(this.int(12) + 1, '0')}` : '';
          const exp = this.chance(0.4)
            ? `${this.pick(['e', 'E'])}${this.pick(['', '+', '-'])}${this.int(320)}`
            : '';
          text = `${this.chance(0.3) ? '-' : ''}${intPart}${frac}${exp}`;
        }
      }
      const v = Number(text);
      const nonzeroDigits = /[1-9]/.test(text.replace(/[eE].*$/, ''));
      if (!Number.isFinite(v)) continue;
      if (v === 0 && nonzeroDigits) continue;
      if (Number.isInteger(v) && Math.abs(v) > Number.MAX_SAFE_INTEGER) continue;
      return text;
    }
  }

  value(depth: number): string {
    const kind = depth >= 5 ? this.int(3) + 2 : this.int(6);
    switch (kind) {
      case 0: {
        const names = new Set<string>();
        const members: string[] = [];
        const count = this.int(7);
        while (members.length < count) {
          const name = this.chance(0.3) ? String(this.int(30)) : this.stringValue();
          if (names.has(name)) continue;
          names.add(name);
          members.push(`${this.ws()}${this.encodeString(name)}${this.ws()}:${this.ws()}${this.value(depth + 1)}${this.ws()}`);
        }
        return members.length === 0 ? `{${this.ws()}}` : `{${members.join(',')}}`;
      }
      case 1: {
        const count = this.int(6);
        const elements = Array.from({ length: count }, () => `${this.ws()}${this.value(depth + 1)}${this.ws()}`);
        return count === 0 ? `[${this.ws()}]` : `[${elements.join(',')}]`;
      }
      case 2:
        return this.encodeString(this.stringValue());
      case 3:
        return this.number();
      default:
        return this.pick(['true', 'false', 'null']);
    }
  }

  document(): string {
    return `${this.ws()}${this.value(0)}${this.ws()}`;
  }
}

describe(`differential test against the canonicalize package (seed ${SEED})`, () => {
  test(`${DOCUMENTS} random documents: identical canonical text and SHA-256`, () => {
    const gen = new Generator(SEED);
    let compared = 0;
    let withNotices = 0;
    for (let i = 0; i < DOCUMENTS; i++) {
      const text = gen.document();
      const ours = canonicalize(text);
      assert.equal(ours.errorCount, 0, `document ${i} (seed ${SEED}) has errors: ${ours.issues.map((x) => x.message).join(' | ')}`);
      for (const issue of ours.issues) {
        assert.ok(issue.code === 'number-representation' || issue.code === 'negative-zero', `document ${i}: ${issue.code}`);
      }
      if (ours.issues.length > 0) withNotices++;
      const theirs = oracle(JSON.parse(text));
      assert.equal(ours.canonical, theirs, `document ${i} (seed ${SEED}) differs:\n${text}`);
      assert.equal(digestCanonical(ours.canonical!).sha256, sha256Hex(theirs!));
      // Canonical text is a fixed point.
      assert.equal(canonicalize(ours.canonical!).canonical, ours.canonical);
      compared++;
    }
    assert.equal(compared, DOCUMENTS);
    assert.ok(withNotices > DOCUMENTS / 10, `the corpus exercises number notices (${withNotices} documents)`);
  });

  test('injected decoded duplicates are always refused', () => {
    const gen = new Generator(SEED + 1);
    for (let i = 0; i < 500; i++) {
      const name = gen.stringValue();
      const first = gen.encodeString(name);
      const second = gen.encodeString(name);
      const text = `{${first}:${gen.value(3)},"other":1,${second}:${gen.value(3)}}`;
      const result = canonicalize(text);
      assert.equal(result.canonical, undefined, text);
      assert.ok(result.issues.some((issue) => issue.code === 'duplicate-name'), text);
    }
  });

  test('injected lone surrogates are always refused', () => {
    const gen = new Generator(SEED + 2);
    for (let i = 0; i < 500; i++) {
      const unit = 0xd800 + gen.int(0x800);
      const lone = gen.chance(0.5) ? `${BS}u${gen.hex4(unit)}` : chr(unit);
      const before = gen.encodeString(gen.stringValue()).slice(0, -1);
      // A trailing "x" keeps an escaped high surrogate from pairing with what follows.
      const text = `[${before}${lone}x"]`;
      const result = canonicalize(text);
      assert.equal(result.canonical, undefined, text);
      assert.ok(result.issues.some((issue) => issue.code === 'lone-surrogate'), text);
    }
  });
});
