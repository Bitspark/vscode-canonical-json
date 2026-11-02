// Bundles the extension into dist/extension.js (CommonJS, `vscode` external).
// The bundle is not minified so that a reviewer can read what ships.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
