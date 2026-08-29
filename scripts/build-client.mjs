/**
 * Build all three artifacts:
 *
 *   dist/engine.js  — IIFE for the standalone /schematic page (self-booting)
 *   dist/client.js  — lazy-CJS factory artifact for the dsh client module
 *                     system: window.__ModuleLoader__.load({ id, factory }),
 *                     the format packages/client/tsdown.client.ts produces
 *                     in-repo. React, react/jsx-runtime, and the ui
 *                     primitives stay require() calls answered by the
 *                     shell's module table.
 *   dist/index.js   — ESM bundle of the host-half plugin (the package's "."
 *                     export, so an npm install loads plain JS, not TS
 *                     source). Runtime imports are node builtins only (the
 *                     cordis import is type-only), so nothing is bundled in.
 *
 * dist/web/index.html is copied beside the host bundle because the host
 * resolves ./web/index.html against its own import.meta.url at runtime.
 *
 * Run: node scripts/build-client.mjs   (esbuild must be installed)
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

const pkg = { id: 'dsh-schematic' }

/** Local-time build stamp shown in the viewer footer (read at a glance, so no UTC surprise). */
const now = new Date()
const pad = n => String(n).padStart(2, '0')
const buildStamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

const results = await Promise.all([
  build({
    entryPoints: ['src/web/boot.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/engine.js',
    define: { __SCH_BUILD__: JSON.stringify(buildStamp) },
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
  build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    packages: 'external',
    outfile: 'dist/index.js',
    sourcemap: true,
    logLevel: 'info',
  }),
])

mkdirSync('dist/web', { recursive: true })
copyFileSync('src/web/index.html', 'dist/web/index.html')

const failures = results.filter((r) => r.errors > 0)
if (failures.length > 0) process.exit(1)
console.log('built dist/engine.js (page), dist/client.js (SPA bundle), dist/index.js (host plugin)')
