// The byte contract: SHA-256 over exactly the UTF-8 bytes of the canonical
// text; no byte order mark, no trailing newline.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { canonicalBytes, digestCanonical } from '../../src/digest.ts';
import { canonicalOf, chr, hexToBytes, readText } from './helpers.ts';

// SHA-256 of the 118 canonical bytes of RFC 8785 section 3.2.4. Computed once
// independently with Python's hashlib:
//   python -c "import hashlib,sys; b=bytes.fromhex(open(sys.argv[1]).read()); print(len(b), hashlib.sha256(b).hexdigest())" \
//     test/fixtures/rfc8785/section-3.2.4-utf8.hex
//   118 2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb
const RFC_SAMPLE_SHA256 = '2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb';

describe('digest byte contract', () => {
  const sample = canonicalOf(readText('test', 'fixtures', 'rfc8785', 'section-3.2.2-input.json'));

  test('known digest of the RFC 8785 sample (Node crypto and Python hashlib agree)', () => {
    const rfcBytes = hexToBytes(readText('test', 'fixtures', 'rfc8785', 'section-3.2.4-utf8.hex'));
    assert.equal(createHash('sha256').update(rfcBytes).digest('hex'), RFC_SAMPLE_SHA256);
    assert.deepEqual(digestCanonical(sample), { bytes: 118, sha256: RFC_SAMPLE_SHA256 });
  });

  test('the digest is lowercase hexadecimal of 64 characters', () => {
    assert.match(digestCanonical(sample).sha256, /^[0-9a-f]{64}$/);
  });

  test('no byte order mark and no trailing newline', () => {
    const bytes = canonicalBytes(sample);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes[0], 0x7b, 'starts with {');
    assert.equal(bytes[bytes.length - 1], 0x7d, 'ends with }');
    // A trailing newline in the source does not reach the canonical bytes.
    assert.equal(digestCanonical(canonicalOf('{"a":1}\n')).sha256, digestCanonical('{"a":1}').sha256);
    assert.notEqual(digestCanonical('{"a":1}').sha256, createHash('sha256').update('{"a":1}\n').digest('hex'));
  });

  test('bytes are UTF-8: 1 to 4 bytes per code point', () => {
    const text = `"a${chr(0xe9)}${chr(0x20ac)}${chr(0xd83d, 0xde00)}"`;
    const { bytes } = digestCanonical(text);
    assert.equal(bytes, 1 + 1 + 2 + 3 + 4 + 1);
    assert.deepEqual(Buffer.from(canonicalBytes(text)), Buffer.from(text, 'utf8'));
  });

  test('known digests of small canonical texts', () => {
    // Also cross-checked with Python hashlib.
    assert.equal(digestCanonical('{"a":1}').sha256, '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
    assert.equal(digestCanonical('').sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('formatting of the source does not change the digest', () => {
    const a = canonicalOf('{"b":[1.0,true],"a":"x"}');
    const b = canonicalOf('{\n  "a": "x",\n  "b": [1, true]\n}\n');
    assert.equal(a, b);
    assert.equal(digestCanonical(a).sha256, digestCanonical(b).sha256);
  });
});
