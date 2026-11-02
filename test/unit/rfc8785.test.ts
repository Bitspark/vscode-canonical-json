// RFC 8785's own examples, transcribed into test/fixtures/rfc8785/:
// the sample of section 3.2.2, its canonical form (section 3.2.3) and UTF-8
// bytes (section 3.2.4), the sorting example of section 3.2.3, and the number
// serialization samples of Appendix B.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canonicalBytes } from '../../src/digest.ts';
import { canonicalize } from '../../src/jcs/canonicalize.ts';
import { serializeNumber } from '../../src/jcs/numbers.ts';
import { parse, type ObjectNode } from '../../src/jcs/parser.ts';
import { BS, canonicalOf, chr, doubleFromBits, hexToBytes, readText } from './helpers.ts';

const FIXTURES = ['test', 'fixtures', 'rfc8785'] as const;

describe('RFC 8785 section 3.2.2 sample', () => {
  const input = readText(...FIXTURES, 'section-3.2.2-input.json');
  // Section 3.2.3, without the display line wrap.
  const expected =
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"' +
    chr(0x20ac) + '$' + BS + 'u000f' + BS + 'n' + "A'B" + BS + '"' + BS + BS + BS + BS + BS + '"' + '/"}';

  test('canonicalizes to the text shown in section 3.2.3', () => {
    assert.equal(canonicalOf(input), expected);
  });

  test('encodes to exactly the UTF-8 bytes of section 3.2.4', () => {
    const bytes = hexToBytes(readText(...FIXTURES, 'section-3.2.4-utf8.hex'));
    assert.equal(bytes.length, 118);
    assert.deepEqual(Buffer.from(canonicalBytes(canonicalOf(input))), bytes);
  });

  test('explains each number spelling that changes', () => {
    const result = canonicalize(input);
    assert.equal(result.changedNumbers, 5);
    const representation = result.issues.filter((i) => i.code === 'number-representation').map((i) => i.message);
    assert.deepEqual(representation, [
      'Number representation changes: 333333333.33333329 → 333333333.3333333 (the decimal value differs; both denote the same IEEE 754 double).',
      'Number representation changes: 1E30 → 1e+30 (same value, different spelling).',
      'Number representation changes: 4.50 → 4.5 (same value, different spelling).',
      'Number representation changes: 2e-3 → 0.002 (same value, different spelling).',
      'Number representation changes: 0.000000000000000000000000001 → 1e-27 (same value, different spelling).',
    ]);
    // 1E30 is an integer far outside the safe range.
    assert.equal(result.counts['unsafe-integer'], 1);
    assert.equal(result.errorCount, 0);
  });
});

describe('RFC 8785 section 3.2.3 sorting example', () => {
  const input = readText(...FIXTURES, 'section-3.2.3-sorting-input.json');
  const order = readText(...FIXTURES, 'section-3.2.3-sorting-expected-order.txt').trim().split('\n');

  test('orders properties by UTF-16 code units', () => {
    const canonical = canonicalOf(input);
    const { root } = parse(canonical, { add: () => assert.fail('canonical output must parse cleanly'), numberChanged: () => {} });
    assert.ok(root && root.kind === 'object');
    const values = (root as ObjectNode).members.map((m) => (m.value.kind === 'string' ? m.value.value : ''));
    assert.deepEqual(values, order);
  });

  test('produces the exact canonical text', () => {
    const expected =
      '{"' + BS + 'r":"Carriage Return","1":"One","' + chr(0x80) + '":"Control","' + chr(0xf6) +
      '":"Latin Small Letter O With Diaeresis","' + chr(0x20ac) + '":"Euro Sign","' + chr(0xd83d, 0xde00) +
      '":"Emoji: Grinning Face","' + chr(0xfb33) + '":"Hebrew Letter Dalet With Dagesh"}';
    assert.equal(canonicalOf(input), expected);
  });
});

describe('RFC 8785 Appendix B number serialization samples', () => {
  const rows = readText(...FIXTURES, 'appendix-b-numbers.txt')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.split('|').map((cell) => cell.trim()) as [string, string, string]);

  test('the table was transcribed completely', () => {
    assert.equal(rows.length, 26);
  });

  for (const [bits, json, comment] of rows) {
    const value = doubleFromBits(bits);
    if (json === '') {
      test(`${bits} (${comment}) cannot be serialized`, () => {
        assert.ok(!Number.isFinite(value));
        assert.throws(() => serializeNumber(value), RangeError);
      });
      continue;
    }
    test(`${bits} serializes as ${json}`, () => {
      assert.equal(serializeNumber(value), json);
    });
    test(`${json} read as JSON text canonicalizes to itself`, () => {
      assert.equal(canonicalOf(json), json);
      assert.equal(canonicalOf(`[${json}]`), `[${json}]`);
    });
  }

  test('minus zero (8000000000000000) is written as 0 and reported', () => {
    const result = canonicalize('-0');
    assert.equal(result.canonical, '0');
    assert.deepEqual(result.issues.map((i) => i.code), ['negative-zero']);
  });

  test('values out of range are errors in JSON text', () => {
    for (const text of ['1e400', '-1e400', '1.7976931348623159e308']) {
      const result = canonicalize(text);
      assert.equal(result.canonical, undefined, text);
      assert.deepEqual(result.issues.map((i) => i.code), ['number-overflow'], text);
    }
  });
});
