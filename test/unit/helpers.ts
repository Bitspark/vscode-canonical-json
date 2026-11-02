import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize, type CanonicalResult } from '../../src/jcs/canonicalize.ts';
import type { Issue, IssueCode } from '../../src/jcs/issues.ts';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Backslash and JSON escapes are built from code points so that no source
 * file has to carry escape sequences whose meaning depends on the layer
 * that reads them.
 */
export const BS = String.fromCharCode(0x5c);

/** The six-character JSON escape for one UTF-16 code unit, e.g. esc('20ac'). */
export function esc(hex: string): string {
  return `${BS}u${hex}`;
}

export function chr(...units: number[]): string {
  return String.fromCharCode(...units);
}

export function readText(...parts: string[]): string {
  return readFileSync(path.join(ROOT, ...parts), 'utf8');
}

export function readBytes(...parts: string[]): Buffer {
  return readFileSync(path.join(ROOT, ...parts));
}

export function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/\s+/g, ''), 'hex');
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data).digest('hex');
}

/** Canonical text of a document that must have no errors. */
export function canonicalOf(text: string): string {
  const result = canonicalize(text);
  if (result.canonical === undefined) {
    throw new Error(`unexpected errors: ${result.issues.map((i) => i.message).join(' | ')}`);
  }
  return result.canonical;
}

export function codes(result: CanonicalResult): IssueCode[] {
  return result.issues.map((issue) => issue.code);
}

export function onlyIssue(result: CanonicalResult): Issue {
  if (result.issues.length !== 1) {
    throw new Error(`expected exactly one issue, got ${result.issues.length}: ${codes(result).join(', ')}`);
  }
  return result.issues[0]!;
}

/** Small deterministic PRNG (mulberry32) so failures are reproducible from the seed. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The binary64 value with the given bit pattern (16 hex digits or fewer). */
export function doubleFromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}
