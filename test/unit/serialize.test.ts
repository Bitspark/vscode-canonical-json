// Serialization rules of RFC 8785 section 3.2, written from the parse tree.
// Several cases are adapted from the hand-written edge cases in
// https://github.com/erdtman/json-canonicalisation-comparison
// (compliance/vectors/edge-cases.mjs, MIT; see NOTICE), restated as JSON text.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareNames } from '../../src/jcs/serialize.ts';
import { BS, canonicalOf, chr, esc } from './helpers.ts';

describe('structure', () => {
  test('whitespace between tokens is removed', () => {
    assert.equal(canonicalOf(' {\r\n\t"a" : [ 1 , 2 ] ,\n "b" : 3 }\n'), '{"a":[1,2],"b":3}');
  });

  test('empty object and empty array', () => {
    assert.equal(canonicalOf('{ }'), '{}');
    assert.equal(canonicalOf('[\n]'), '[]');
    assert.equal(canonicalOf('{"a":{},"b":[]}'), '{"a":{},"b":[]}');
  });

  test('top-level primitives are allowed', () => {
    assert.equal(canonicalOf(' "x" '), '"x"');
    assert.equal(canonicalOf('\n42\n'), '42');
    assert.equal(canonicalOf('true'), 'true');
    assert.equal(canonicalOf('false'), 'false');
    assert.equal(canonicalOf('null'), 'null');
    assert.equal(canonicalOf('-1.5E2'), '-150');
  });

  test('array order is preserved', () => {
    assert.equal(canonicalOf('[3, 1, 2, "b", "a"]'), '[3,1,2,"b","a"]');
  });

  test('objects are sorted recursively, also inside arrays', () => {
    assert.equal(
      canonicalOf('{"z":{"y":1,"x":2},"a":[{"c":3,"b":4}]}'),
      '{"a":[{"b":4,"c":3}],"z":{"x":2,"y":1}}',
    );
  });
});

describe('property order', () => {
  test('integer-like names sort as strings, not as array indices', () => {
    // A JavaScript object would enumerate "1", "2", "10" in numeric order.
    assert.equal(canonicalOf('{"10":"a","2":"b","1":"c","b":"d","A":"e","":"f"}'), '{"":"f","1":"c","10":"a","2":"b","A":"e","b":"d"}');
  });

  test('names are compared as UTF-16 code units, not code points', () => {
    // U+FB33 is above the high surrogate of U+1F600 (0xD83D), so the emoji sorts first.
    const text = `{"${esc('fb33')}":1,"${esc('d83d')}${esc('de00')}":2}`;
    assert.equal(canonicalOf(text), `{"${chr(0xd83d, 0xde00)}":2,"${chr(0xfb33)}":1}`);
  });

  test('sorting uses decoded names, not their escaped spelling', () => {
    // "\r" is U+000D and sorts before "1" (U+0031) although its escape starts with "\" (U+005C).
    assert.equal(canonicalOf(`{"1":"one","${BS}r":"cr"}`), `{"${BS}r":"cr","1":"one"}`);
    assert.equal(canonicalOf(`{"b":1,"${esc('0061')}":2}`), '{"a":2,"b":1}');
  });

  test('prefixes sort first', () => {
    assert.equal(canonicalOf('{"ab":1,"aa":2,"a":3,"":4}'), '{"":4,"a":3,"aa":2,"ab":1}');
  });

  test('names special to JavaScript objects are ordinary names', () => {
    assert.equal(
      canonicalOf('{"constructor":1,"__proto__":{"x":1},"toString":2,"hasOwnProperty":3}'),
      '{"__proto__":{"x":1},"constructor":1,"hasOwnProperty":3,"toString":2}',
    );
  });

  test('compareNames is plain code unit order', () => {
    assert.ok(compareNames('', 'a') < 0);
    assert.ok(compareNames('a', 'aa') < 0);
    assert.ok(compareNames('B', 'a') < 0);
    assert.ok(compareNames(chr(0xd83d, 0xde00), chr(0xfb33)) < 0);
    assert.equal(compareNames('x', 'x'), 0);
  });
});

describe('strings', () => {
  test('C0 control characters: short escapes for \\b \\t \\n \\f \\r, lowercase \\u00xx otherwise', () => {
    const shorthand: Record<number, string> = { 0x08: 'b', 0x09: 't', 0x0a: 'n', 0x0c: 'f', 0x0d: 'r' };
    let input = '"';
    let expected = '"';
    for (let c = 0; c < 0x20; c++) {
      input += esc(c.toString(16).toUpperCase().padStart(4, '0'));
      expected += shorthand[c] ? BS + shorthand[c] : BS + 'u' + c.toString(16).padStart(4, '0');
    }
    assert.equal(canonicalOf(`${input}"`), `${expected}"`);
  });

  test('quote and backslash are escaped; solidus is not', () => {
    assert.equal(canonicalOf(`"${BS}"${BS}${BS}${BS}/"`), `"${BS}"${BS}${BS}/"`);
    assert.equal(canonicalOf(`"${esc('0022')}${esc('005c')}${esc('002f')}"`), `"${BS}"${BS}${BS}/"`);
  });

  test('DEL, C1 controls and line/paragraph separators stay literal', () => {
    for (const unit of [0x7f, 0x80, 0x9f, 0x2028, 0x2029]) {
      assert.equal(canonicalOf(`"${esc(unit.toString(16).padStart(4, '0'))}"`), `"${chr(unit)}"`);
    }
  });

  test('non-ASCII escapes decode to the literal characters', () => {
    assert.equal(canonicalOf(`"${esc('20ac')}${esc('00F6')}"`), `"${chr(0x20ac, 0xf6)}"`);
  });

  test('no Unicode normalization', () => {
    assert.equal(canonicalOf(`"A${esc('030a')}"`), `"A${chr(0x30a)}"`);
    assert.equal(canonicalOf(`"${esc('00c5')}"`), `"${chr(0xc5)}"`);
  });

  test('the HTML-sensitive "</script>" is not escaped', () => {
    assert.equal(canonicalOf('"</script>"'), '"</script>"');
  });
});

describe('numbers (ECMAScript Number::toString)', () => {
  const cases: [string, string][] = [
    ['0', '0'],
    ['-0', '0'],
    ['1e21', '1e+21'],
    ['1e20', '100000000000000000000'],
    ['1e-7', '1e-7'],
    ['0.000001', '0.000001'],
    ['9007199254740991', '9007199254740991'],
    ['0.3333333333333333', '0.3333333333333333'],
    ['333333333.33333329', '333333333.3333333'],
    ['5e-324', '5e-324'],
    ['1.7976931348623157e308', '1.7976931348623157e+308'],
    ['1E+2', '100'],
    ['-1.25e-3', '-0.00125'],
    ['123456789012345680000', '123456789012345680000'],
  ];
  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, () => {
      assert.equal(canonicalOf(input), expected);
    });
  }
});

describe('literals', () => {
  test('true, false and null are written as is', () => {
    assert.equal(canonicalOf('[null, true, false]'), '[null,true,false]');
  });
});
