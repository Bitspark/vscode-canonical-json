// Smoke suite, run inside VS Code's extension host against the unpacked
// .vsix. No test framework: each case throws on failure.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

const SENTINEL = 'canonical-json smoke test: clipboard untouched';
const BS = String.fromCharCode(0x5c);
const SOURCE = 'Canonical JSON';

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

async function openUntitled(content: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ language: 'json', content });
  return vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
}

async function waitFor<T>(probe: () => T | undefined, what: string, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function ourDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === SOURCE);
}

function previewOf(source: vscode.Uri): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.scheme === 'canonical-json' && e.document.uri.query === source.toString(),
  );
}

const tests: [string, () => Promise<void>][] = [
  [
    'the packaged extension is installed',
    async () => {
      const extension = vscode.extensions.getExtension('bitspark.canonical-json');
      assert.ok(extension, 'bitspark.canonical-json is present');
      assert.equal(extension.packageJSON.version, '0.1.0');
    },
  ],
  [
    'Copy SHA-256 hashes the unsaved text of an untitled document',
    async () => {
      const editor = await openUntitled('{"b": [1.5, true], "a": "x"}');
      // An unsaved edit the command must see.
      await editor.edit((edit) => edit.insert(editor.document.positionAt(1), '"c": null, '));
      assert.ok(editor.document.isUntitled, 'untitled');
      assert.ok(editor.document.isDirty, 'unsaved');
      await vscode.env.clipboard.writeText(SENTINEL);
      await vscode.commands.executeCommand('canonicalJson.copySha256');
      const expected = sha256('{"a":"x","b":[1.5,true],"c":null}');
      assert.equal(await vscode.env.clipboard.readText(), expected);
    },
  ],
  [
    'Copy Canonical JSON copies the canonical text',
    async () => {
      await openUntitled('{\n  "z": 1,\n  "10": "ten",\n  "2": "two"\n}\n');
      await vscode.env.clipboard.writeText(SENTINEL);
      await vscode.commands.executeCommand('canonicalJson.copy');
      assert.equal(await vscode.env.clipboard.readText(), '{"10":"ten","2":"two","z":1}');
    },
  ],
  [
    'a document passed as argument (editor context menu) is used instead of the active one',
    async () => {
      const target = await openUntitled('[true, {"b": 2, "a": 1}]');
      await openUntitled('{"other": "document"}');
      await vscode.env.clipboard.writeText(SENTINEL);
      await vscode.commands.executeCommand('canonicalJson.copySha256', target.document.uri);
      assert.equal(await vscode.env.clipboard.readText(), sha256('[true,{"a":1,"b":2}]'));
    },
  ],
  [
    'Inspect opens the canonical text beside the editor, read-only, with no diagnostics',
    async () => {
      const editor = await openUntitled('{"z": 1, "a": [{"y": 2, "x": 3}]}');
      await vscode.commands.executeCommand('canonicalJson.inspect');
      const preview = await waitFor(() => previewOf(editor.document.uri), 'the preview editor');
      assert.equal(preview.document.getText(), '{"a":[{"x":3,"y":2}],"z":1}');
      assert.notEqual(preview.viewColumn, editor.viewColumn, 'opened beside');
      assert.equal(vscode.window.activeTextEditor?.document, editor.document, 'focus stays on the source');
      assert.deepEqual(ourDiagnostics(editor.document.uri), []);
      // The virtual document cannot be saved over: it belongs to a content provider.
      assert.equal(preview.document.uri.scheme, 'canonical-json');
    },
  ],
  [
    'a decoded duplicate gets an error diagnostic, no preview and no copy',
    async () => {
      const editor = await openUntitled(`{"a": 1, "${BS}u0061": 2}`);
      const uri = editor.document.uri;
      await vscode.env.clipboard.writeText(SENTINEL);
      await vscode.commands.executeCommand('canonicalJson.inspect');
      const diagnostics = await waitFor(() => {
        const list = ourDiagnostics(uri);
        return list.length > 0 ? list : undefined;
      }, 'diagnostics');
      const duplicate = diagnostics.find((d) => d.code === 'duplicate-name');
      assert.ok(duplicate, 'a duplicate-name diagnostic');
      assert.equal(duplicate.severity, vscode.DiagnosticSeverity.Error);
      assert.equal(editor.document.getText(duplicate.range), `"${BS}u0061"`);
      assert.equal(duplicate.relatedInformation?.length, 1, 'points at the first occurrence');
      assert.equal(previewOf(uri), undefined, 'no preview');
      await vscode.commands.executeCommand('canonicalJson.copy');
      await vscode.commands.executeCommand('canonicalJson.copySha256');
      assert.equal(await vscode.env.clipboard.readText(), SENTINEL, 'nothing was copied');
    },
  ],
  [
    'editing a document clears its diagnostics',
    async () => {
      const editor = await openUntitled('{"a": 1, "a": 2}');
      await vscode.commands.executeCommand('canonicalJson.inspect');
      await waitFor(() => (ourDiagnostics(editor.document.uri).length > 0 ? true : undefined), 'diagnostics');
      await editor.edit((edit) => edit.insert(editor.document.positionAt(1), ' '));
      await waitFor(() => (ourDiagnostics(editor.document.uri).length === 0 ? true : undefined), 'diagnostics to clear');
    },
  ],
];

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`  FAIL ${name}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
  }
  console.log(`Integration: ${tests.length - failures.length} passed, ${failures.length} failed`);
  if (failures.length > 0) throw new Error(`${failures.length} integration test(s) failed`);
}
