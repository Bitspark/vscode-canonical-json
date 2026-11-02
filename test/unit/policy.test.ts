// The input policy: what is an error (blocks output and hashing), what is a
// notice (explains a number spelling change, never blocks), and the limits.
// The lone-surrogate and overflow cases include ones adapted from
// https://github.com/erdtman/json-canonicalisation-comparison (MIT; see NOTICE).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canonicalize, MAX_INPUT_BYTES, MAX_REPORTED_ISSUES, utf8Length } from '../../src/jcs/canonicalize.ts';
import { MAX_DEPTH } from '../../src/jcs/parser.ts';
import { BS, canonicalOf, chr, codes, esc, onlyIssue } from './helpers.ts';

describe('errors block output', () => {
  describe('duplicate property names, compared after decoding escapes', () => {
    test('a literal duplicate', () => {
      const text = '{"a":1,"a":2}';
      const result = canonicalize(text);
      assert.equal(result.canonical, undefined);
      const issue = onlyIssue(result);
      assert.equal(issue.code, 'duplicate-name');
      assert.equal(issue.severity, 'error');
      assert.deepEqual([issue.start, issue.end], [7, 10], 'points at the second name');
      assert.deepEqual([issue.related?.start, issue.related?.end], [1, 4], 'related points at the first');
    });

    test('a duplicate that only appears after decoding \\u escapes', () => {
      const text = `{"a":1,"${esc('0061')}":2}`;
      const result = canonicalize(text);
      assert.equal(result.canonical, undefined);
      const issue = onlyIssue(result);
      assert.equal(issue.code, 'duplicate-name');
      assert.match(issue.message, /after decoding escapes/);
    });

    test('duplicates through short escapes and surrogate-pair escapes', () => {
      assert.deepEqual(codes(canonicalize(`{"${BS}/":1,"/":2}`)), ['duplicate-name']);
      assert.deepEqual(codes(canonicalize(`{"${BS}n":1,"${esc('000a')}":2}`)), ['duplicate-name']);
      const emoji = chr(0xd83d, 0xde00);
      assert.deepEqual(codes(canonicalize(`{"${emoji}":1,"${esc('d83d')}${esc('de00')}":2}`)), ['duplicate-name']);
    });

    test('every duplicate is reported, in nested objects too', () => {
      const result = canonicalize('{"a":{"x":1,"x":2},"b":[{"y":1,"y":2}],"a":3}');
      assert.deepEqual(codes(result), ['duplicate-name', 'duplicate-name', 'duplicate-name']);
    });

    test('same names in different objects are not duplicates', () => {
      assert.equal(canonicalOf('{"a":{"a":1},"b":{"a":2}}'), '{"a":{"a":1},"b":{"a":2}}');
    });

    test('names differing only by case or normalization are distinct', () => {
      // U+00C5 versus "A" + U+030A: no Unicode normalization.
      const text = `{"A":1,"a":2,"${esc('00c5')}":3,"A${esc('030a')}":4}`;
      assert.equal(canonicalOf(text), `{"A":1,"A${chr(0x30a)}":4,"a":2,"${chr(0xc5)}":3}`);
    });
  });

  describe('lone surrogates', () => {
    const cases: [string, string, number][] = [
      ['escaped high surrogate', `"${esc('d800')}"`, 0xd800],
      ['escaped low surrogate', `"${esc('dc00')}"`, 0xdc00],
      ['raw high surrogate', `"${chr(0xd800)}"`, 0xd800],
      ['raw low surrogate', `"${chr(0xdfff)}"`, 0xdfff],
      ['high surrogate before a non-surrogate', `"${esc('d83d')}x"`, 0xd83d],
      ['high surrogate at the end of a string', `"ab${esc('dbff')}"`, 0xdbff],
      ['two high surrogates (the first is lone)', `"${esc('d83d')}${esc('d83d')}${esc('de00')}"`, 0xd83d],
    ];
    for (const [name, text, unit] of cases) {
      test(name, () => {
        const result = canonicalize(text);
        assert.equal(result.canonical, undefined);
        const issue = onlyIssue(result);
        assert.equal(issue.code, 'lone-surrogate');
        assert.match(issue.message, new RegExp(`U\\+${unit.toString(16).toUpperCase()}`));
      });
    }

    test('reversed pair: both halves are lone', () => {
      const result = canonicalize(`"${esc('de00')}${esc('d83d')}"`);
      assert.deepEqual(codes(result), ['lone-surrogate', 'lone-surrogate']);
      assert.deepEqual(result.issues.map((i) => [i.start, i.end]), [[1, 7], [7, 13]]);
    });

    test('in a property name', () => {
      assert.deepEqual(codes(canonicalize(`{"${esc('d800')}":1}`)), ['lone-surrogate']);
    });

    test('the range of a raw lone surrogate is that code unit', () => {
      const issue = onlyIssue(canonicalize(`["ok", "x${chr(0xdc00)}"]`));
      assert.deepEqual([issue.start, issue.end], [9, 10]);
      assert.match(issue.message, /written directly/);
    });

    test('valid surrogate pairs are accepted: escaped, raw, and mixed', () => {
      const emoji = chr(0xd83d, 0xde00);
      assert.equal(canonicalOf(`"${esc('d83d')}${esc('de00')}"`), `"${emoji}"`);
      assert.equal(canonicalOf(`"${emoji}"`), `"${emoji}"`);
      assert.equal(canonicalOf(`"${chr(0xd83d)}${esc('de00')}"`), `"${emoji}"`);
      assert.equal(canonicalOf(`"${esc('d83d')}${chr(0xde00)}"`), `"${emoji}"`);
      assert.equal(canonicalOf(`"${esc('dbff')}${esc('dfff')}"`), `"${chr(0xdbff, 0xdfff)}"`);
    });
  });

  describe('numbers that overflow binary64', () => {
    for (const text of ['1e400', '-1e400', '1.8e308', '[0, 1e309]', '{"x": 123456789e303}']) {
      test(text, () => {
        const result = canonicalize(text);
        assert.equal(result.canonical, undefined);
        assert.equal(onlyIssue(result).code, 'number-overflow');
      });
    }
    test('the largest finite double is fine', () => {
      assert.equal(canonicalOf('1.7976931348623157e308'), '1.7976931348623157e+308');
    });
  });

  test('all semantic errors in a document are reported together', () => {
    const result = canonicalize(`{"a":1,"a":2,"s":"${esc('d800')}","n":1e999}`);
    assert.deepEqual(codes(result).sort(), ['duplicate-name', 'lone-surrogate', 'number-overflow']);
    assert.equal(result.errorCount, 3);
  });
});

