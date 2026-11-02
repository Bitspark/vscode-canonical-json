/**
 * VS Code integration: three commands over the whole active document.
 *
 * Guarantees kept by this file (see README "Privacy"): no network requests,
 * no telemetry, no logging of document contents, and the clipboard is written
 * only by the explicit copy commands and the copy buttons they offer.
 */

import * as vscode from 'vscode';
import { digestCanonical } from './digest.ts';
import { canonicalize, MAX_REPORTED_ISSUES, type CanonicalResult } from './jcs/canonicalize.ts';
import type { Issue, NoticeCode } from './jcs/issues.ts';

const SCHEME = 'canonical-json';
const DIAGNOSTIC_SOURCE = 'Canonical JSON';
const SHOW_PROBLEMS = 'Show Problems';
/** Documents of at least this many UTF-16 code units get a progress notification. */
const LARGE_DOCUMENT = 1024 * 1024;

/** Read-only virtual documents holding the canonical text of an Inspect run. */
class PreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly snapshots = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  set(uri: vscode.Uri, canonical: string): void {
    this.snapshots.set(uri.toString(), canonical);
    this.changed.fire(uri);
  }

  delete(uri: vscode.Uri): void {
    this.snapshots.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const canonical = this.snapshots.get(uri.toString());
    if (canonical === undefined) {
      throw new Error(
        'This canonical JSON preview is no longer available. Run "Canonical JSON: Inspect Canonical JSON" on the source document again.',
      );
    }
    return canonical;
  }

  dispose(): void {
    this.changed.dispose();
    this.snapshots.clear();
  }
}

/** One preview per source document; the source URI travels in the query. */
function previewUriFor(source: vscode.Uri): vscode.Uri {
  const base = source.path.split('/').pop() || 'document';
  const stem = base.replace(/\.[^.]+$/, '') || base;
  return vscode.Uri.from({ scheme: SCHEME, path: `/${stem} (canonical).json`, query: source.toString() });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function where(doc: vscode.TextDocument, offset: number): string {
  const p = doc.positionAt(offset);
  return `line ${p.line + 1}, column ${p.character + 1}`;
}

function toDiagnostic(doc: vscode.TextDocument, issue: Issue): vscode.Diagnostic {
  const range = new vscode.Range(doc.positionAt(issue.start), doc.positionAt(issue.end));
  const severity =
    issue.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : issue.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
  const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = issue.code;
  if (issue.related) {
    const relatedRange = new vscode.Range(doc.positionAt(issue.related.start), doc.positionAt(issue.related.end));
    diagnostic.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(new vscode.Location(doc.uri, relatedRange), issue.related.message),
    ];
  }
  return diagnostic;
}

const NOTICE_PHRASES: Readonly<Record<NoticeCode, [string, string]>> = {
  'number-representation': ['representation change', 'representation changes'],
  'number-underflow': ['nonzero number that becomes 0', 'nonzero numbers that become 0'],
  'negative-zero': ['negative zero that becomes 0', 'negative zeros that become 0'],
  'unsafe-integer': ['integer outside the safe integer range', 'integers outside the safe integer range'],
};

function noticeSummary(result: CanonicalResult): string {
  const parts: string[] = [];
  for (const [code, [one, many]] of Object.entries(NOTICE_PHRASES) as [NoticeCode, [string, string]][]) {
    const n = result.counts[code];
    if (n > 0) parts.push(plural(n, one, many));
  }
  return parts.join(', ');
}

function errorSummary(doc: vscode.TextDocument, result: CanonicalResult): string {
  const first = result.issues.find((issue) => issue.severity === 'error');
  const head = `the document has ${plural(result.errorCount, 'error')}`;
  return first ? `${head}. First, at ${where(doc, first.start)}: ${first.message}` : `${head}.`;
}

