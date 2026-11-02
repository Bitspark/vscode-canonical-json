/**
 * Number semantics for RFC 8785.
 *
 * A JSON number token is read as the nearest IEEE 754 binary64 value
 * (`Number(raw)`, round half to even) and written back with ECMAScript's
 * Number::toString, which is the shortest decimal spelling that reads back
 * as the same binary64 value (RFC 8785 section 3.2.2.3).
 */

import { abbreviate, type Issue } from './issues.ts';

export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 2^53 - 1

/**
 * RFC 8785 number serialization: ECMAScript `Number.prototype.toString`.
 * `-0` is written as `0`. The caller guarantees a finite value.
 */
export function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError('RFC 8785 cannot serialize a non-finite number');
  }
  return String(value); // String(-0) === '0'
}

/** An exact decimal value: (-1)^negative × digits × 10^exponent. */
interface Decimal {
  readonly negative: boolean;
  /** Significant digits without leading or trailing zeros; '' for zero. */
  readonly digits: string;
  readonly exponent: number;
}

/**
 * Reads the exact decimal value of a number spelled in JSON syntax (or in
 * ECMAScript's output syntax, which is a subset with an optional `+` in the
 * exponent).
 */
function toDecimal(text: string): Decimal {
  let i = 0;
  const negative = text.charCodeAt(0) === 0x2d; // '-'
  if (negative) i = 1;
  let end = text.length;
  let expIndex = text.indexOf('e', i);
  if (expIndex < 0) expIndex = text.indexOf('E', i);
  let exponent = 0;
  if (expIndex >= 0) {
    exponent = Number(text.slice(expIndex + 1));
    end = expIndex;
  }
  const dot = text.indexOf('.', i);
  let intPart: string;
  let fracPart = '';
  if (dot >= 0 && dot < end) {
    intPart = text.slice(i, dot);
    fracPart = text.slice(dot + 1, end);
  } else {
    intPart = text.slice(i, end);
  }
  let digits = intPart + fracPart;
  exponent -= fracPart.length;
  let lead = 0;
  while (lead < digits.length && digits.charCodeAt(lead) === 0x30) lead++;
  digits = digits.slice(lead);
  if (digits.length === 0) return { negative, digits: '', exponent: 0 };
  let trail = digits.length;
  while (digits.charCodeAt(trail - 1) === 0x30) trail--;
  exponent += digits.length - trail;
  digits = digits.slice(0, trail);
  return { negative, digits, exponent };
}

function sameDecimalValue(a: Decimal, b: Decimal): boolean {
  if (a.digits === '' || b.digits === '') return a.digits === b.digits;
  return a.negative === b.negative && a.digits === b.digits && a.exponent === b.exponent;
}

/**
 * Compares a number token's source text with its canonical spelling and
 * returns the notices that explain any difference. Returns nothing for a
 * non-finite value; overflow is reported as an error by the parser.
 */
export function numberNotices(raw: string, value: number, start: number, end: number): Issue[] {
  if (!Number.isFinite(value)) return [];
  const canonical = serializeNumber(value);
  const source = toDecimal(raw);
  const shown = abbreviate(raw);
  const notices: Issue[] = [];

  if (value === 0 && source.digits !== '') {
    notices.push({
      code: 'number-underflow',
      severity: 'warning',
      start,
      end,
      message:
        `Nonzero number ${shown} becomes 0 in canonical form: it is smaller than the ` +
        `smallest IEEE 754 double and rounds to zero.`,
    });
  } else if (source.digits === '' && source.negative) {
    notices.push({
      code: 'negative-zero',
      severity: 'warning',
      start,
      end,
      message: `Number ${shown} → 0: canonical form loses the negative-zero distinction.`,
    });
  } else if (raw !== canonical) {
    const same = sameDecimalValue(source, toDecimal(canonical));
    notices.push({
      code: 'number-representation',
      severity: 'info',
      start,
      end,
      message: same
        ? `Number representation changes: ${shown} → ${canonical} (same value, different spelling).`
        : `Number representation changes: ${shown} → ${canonical} (the decimal value differs; ` +
          `both denote the same IEEE 754 double).`,
    });
  }

  if (Number.isInteger(value) && Math.abs(value) > MAX_SAFE_INTEGER) {
    notices.push({
      code: 'unsafe-integer',
      severity: 'warning',
      start,
      end,
      message:
        `Integer ${shown} is outside the safe integer range; some applications cannot preserve it ` +
        `(safe integers are those within ±(2^53−1) = ±9007199254740991).`,
    });
  }
  return notices;
}
