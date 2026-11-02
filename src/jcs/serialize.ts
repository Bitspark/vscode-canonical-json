/**
 * RFC 8785 serialization, written directly from the parse tree.
 *
 * The tree is never turned into JavaScript objects: an object built from
 * parsed members would reorder integer-like keys ("2" before "10") and could
 * not represent duplicate or special names faithfully.
 */

import { serializeNumber } from './numbers.ts';
import type { Member, ValueNode } from './parser.ts';

/** Orders property names by their UTF-16 code units, independent of locale. */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byName(a: Member, b: Member): number {
  return compareNames(a.name.value, b.name.value);
}

/**
 * Serializes a tree that has no errors. Strings are written as ECMAScript's
 * `JSON.stringify(string)` writes them, numbers as `Number.prototype.toString`,
 * and object members in code-unit order of their decoded names. No whitespace.
 */
export function serialize(root: ValueNode): string {
  const out: string[] = [];
  const write = (node: ValueNode): void => {
    switch (node.kind) {
      case 'object': {
        out.push('{');
        const members = [...node.members].sort(byName);
        for (let i = 0; i < members.length; i++) {
          const member = members[i]!;
          if (i > 0) out.push(',');
          out.push(JSON.stringify(member.name.value), ':');
          write(member.value);
        }
        out.push('}');
        return;
      }
      case 'array': {
        out.push('[');
        for (let i = 0; i < node.elements.length; i++) {
          if (i > 0) out.push(',');
          write(node.elements[i]!);
        }
        out.push(']');
        return;
      }
      case 'string':
        out.push(JSON.stringify(node.value));
        return;
      case 'number':
        out.push(serializeNumber(node.value));
        return;
      case 'literal':
        out.push(node.raw);
        return;
    }
  };
  write(root);
  return out.join('');
}