function showProblems(choice: string | undefined): void {
  if (choice === SHOW_PROBLEMS) void vscode.commands.executeCommand('workbench.actions.view.problems');
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('canonical-json');
  const previews = new PreviewProvider();

  /** Canonicalizes the whole document, including unsaved edits, and publishes diagnostics. */
  const analyze = async (doc: vscode.TextDocument): Promise<CanonicalResult> => {
    const text = doc.getText();
    let result: CanonicalResult;
    if (text.length < LARGE_DOCUMENT) {
      result = canonicalize(text);
    } else {
      // Large documents take seconds; show progress while the extension host is busy.
      result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Canonical JSON: canonicalizing a large document…' },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return canonicalize(text);
        },
      );
    }
    const list = result.issues.map((issue) => toDiagnostic(doc, issue));
    if (result.omittedIssues > 0) {
      const omittedErrors = result.errorCount - result.issues.filter((issue) => issue.severity === 'error').length;
      list.push(
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `${plural(result.omittedIssues, 'more issue')} not listed (${plural(omittedErrors, 'error')}, ` +
            `${plural(result.omittedIssues - omittedErrors, 'notice')}); only the first ${MAX_REPORTED_ISSUES} are shown.`,
          omittedErrors > 0 ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Information,
        ),
      );
      list[list.length - 1]!.source = DIAGNOSTIC_SOURCE;
    }
    diagnostics.set(doc.uri, list);
    return result;
  };

  const resolveDocument = async (arg: unknown): Promise<vscode.TextDocument | undefined> => {
    if (arg instanceof vscode.Uri) {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === arg.toString());
      if (open) return open;
      try {
        return await vscode.workspace.openTextDocument(arg);
      } catch {
        // Fall back to the active editor.
      }
    }
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) void vscode.window.showErrorMessage('Canonical JSON: open a JSON document in an editor first.');
    return doc;
  };

  /** Asks once before copying when numbers change in canonical form. */
  const confirmNumberChanges = async (doc: vscode.TextDocument, result: CanonicalResult): Promise<boolean> => {
    if (result.changedNumbers === 0) return true;
    const choice = await vscode.window.showWarningMessage(
      `This document's numbers change in canonical form (${plural(result.changedNumbers, 'value')}). Copy anyway?`,
      {
        modal: true,
        detail: `Notices: ${noticeSummary(result)}. The copy uses the canonical form; the document itself is not changed.`,
      },
      'Copy',
      'Show Changes',
    );
    if (choice === 'Show Changes') {
      await vscode.commands.executeCommand('canonicalJson.inspect', doc.uri);
      return false;
    }
    return choice === 'Copy';
  };

  /** Shared front half of the copy commands: canonical text, or undefined after telling the user why not. */
  const canonicalForCopy = async (arg: unknown): Promise<string | undefined> => {
    const doc = await resolveDocument(arg);
    if (!doc) return undefined;
    const result = await analyze(doc);
    if (result.canonical === undefined) {
      void vscode.window
        .showErrorMessage(`Canonical JSON: nothing copied; ${errorSummary(doc, result)}`, SHOW_PROBLEMS)
        .then(showProblems);
      return undefined;
    }
    if (!(await confirmNumberChanges(doc, result))) return undefined;
    return result.canonical;
  };

  const inspect = async (arg: unknown): Promise<void> => {
    const doc = await resolveDocument(arg);
    if (!doc) return;
    const result = await analyze(doc);
    // Inspecting a preview shows that same preview: canonical text is its own canonical form.
    const previewUri = doc.uri.scheme === SCHEME ? doc.uri : previewUriFor(doc.uri);
    if (result.canonical === undefined) {
      // Errors block output: retire any earlier preview of this document.
      const stale = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === previewUri.toString());
      if (stale.length > 0) await vscode.window.tabGroups.close(stale, true);
      previews.delete(previewUri);
      void vscode.window
        .showErrorMessage(`Canonical JSON: no canonical form; ${errorSummary(doc, result)}`, SHOW_PROBLEMS)
        .then(showProblems);
      return;
    }
    const canonical = result.canonical;
    const { bytes, sha256 } = digestCanonical(canonical);
    previews.set(previewUri, canonical);
    const preview = await vscode.workspace.openTextDocument(previewUri);
    await vscode.window.showTextDocument(preview, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: true,
    });
    void vscode.window
      .showInformationMessage(
        `${plural(bytes, 'byte')} · SHA-256 of canonical JSON: ${sha256.slice(0, 16)}…`,
        'Copy SHA-256',
        'Copy canonical JSON',
      )
      .then(async (choice) => {
        if (choice === 'Copy SHA-256') {
          await vscode.env.clipboard.writeText(sha256);
          void vscode.window.showInformationMessage(`Copied SHA-256 of canonical JSON: ${sha256}`);
        } else if (choice === 'Copy canonical JSON') {
          await vscode.env.clipboard.writeText(canonical);
          void vscode.window.showInformationMessage(`Copied canonical JSON (${plural(bytes, 'byte')}).`);
        }
      });
  };

  const copyCanonical = async (arg: unknown): Promise<void> => {
    const canonical = await canonicalForCopy(arg);
    if (canonical === undefined) return;
    const { bytes } = digestCanonical(canonical);
    await vscode.env.clipboard.writeText(canonical);
    void vscode.window.showInformationMessage(`Copied canonical JSON (${plural(bytes, 'byte')}).`);
  };

  const copySha256 = async (arg: unknown): Promise<void> => {
    const canonical = await canonicalForCopy(arg);
    if (canonical === undefined) return;
    const { sha256 } = digestCanonical(canonical);
    await vscode.env.clipboard.writeText(sha256);
    void vscode.window.showInformationMessage(`Copied SHA-256 of canonical JSON: ${sha256}`);
  };

  const guarded =
    (run: (arg: unknown) => Promise<void>) =>
    async (arg: unknown): Promise<void> => {
      try {
        await run(arg);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Canonical JSON: the command failed: ${reason}`);
      }
    };

  context.subscriptions.push(
    diagnostics,
    previews,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, previews),
    // Diagnostics describe the text at the time a command ran; edits invalidate them.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0 && diagnostics.has(event.document.uri)) {
        diagnostics.delete(event.document.uri);
      }
    }),
    // Closing a source document releases its diagnostics and its preview snapshot
    // (an open preview keeps showing its text until it is closed).
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === SCHEME) return;
      diagnostics.delete(doc.uri);
      previews.delete(previewUriFor(doc.uri));
    }),
    vscode.commands.registerCommand('canonicalJson.inspect', guarded(inspect)),
    vscode.commands.registerCommand('canonicalJson.copy', guarded(copyCanonical)),
    vscode.commands.registerCommand('canonicalJson.copySha256', guarded(copySha256)),
  );
}

export function deactivate(): void {
  // Nothing to release beyond context.subscriptions.
}
