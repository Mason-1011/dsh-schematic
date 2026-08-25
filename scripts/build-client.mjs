/**
 * Build both browser artifacts:
 *
 *   dist/engine.js  — IIFE for the standalone /schematic page (self-booting)
 *   dist/client.js  — lazy-CJS factory artifact for the dsh client module
 *                     system: window.__ModuleLoader__.load({ id, factory }),
 *                     the format packages/client/tsdown.client.ts produces
 *                     in-repo. React, react/jsx-runtime, and the ui
 *                     primitives stay require() calls answered by the
 *                     shell's module table.
 *
 * Run: node scripts/build-client.mjs   (esbuild must be installed)
 */
import { build } from 'esbuild'

const pkg = { id: 'dsh-schematic' }

const results = await Promise.all([
  build({
    entryPoints: ['src/web/boot.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/engine.js',
    sourcemap: true,
    logLevel: 'info',
  }),
  build({
    entryPoints: ['src/client/index.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/client.js',
    sourcemap: true,
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
    jsx: 'automatic',
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'info',
  }),
])

const failures = results.filter((r) => r.errors > 0)
if (failures.length > 0) process.exit(1)
console.log('built dist/engine.js (standalone page) and dist/client.js (dsh client bundle)')