describe('syntax errors (strict RFC 8259), each with its position', () => {
  const cases: [string, string, number, RegExp][] = [
    ['line comment', '{"a":1} // note', 8, /Comments are not allowed/],
    ['block comment', '[1, /* two */ 2]', 4, /Comments are not allowed/],
    ['comment before the value', '// c\n{}', 0, /Comments are not allowed/],
    ['trailing comma in an object', '{"a":1,}', 6, /Trailing comma before `}`/],
    ['trailing comma in an array', '[1,2,]', 4, /Trailing comma before `]`/],
    ['single-quoted string', "['a']", 1, /Single-quoted strings/],
    ['single-quoted name', "{'a':1}", 1, /Single-quoted strings/],
    ['unquoted name', '{a:1}', 1, /must be in double quotes/],
    ['leading zero', '[01]', 1, /Leading zeros/],
    ['negative leading zero', '-012', 0, /Leading zeros/],
    ['NaN', '[NaN]', 1, /NaN is not a JSON value/],
    ['Infinity', 'Infinity', 0, /Infinity is not a JSON value/],
    ['-Infinity', '[-Infinity]', 1, /-Infinity is not a JSON value/],
    ['leading plus', '+1', 0, /leading `\+`/],
    ['leading decimal point', '.5', 0, /must start with a digit/],
    ['trailing decimal point', '1.', 0, /after the decimal point/],
    ['empty exponent', '1e+', 0, /in the exponent/],
    ['hexadecimal number', '0x1F', 0, /Invalid number `0x1F`/],
    ['unterminated string', '{"a":"abc', 5, /Unterminated string/],
    ['unterminated string at a line break', '["abc\n]', 5, /Unescaped line break/],
    ['raw tab in a string', '"a\tb"', 2, /Control character U\+0009/],
    ['raw NUL in a string', `"a${chr(0)}"`, 2, /Control character U\+0000/],
    ['raw U+001F in a string', `"${chr(0x1f)}"`, 1, /Control character U\+001F/],
    ['invalid escape', `"${BS}x"`, 1, /Invalid escape sequence/],
    ['short unicode escape', `"${BS}u12"`, 1, /four hex digits/],
    ['trailing content', '{} {}', 3, /after the JSON value/],
    ['two top-level numbers', '1 2', 2, /after the JSON value/],
    ['trailing garbage', 'true x', 5, /after the JSON value/],
    ['empty document', '', 0, /empty/],
    ['whitespace only', ' \n\t ', 4, /empty/],
    ['missing colon', '{"a" 1}', 5, /expected `:`/],
    ['missing comma between members', '{"a":1 "b":2}', 7, /Missing `,`/],
    ['missing comma between elements', '[1 2]', 3, /expected `,` or `]`/],
    ['capitalized literal', 'True', 0, /literals are lowercase/],
    ['truncated literal', '[nul]', 1, /not a JSON literal/],
    ['unclosed array', '[1,2', 4, /not closed with `]`/],
    ['unclosed object', '{"a":1', 6, /not closed with `}`/],
    ['byte order mark', `${chr(0xfeff)}{}`, 0, /byte order mark/],
    ['non-JSON whitespace', `[1,${chr(0xa0)}2]`, 3, /JSON whitespace is only/],
  ];
  for (const [name, text, start, message] of cases) {
    test(name, () => {
      const result = canonicalize(text);
      assert.equal(result.canonical, undefined);
      const issue = onlyIssue(result);
      assert.equal(issue.code, 'syntax');
      assert.equal(issue.severity, 'error');
      assert.equal(issue.start, start);
      assert.match(issue.message, message);
    });
  }

  test('a comment range covers the whole comment', () => {
    const issue = onlyIssue(canonicalize('[1, /* two */ 2]'));
    assert.deepEqual([issue.start, issue.end], [4, 13]);
  });
});

