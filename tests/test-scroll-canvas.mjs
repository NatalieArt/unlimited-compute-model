import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const framesDir = path.join(root, 'assets', 'gpu-scroll-frames');
const frames = fs.existsSync(framesDir)
  ? fs.readdirSync(framesDir).filter((name) => /^frame-\d{3}\.webp$/.test(name)).sort()
  : [];

assert.equal(frames.length, 361, `expected 361 WebP frames, found ${frames.length}`);
assert.equal(frames[0], 'frame-000.webp');
assert.equal(frames.at(-1), 'frame-360.webp');

for (const name of frames) {
  const size = fs.statSync(path.join(framesDir, name)).size;
  assert.ok(size > 1024, `${name} must not be empty or truncated (found ${size} bytes)`);
}

for (const name of ['frame-000.webp', 'frame-180.webp', 'frame-360.webp']) {
  const dimensions = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
    path.join(framesDir, name),
  ], { encoding: 'utf8' }).trim();
  assert.equal(dimensions, '1600,900', `${name} must be 1600x900`);
}

console.log('PASS: 361 WebP frames are present at 1600x900');

const previewDir = path.join(root, 'assets', 'gpu-scroll-preview');
const previewSheets = fs.existsSync(previewDir)
  ? fs.readdirSync(previewDir).filter((name) => /^sheet-[0-3]\.webp$/.test(name)).sort()
  : [];

assert.deepEqual(
  previewSheets,
  ['sheet-0.webp', 'sheet-1.webp', 'sheet-2.webp', 'sheet-3.webp'],
  `expected four preview sprite sheets, found ${previewSheets.join(', ') || 'none'}`,
);

let previewBytes = 0;
for (const name of previewSheets) {
  const filePath = path.join(previewDir, name);
  const size = fs.statSync(filePath).size;
  previewBytes += size;
  assert.ok(size > 1024, `${name} must not be empty or truncated (found ${size} bytes)`);

  const dimensions = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf8' }).trim();
  assert.equal(dimensions, '1920,1080', `${name} must be 1920x1080`);
}

assert.ok(
  previewBytes <= 4 * 1024 * 1024,
  `preview sprites must total no more than 4 MiB (found ${previewBytes} bytes)`,
);

console.log(`PASS: four preview sprite sheets total ${previewBytes} bytes`);

const runtimePath = path.join(root, 'assets', 'gpu-scroll-canvas.js');
assert.ok(fs.existsSync(runtimePath), 'canvas runtime must exist');
const runtime = fs.readFileSync(runtimePath, 'utf8');

for (const contract of [
  'MAX_CONCURRENT = 6',
  'DESKTOP_CACHE_LIMIT = 72',
  'MOBILE_CACHE_LIMIT = 36',
  'NEIGHBOR_RADIUS = 3',
  'DESKTOP_NAVIGATION_STEP = 18',
  'MOBILE_NAVIGATION_STEP = 24',
  'var loading = new Set()',
  'loading.has(index)',
  'urgentQueued',
  'fetchPriority',
  'pruneQueue',
  'data-target-frame',
  'requestAnimationFrame',
  'drawImage',
  'requestIdleCallback',
  'SogniScrollCanvas',
  '__sogniScrollCanvas',
]) {
  assert.ok(runtime.includes(contract), `runtime must include ${contract}`);
}
assert.ok(!runtime.includes('currentTime'), 'canvas runtime must not seek video');
assert.ok(!runtime.includes('idleCursor'), 'runtime must not background-load the entire sequence');
assert.ok(!runtime.includes('SPARSE_BATCH_SIZE'), 'sparse keyframes must not be artificially delayed in batches');
assert.ok(
  runtime.indexOf('enqueue(index - distance * direction, true)') < runtime.indexOf('enqueue(index + distance * direction, true)'),
  'reverse neighbor must be queued before forward neighbor so unshift prioritizes the scroll direction',
);

new Function(runtime);
console.log('PASS: canvas runtime contract and syntax are valid');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(html.includes('<canvas class="scrolly-canvas"'), 'banner must use canvas');
assert.ok(html.includes('data-frame-count="361"'), 'canvas must declare 361 frames');
assert.ok(html.includes('data-frame-version="canvas6"'), 'canvas frames must use the current cache version');
assert.ok(html.includes('assets/gpu-scroll-canvas.js?v=canvas6'), 'HTML must load the current canvas runtime');
assert.ok(!html.includes('<video class="scrolly-video"'), 'banner video must be removed');
assert.ok(!html.includes('currentTime'), 'HTML must not seek video');

for (const range of [
  'data-from="0" data-to="0.20"',
  'data-from="0.24" data-to="0.46"',
  'data-from="0.50" data-to="0.72"',
  'data-from="0.76" data-to="0.94"',
]) {
  assert.ok(html.includes(range), `caption range ${range} must remain`);
}

for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const [, attributes, code] = match;
  if (/\bsrc\s*=/.test(attributes) || /application\/ld\+json/.test(attributes) || !code.trim()) continue;
  new Function(code);
}

console.log('PASS: HTML uses canvas and preserves caption timing');
