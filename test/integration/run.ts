// Packaged smoke test: build the .vsix exactly as it would be published,
// unpack it, check what it contains, and run the smoke suite in VS Code
// Insiders with the unpacked package as the extension under test.
//
//   npm run test:integration
//
// Set VSCODE_EXECUTABLE_PATH to use an already installed VS Code Insiders;
// otherwise the latest Insiders build is downloaded into .vscode-test/.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { runTests } from '@vscode/test-electron';
import vsce from '@vscode/vsce';
import { build } from 'esbuild';

// Set in some environments (including terminals spawned by VS Code); it would
// make the VS Code executable run as plain Node.js instead of the editor.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORK = path.join(ROOT, 'out', 'integration');

// vsce stores README and CHANGELOG lowercased and LICENSE as LICENSE.txt.
const EXPECTED_PACKAGE_FILES = [
  'extension/LICENSE.txt',
  'extension/NOTICE',
  'extension/changelog.md',
  'extension/dist/extension.js',
  'extension/media/icon.png',
  'extension/package.json',
  'extension/readme.md',
];

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

/** Minimal reader for the stored/deflated entries vsce writes. */
function readZip(zip: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`unsupported compression method ${method} for ${name}`);
    if (data.length !== size) throw new Error(`size mismatch for ${name}`);
    if (!name.endsWith('/')) entries.push({ name, data });
  }
  return entries;
}

function safeJoin(base: string, name: string): string {
  if (name.includes('\\') || name.startsWith('/') || name.split('/').some((s) => s === '..' || s === '')) {
    throw new Error(`refusing to extract unsafe path ${JSON.stringify(name)}`);
  }
  return path.join(base, ...name.split('/'));
}

async function main(): Promise<void> {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  // 1. Package (vsce runs the vscode:prepublish build).
  const vsixPath = path.join(WORK, 'canonical-json.vsix');
  await vsce.createVSIX({ cwd: ROOT, packagePath: vsixPath });

  // 2. Unpack and check the contents.
  const entries = readZip(readFileSync(vsixPath));
  const packaged = entries.map((e) => e.name).filter((n) => n.startsWith('extension/')).sort();
  assert.deepEqual(packaged, EXPECTED_PACKAGE_FILES, 'unexpected .vsix contents');
  const unpacked = path.join(WORK, 'vsix');
  for (const entry of entries) {
    const target = safeJoin(unpacked, entry.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
  }
  const extensionPath = path.join(unpacked, 'extension');
  const bundle = readFileSync(path.join(extensionPath, 'dist', 'extension.js'), 'utf8');
  const required = [...new Set([...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(required, ['node:crypto', 'vscode'], 'the bundle may load only vscode and node:crypto');
  console.log(`Packaged ${path.relative(ROOT, vsixPath)}: ${packaged.join(', ')}`);

  // 3. Bundle the smoke suite for the extension host.
  const suitePath = path.join(WORK, 'suite', 'index.js');
  await build({
    entryPoints: [path.join(ROOT, 'test', 'integration', 'suite', 'index.ts')],
    outfile: suitePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    logLevel: 'warning',
  });

  // 4. Run it in VS Code Insiders against the unpacked package.
  const executable = process.env.VSCODE_EXECUTABLE_PATH;
  const exitCode = await runTests({
    version: 'insiders',
    ...(executable ? { vscodeExecutablePath: executable } : {}),
    extensionDevelopmentPath: extensionPath,
    extensionTestsPath: suitePath,
    launchArgs: [
      '--disable-extensions',
      `--user-data-dir=${path.join(WORK, 'user-data')}`,
      `--extensions-dir=${path.join(WORK, 'extensions')}`,
    ],
  });
  if (exitCode !== 0) throw new Error(`VS Code exited with code ${exitCode}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
