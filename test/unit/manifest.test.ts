// The extension's public surface: exactly three commands, no settings, no
// runtime dependencies, and a bundle that imports only `vscode` and `node:crypto`.
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import { build } from 'esbuild';
import { readText, ROOT } from './helpers.ts';

interface Manifest {
  name: string;
  publisher: string;
  displayName: string;
  version: string;
  license: string;
  main: string;
  icon: string;
  repository: { url: string };
  engines: { vscode: string };
  activationEvents?: string[];
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
  capabilities: { untrustedWorkspaces: { supported: boolean }; virtualWorkspaces: boolean };
  contributes: {
    commands: { command: string; title: string; category: string }[];
    menus: Record<string, { command: string; when: string }[]>;
    configuration?: unknown;
  };
}

const manifest = JSON.parse(readText('package.json')) as Manifest;
const COMMANDS = {
  'canonicalJson.inspect': 'Inspect Canonical JSON',
  'canonicalJson.copy': 'Copy Canonical JSON',
  'canonicalJson.copySha256': 'Copy SHA-256 of Canonical JSON',
};

describe('package.json', () => {
  test('identity', () => {
    assert.equal(`${manifest.publisher}.${manifest.name}`, 'bitspark.canonical-json');
    assert.equal(manifest.displayName, 'Canonical JSON (RFC 8785)');
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.license, 'Apache-2.0');
    assert.equal(manifest.repository.url, 'https://github.com/Bitspark/vscode-canonical-json');
    assert.equal(manifest.icon, 'media/icon.png');
  });

  test('engine and matching @types/vscode', () => {
    assert.equal(manifest.engines.vscode, '^1.90.0');
    assert.match(manifest.devDependencies['@types/vscode'] ?? '', /^~?1\.90\.\d+$/);
  });

  test('no runtime dependencies', () => {
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
  });

  test('untrusted and virtual workspaces are supported', () => {
    assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
    assert.equal(manifest.capabilities.virtualWorkspaces, true);
  });

  test('exactly three commands, titled with the "Canonical JSON:" prefix', () => {
    const commands = manifest.contributes.commands;
    assert.deepEqual(Object.fromEntries(commands.map((c) => [c.command, c.title])), COMMANDS);
    for (const c of commands) assert.equal(c.category, 'Canonical JSON');
  });

  test('palette entries need an active editor; context menu entries need a json document', () => {
    const palette = manifest.contributes.menus['commandPalette'] ?? [];
    const context = manifest.contributes.menus['editor/context'] ?? [];
    assert.deepEqual(palette.map((m) => [m.command, m.when]), Object.keys(COMMANDS).map((c) => [c, 'activeEditor']));
    assert.deepEqual(context.map((m) => [m.command, m.when]), Object.keys(COMMANDS).map((c) => [c, 'editorLangId == json']));
    assert.deepEqual(Object.keys(manifest.contributes.menus).sort(), ['commandPalette', 'editor/context']);
  });

  test('no settings and no other contributions', () => {
    assert.equal(manifest.contributes.configuration, undefined);
    assert.deepEqual(Object.keys(manifest.contributes).sort(), ['commands', 'menus']);
    assert.deepEqual(manifest.activationEvents ?? [], []);
  });
});

describe('.vscodeignore', () => {
  test('ships only the bundle, icon, documents and manifest', () => {
    const lines = readText('.vscodeignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    assert.deepEqual(lines, [
      '**',
      '!dist/extension.js',
      '!media/icon.png',
      '!README.md',
      '!CHANGELOG.md',
      '!LICENSE',
      '!NOTICE',
      '!package.json',
    ]);
  });
});

describe('bundle', () => {
  test('is CommonJS and imports only vscode and node:crypto', async () => {
    const result = await build({
      absWorkingDir: ROOT,
      entryPoints: [path.join('src', 'extension.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['vscode'],
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const output = Object.values(result.metafile.outputs)[0]!;
    const external = output.imports.filter((i) => i.external).map((i) => i.path).sort();
    assert.deepEqual([...new Set(external)], ['node:crypto', 'vscode']);
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(inputs.every((file) => file.startsWith('src/')), `only our sources are bundled: ${inputs.join(', ')}`);
  });
});
