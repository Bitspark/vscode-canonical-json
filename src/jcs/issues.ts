/**
 * Findings reported while reading a document for RFC 8785 canonicalization.
 *
 * Errors block canonical output and hashing. Notices never block; they
 * explain how a number's text changes in canonical form.
 */

export type Severity = 'error' | 'warning' | 'info';

export type ErrorCode =
  | 'syntax'
  | 'input-too-large'
  | 'nesting-too-deep'
  | 'duplicate-name'
  | 'lone-surrogate'
  | 'number-overflow';

export type NoticeCode =
  | 'number-representation'
  | 'number-underflow'
  | 'negative-zero'
  | 'unsafe-integer';

export type IssueCode = ErrorCode | NoticeCode;

export const ERROR_CODES: readonly ErrorCode[] = [
  'syntax',
  'input-too-large',
  'nesting-too-deep',
  'duplicate-name',
  'lone-surrogate',
  'number-overflow',
];

export const NOTICE_CODES: readonly NoticeCode[] = [
  'number-representation',
  'number-underflow',
  'negative-zero',
  'unsafe-integer',
];

/** A source range in UTF-16 code units: `start` inclusive, `end` exclusive. */
export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export interface Issue extends SourceRange {
  readonly code: IssueCode;
  readonly severity: Severity;
  readonly message: string;
  /** A second location that explains this one, e.g. the first of two duplicate names. */
  readonly related?: SourceRange & { readonly message: string };
}

export function isError(issue: Issue): boolean {
  return issue.severity === 'error';
}

/**
 * Shortens text quoted in a message (long numbers, long property names) so a
 * single diagnostic never carries megabytes of document content.
 */
export function abbreviate(text: string, max = 48): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  // Do not split a surrogate pair.
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}