describe('number notices never block output', () => {
  const representation: [string, string, boolean][] = [
    ['1.0', '1', true],
    ['1e3', '1000', true],
    ['1E3', '1000', true],
    ['4.50', '4.5', true],
    ['0.0', '0', true],
    ['1e21', '1e+21', true],
    ['0.000001e0', '0.000001', true],
    ['333333333.33333329', '333333333.3333333', false],
    ['0.30000000000000001', '0.3', false],
    ['4.9e-324', '5e-324', false],
  ];
  for (const [raw, canonical, sameValue] of representation) {
    test(`${raw} → ${canonical}`, () => {
      const result = canonicalize(raw);
      assert.equal(result.canonical, canonical);
      assert.equal(result.changedNumbers, 1);
      const issue = result.issues.find((i) => i.code === 'number-representation');
      assert.ok(issue, 'has a representation notice');
      assert.equal(issue.severity, 'info');
      assert.ok(issue.message.includes(`${raw} → ${canonical}`), issue.message);
      assert.match(issue.message, sameValue ? /same value, different spelling/ : /decimal value differs/);
      assert.doesNotMatch(issue.message, /precision/i);
    });
  }

  test('canonical spellings produce no notice', () => {
    for (const text of ['0', '1', '-1', '0.5', '1e-7', '123.456', '9007199254740991', '-5e-324']) {
      const result = canonicalize(text);
      assert.equal(result.issues.length, 0, text);
      assert.equal(result.changedNumbers, 0, text);
    }
  });

  test('a nonzero number that becomes 0 gets its own warning', () => {
    for (const raw of ['1e-400', '-1e-400', '2.4e-324']) {
      const result = canonicalize(raw);
      assert.equal(result.canonical, '0');
      const issue = onlyIssue(result);
      assert.equal(issue.code, 'number-underflow');
      assert.equal(issue.severity, 'warning');
      assert.match(issue.message, /Nonzero number .* becomes 0/);
    }
    // The smallest subnormal survives.
    assert.equal(canonicalOf('2.5e-324'), '5e-324');
  });

  test('-0 loses the negative-zero distinction', () => {
    for (const raw of ['-0', '-0.0', '-0e5', '-0.000E-10']) {
      const result = canonicalize(raw);
      assert.equal(result.canonical, '0', raw);
      const issue = onlyIssue(result);
      assert.equal(issue.code, 'negative-zero');
      assert.match(issue.message, /negative-zero distinction/);
      assert.ok(issue.message.includes(`${raw} → 0`), issue.message);
    }
  });

  describe('safe integer range ±(2^53−1)', () => {
    for (const raw of ['9007199254740991', '-9007199254740991']) {
      test(`${raw} is inside: no notice`, () => {
        assert.equal(canonicalize(raw).issues.length, 0);
      });
    }
    for (const raw of ['9007199254740992', '-9007199254740992']) {
      test(`${raw} is exactly representable but outside: warning only`, () => {
        const result = canonicalize(raw);
        assert.equal(result.canonical, raw);
        const issue = onlyIssue(result);
        assert.equal(issue.code, 'unsafe-integer');
        assert.match(issue.message, /outside the safe integer range; some applications cannot preserve it/);
        assert.doesNotMatch(issue.message, /loses precision/);
      });
    }
    for (const [raw, canonical] of [
      ['9007199254740993', '9007199254740992'],
      ['-9007199254740993', '-9007199254740992'],
    ]) {
      test(`${raw} is not representable: warning and representation change`, () => {
        const result = canonicalize(raw!);
        assert.equal(result.canonical, canonical);
        assert.deepEqual(codes(result), ['number-representation', 'unsafe-integer']);
        assert.equal(result.changedNumbers, 1, 'one value, two notices');
        assert.ok(result.issues[0]!.message.includes(`${raw} → ${canonical}`));
      });
    }
    test('integral values written with an exponent count too', () => {
      assert.deepEqual(codes(canonicalize('1e16')), ['number-representation', 'unsafe-integer']);
      assert.deepEqual(codes(canonicalize('9.007199254740991e15')), ['number-representation']);
    });
  });

  test('changedNumbers counts values, not notices', () => {
    const result = canonicalize('[1.0, 2, 9007199254740993, -0, 1e-400, 9007199254740992, 3]');
    assert.equal(result.changedNumbers, 5);
    assert.equal(result.noticeCount, 6);
    assert.equal(result.errorCount, 0);
    assert.equal(result.canonical, '[1,2,9007199254740992,0,0,9007199254740992,3]');
  });

  test('notice ranges cover the number token', () => {
    const issue = onlyIssue(canonicalize('{"x": 1.50}'));
    assert.deepEqual([issue.start, issue.end], [6, 10]);
  });

  test('long numbers are abbreviated in messages', () => {
    const raw = `1.${'0'.repeat(500)}`;
    const issue = onlyIssue(canonicalize(raw));
    assert.ok(issue.message.length < 200);
    assert.match(issue.message, /…/);
  });
});

