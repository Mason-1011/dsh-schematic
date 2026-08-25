/**
 * Standalone-page boot: mounts the topology engine into #app. Built to
 * dist/engine.js (IIFE) by scripts/build-client.mjs and served at
 * /schematic/engine.js by the host half.
 */

import { mountSchematic } from './engine.ts'

const app = document.getElementById('app')
if (app !== null) mountSchematic(app)
