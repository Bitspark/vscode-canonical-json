/**
 * RFC 8785 serialization, written directly from the parse tree.
 *
 * The tree is never turned into JavaScript objects: an object built from
 * parsed members would reorder integer-like keys ("2" before "10") and could
 * not represent duplicate or special names faithfully.
 */

import { serializeNumber } from './numbers.ts';
import type { Member, StringNode, ValueNode } from './parser.ts';

/** Orders property names by their UTF-16 code units, independent of locale. */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byName(a: Member, b: Member): number {
  return compareNames(a.name.value, b.name.value);
}

/**
 * A string token in canonical form. Without escapes the token is already
 * canonical: it cannot contain an unescaped quote, backslash or control
 * character, and lone surrogates are errors, so `JSON.stringify` would write
 * it back unchanged. Escapes always make the token longer than its value.
 */
function serializeString(node: StringNode): string {
  return node.raw.length === node.value.length + 2 ? node.raw : JSON.stringify(node.value);
}

/** Members in canonical order; the input array is not modified. */
function sortedMembers(members: readonly Member[]): readonly Member[] {
  for (let i = 1; i < members.length; i++) {
    if (compareNames(members[i - 1]!.name.value, members[i]!.name.value) > 0) {
      return [...members].sort(byName);
    }
  }
  return members;
}

function serializeMember(member: Member): string {
  return `${serializeString(member.name)}:${serialize(member.value)}`;
}

/**
 * Serializes a tree that has no errors. Strings are written as ECMAScript's
 * `JSON.stringify(string)` writes them, numbers as `Number.prototype.toString`,
 * and object members in code-unit order of their decoded names. No whitespace.
 * Recursion depth is bounded by the parser's nesting limit.
 */
export function serialize(node: ValueNode): string {
  switch (node.kind) {
    case 'object':
      return `{${sortedMembers(node.members).map(serializeMember).join(',')}}`;
    case 'array':
      return `[${node.elements.map(serialize).join(',')}]`;
    case 'string':
      return serializeString(node);
    case 'number':
      return serializeNumber(node.value);
    case 'literal':
      return node.raw;
  }
}