describe('limits', () => {
  const nested = (depth: number): string => '['.repeat(depth) + ']'.repeat(depth);

  test(`nesting of exactly ${MAX_DEPTH} levels is accepted`, () => {
    assert.equal(canonicalOf(nested(MAX_DEPTH)), nested(MAX_DEPTH));
    const objects = '{"a":'.repeat(MAX_DEPTH - 1) + '{}' + '}'.repeat(MAX_DEPTH - 1);
    assert.equal(canonicalOf(objects), objects);
  });

  test(`nesting of ${MAX_DEPTH + 1} levels is refused at the level that crosses the limit`, () => {
    const result = canonicalize(nested(MAX_DEPTH + 1));
    assert.equal(result.canonical, undefined);
    const issue = onlyIssue(result);
    assert.equal(issue.code, 'nesting-too-deep');
    assert.equal(issue.start, MAX_DEPTH);
  });

  test('very deep nesting is refused without exhausting the stack', () => {
    const result = canonicalize('['.repeat(500_000));
    assert.equal(onlyIssue(result).code, 'nesting-too-deep');
  });

  test('a document of exactly 20 MiB is accepted', () => {
    const text = `"${'a'.repeat(MAX_INPUT_BYTES - 2)}"`;
    assert.equal(utf8Length(text), MAX_INPUT_BYTES);
    const result = canonicalize(text);
    assert.equal(result.errorCount, 0);
    assert.equal(result.canonical?.length, MAX_INPUT_BYTES);
  });

  test('a document one byte over 20 MiB is refused before parsing', () => {
    const result = canonicalize(`"${'a'.repeat(MAX_INPUT_BYTES - 1)}"`);
    assert.equal(result.canonical, undefined);
    const issue = onlyIssue(result);
    assert.equal(issue.code, 'input-too-large');
    assert.match(issue.message, /20 MiB/);
  });

  test('the limit counts UTF-8 bytes, not UTF-16 code units', () => {
    // 7 Mi euro signs: 7 Mi code units, 21 MiB of UTF-8.
    const text = `"${chr(0x20ac).repeat(7 * 1024 * 1024)}"`;
    assert.ok(text.length < MAX_INPUT_BYTES);
    assert.equal(onlyIssue(canonicalize(text)).code, 'input-too-large');
  });

  test(`at most ${MAX_REPORTED_ISSUES} issues are kept; the rest are counted`, () => {
    const text = `[${Array.from({ length: 1500 }, () => '1.0').join(',')}]`;
    const result = canonicalize(text);
    assert.equal(result.issues.length, MAX_REPORTED_ISSUES);
    assert.equal(result.omittedIssues, 500);
    assert.equal(result.changedNumbers, 1500);
    assert.equal(result.counts['number-representation'], 1500);
    assert.ok(result.canonical?.startsWith('[1,1,'));
  });
});

describe('utf8Length', () => {
  test('counts bytes per code point', () => {
    assert.equal(utf8Length(''), 0);
    assert.equal(utf8Length('a'), 1);
    assert.equal(utf8Length(chr(0xe9)), 2);
    assert.equal(utf8Length(chr(0x20ac)), 3);
    assert.equal(utf8Length(chr(0xd83d, 0xde00)), 4);
    assert.equal(utf8Length(chr(0xd800)), 3, 'a lone surrogate counts as U+FFFD');
    const sample = `a${chr(0xe9)}${chr(0x20ac)}${chr(0xd83d, 0xde00)}${chr(0xdc00)}z`;
    assert.equal(utf8Length(sample), Buffer.byteLength(sample, 'utf8'));
  });
});
