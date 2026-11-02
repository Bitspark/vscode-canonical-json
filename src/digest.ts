/**
 * The byte contract: the digest is SHA-256 over exactly the UTF-8 encoding of
 * the canonical text. No byte order mark, no trailing newline, nothing else.
 */

import { createHash } from 'node:crypto';

export interface CanonicalDigest {
  /** Length of the canonical text in UTF-8 bytes. */
  readonly bytes: number;
  /** SHA-256 of those bytes, lowercase hexadecimal. */
  readonly sha256: string;
}

export function canonicalBytes(canonical: string): Uint8Array {
  return new TextEncoder().encode(canonical);
}

export function digestCanonical(canonical: string): CanonicalDigest {
  const bytes = canonicalBytes(canonical);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
