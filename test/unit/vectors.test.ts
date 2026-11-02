// Reference test data from https://github.com/cyberphone/json-canonicalization
// (Apache-2.0, see NOTICE), stored unchanged in test/vectors/cyberphone/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import oracle from 'canonicalize';
import { canonicalBytes, digestCanonical } from '../../src/digest.ts';
import { canonicalize } from '../../src/jcs/canonicalize.ts';
import { serializeNumber } from '../../src/jcs/numbers.ts';
import { canonicalOf, doubleFromBits, hexToBytes, readBytes, readText, ROOT, sha256Hex } from './helpers.ts';

const VECTORS = ['test', 'vectors', 'cyberphone'] as const;
const names = readdirSync(path.join(ROOT, ...VECTORS, 'input')).filter((f) => f.endsWith('.json')).sort();

describe('cyberphone/json-canonicalization testdata', () => {
  test('all six input/output pairs are present', () => {
    assert.deepEqual(names, ['arrays.json', 'french.json', 'structures.json', 'unicode.json', 'values.json', 'weird.json']);
  });

  for (const name of names) {
    const input = readText(...VECTORS, 'input', name);
    const output = readBytes(...VECTORS, 'output', name);
    const outhex = hexToBytes(readText(...VECTORS, 'outhex', name.replace(/\.json$/, '.txt')));

    test(`${name}: canonical bytes equal output/${name}`, () => {
      const canonical = canonicalOf(input);
      assert.deepEqual(Buffer.from(canonicalBytes(canonical)), output);
    });

    test(`${name}: canonical bytes equal outhex/${name.replace(/\.json$/, '.txt')}`, () => {
      assert.deepEqual(Buffer.from(canonicalBytes(canonicalOf(input))), outhex);
    });

    test(`${name}: agrees with the canonicalize package (text and SHA-256)`, () => {
      const ours = canonicalOf(input);
      const theirs = oracle(JSON.parse(input));
      assert.equal(ours, theirs);
      assert.equal(digestCanonical(ours).sha256, sha256Hex(theirs ?? ''));
    });

    test(`${name}: canonical output is a fixed point`, () => {
      const canonical = canonicalOf(input);
      const again = canonicalize(canonical);
      assert.equal(again.canonical, canonical);
      // Canonical spellings never change again (unsafe-integer notices may remain).
      assert.equal(again.counts['number-representation'], 0);
      assert.equal(again.counts['negative-zero'], 0);
      assert.equal(again.counts['number-underflow'], 0);
    });
  }
});

// The ES6 number test file described in testdata/README.md is generated
// deterministically; its published SHA-256 checksums let us verify number
// serialization on a large sample without downloading anything. The static
// value table (numgen-static.txt) is taken from that README and matches
// testdata/numgen.go.
describe('cyberphone ES6 number serialization sequence', () => {
  const staticBits = readText(...VECTORS, 'numgen-static.txt').trim().split('\n');

  function* sequence(): Generator<number> {
    for (const bits of staticBits) yield doubleFromBits(bits);
    for (let i = 0; i < 2000; i++) yield doubleFromBits((0x0010000000000000n + BigInt(i)).toString(16));
    let block: Uint8Array = new Uint8Array(32);
    for (;;) {
      block = createHash('sha256').update(block).digest();
      const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
      for (let k = 0; k < 4; k++) {
        const f = view.getFloat64(k * 8, true);
        if (f !== 0 && Number.isFinite(f)) yield f;
      }
    }
  }

  function bitsOf(f: number): string {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, f);
    return view.getBigUint64(0).toString(16);
  }

  // From testdata/README.md: lines -> SHA-256 of the first N lines.
  const published: [number, string][] = [
    [1000, 'be18b62b6f69cdab33a7e0dae0d9cfa869fda80ddc712221570f9f40a5878687'],
    [10000, 'b9f7a8e75ef22a835685a52ccba7f7d6bdc99e34b010992cbc5864cd12be6892'],
    [100000, '22776e6d4b49fa294a0d0f349268e5c28808fe7e0cb2bcbe28f63894e494d4c7'],
    [1000000, '49415fee2c56c77864931bd3624faad425c3c577d6d74e89a83bc725506dad16'],
  ];

  test('the static table has 168 values', () => {
    assert.equal(staticBits.length, 168);
  });

  test('serializeNumber reproduces the published checksums for the first 1,000,000 values', () => {
    const hash = createHash('sha256');
    const checkpoints = new Map(published);
    const seen: [number, string][] = [];
    let n = 0;
    let batch = '';
    for (const f of sequence()) {
      batch += `${bitsOf(f)},${serializeNumber(f)}\n`;
      n++;
      if (n % 1000 === 0) {
        hash.update(batch);
        batch = '';
      }
      const expected = checkpoints.get(n);
      if (expected !== undefined) {
        seen.push([n, hash.copy().digest('hex')]);
        if (n === 1000000) break;
      }
    }
    assert.deepEqual(seen, published);
  });

  test('the first 20,000 values survive a full canonicalization round trip', () => {
    let n = 0;
    for (const f of sequence()) {
      const spelled = serializeNumber(f);
      const result = canonicalize(spelled);
      assert.equal(result.canonical, spelled);
      assert.equal(result.counts['number-representation'], 0, spelled);
      if (++n === 20000) break;
    }
  });
});
