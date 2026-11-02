/**
 * RFC 8785 (JSON Canonicalization Scheme) for one whole document.
 *
 * Input policy: strict RFC 8259 JSON. Syntax errors, duplicate property names
 * (compared after decoding escapes), lone surrogates, numbers that overflow
 * binary64, inputs over the size limit and nesting over the depth limit are
 * errors and produce no canonical text. Number notices never block.
 */

import { ERROR_CODES, NOTICE_CODES, type Issue, type IssueCode } from './issues.ts';
import { MAX_DEPTH, parse } from './parser.ts';
import { serialize } from './serialize.ts';

export { MAX_DEPTH };

/** 20 MiB of UTF-8. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** At most this many issues are kept with their locations; the rest are counted. */
export const MAX_REPORTED_ISSUES = 1000;

export interface CanonicalResult {
  /** The canonical text, or undefined when the document has errors. */
  readonly canonical: string | undefined;
  /** Issues in the order found, at most MAX_REPORTED_ISSUES of them. */
  readonly issues: readonly Issue[];
  /** Issues found but not kept because of MAX_REPORTED_ISSUES. */
  readonly omittedIssues: number;
  /** Number of issues found per code, including omitted ones. */
  readonly counts: Readonly<Record<IssueCode, number>>;
  readonly errorCount: number;
  readonly noticeCount: number;
  /** Number tokens that produced at least one notice. */
  readonly changedNumbers: number;
}

/** Number of bytes in the UTF-8 encoding of `text` (a lone surrogate counts as U+FFFD). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

function emptyCounts(): Record<IssueCode, number> {
  const counts = {} as Record<IssueCode, number>;
  for (const code of [...ERROR_CODES, ...NOTICE_CODES]) counts[code] = 0;
  return counts;
}

export function canonicalize(text: string): CanonicalResult {
  const issues: Issue[] = [];
  const counts = emptyCounts();
  let omittedIssues = 0;
  let errorCount = 0;
  let noticeCount = 0;
  let changedNumbers = 0;

  const add = (issue: Issue): void => {
    counts[issue.code]++;
    if (issue.severity === 'error') errorCount++;
    else noticeCount++;
    if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue);
    else omittedIssues++;
  };

  // Every UTF-16 code unit takes at least one UTF-8 byte, so the cheap length
  // check settles very large inputs without walking them.
  const bytes = text.length > MAX_INPUT_BYTES ? Infinity : utf8Length(text);
  if (bytes > MAX_INPUT_BYTES) {
    add({
      code: 'input-too-large',
      severity: 'error',
      start: 0,
      end: 0,
      message:
        `The document is larger than 20 MiB (${MAX_INPUT_BYTES} bytes of UTF-8)` +
        `${Number.isFinite(bytes) ? `: it is ${bytes} bytes` : ''}; ` +
        `this extension does not canonicalize documents that large.`,
    });
  } else {
    const { root } = parse(text, {
      add,
      numberChanged: () => {
        changedNumbers++;
      },
    });
    if (root !== undefined && errorCount === 0) {
      return {
        canonical: serialize(root),
        issues,
        omittedIssues,
        counts,
        errorCount,
        noticeCount,
        changedNumbers,
      };
    }
  }
  return { canonical: undefined, issues, omittedIssues, counts, errorCount, noticeCount, changedNumbers };
}
