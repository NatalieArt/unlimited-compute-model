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

for (const track of [
  {
    name: 'desktop',
    directory: 'gpu-scroll-preview-desktop',
    dimensions: '3840,540',
    budget: 8 * 1024 * 1024,
    expectedCount: 31,
  },
  {
    name: 'mobile',
    directory: 'gpu-scroll-preview-mobile',
    dimensions: '1800,800',
    budget: 5.5 * 1024 * 1024,
    expectedCount: 31,
  },
  {
    name: 'desktop-hd',
    directory: 'gpu-scroll-preview-desktop-hd',
    dimensions: '4320,810',
    budget: 32 * 1024 * 1024,
    expectedCount: 61,
  },
]) {
  const previewDir = path.join(root, 'assets', track.directory);
  const previewSheets = fs.existsSync(previewDir)
    ? fs.readdirSync(previewDir)
      .filter((name) => /^sheet-\d+\.webp$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    : [];

  assert.deepEqual(
    previewSheets,
    Array.from({ length: track.expectedCount }, (_, index) => `sheet-${index}.webp`),
    `expected ${track.expectedCount} ${track.name} preview sheets, found ${previewSheets.join(', ') || 'none'}`,
  );

  let previewBytes = 0;
  for (const name of previewSheets) {
    const filePath = path.join(previewDir, name);
    const size = fs.statSync(filePath).size;
    previewBytes += size;
    assert.ok(size > 1024, `${track.name}/${name} must not be truncated (found ${size} bytes)`);

    const dimensions = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
      filePath,
    ], { encoding: 'utf8' }).trim();
    assert.equal(dimensions, track.dimensions, `${track.name}/${name} must be ${track.dimensions}`);
  }

  assert.ok(
    previewBytes <= track.budget,
    `${track.name} previews exceed ${track.budget} bytes (found ${previewBytes})`,
  );
  console.log(`PASS: ${track.name} preview sheets total ${previewBytes} bytes`);
}

const builder = fs.readFileSync(path.join(root, 'scripts', 'build-scroll-preview.py'), 'utf8');
assert.ok(builder.includes('"desktop-hd"'), 'builder must define desktop-hd track');
assert.ok(builder.includes('"step": 2'), 'desktop-hd track must sample every 2 frames');
assert.ok(builder.includes('"grid": (3, 1)'), 'desktop-hd track must use a 3 x 1 grid');
assert.ok(builder.includes('"quality": 76'), 'desktop-hd track must use WebP quality 76');

const runtimePath = path.join(root, 'assets', 'gpu-scroll-canvas.js');
assert.ok(fs.existsSync(runtimePath), 'canvas runtime must exist');
const runtime = fs.readFileSync(runtimePath, 'utf8');

for (const contract of [
  'DESKTOP_CACHE_LIMIT = 16',
  'MOBILE_CACHE_LIMIT = 10',
  'PREVIEW_SHEET_CACHE_LIMIT = 5',
  'PREVIEW_LOOKAHEAD = 4',
  'SETTLE_DELAY = 120',
  'fetchPriority',
  'image.decode',
  'loadPreviewSheets',
  'ensurePreviewSheets',
  'function loadPreviewAhead()',
  'if (index === previewCenterSheet) loadPreviewAhead();',
  'if (previewSheets.has(previewCenterSheet)) loadPreviewAhead();',
  'ensurePreviewSheets(targetFrame, direction)',
  'previewLoading',
  'previewLoadingCount: previewLoading.size',
  'previewDirection',
  'previewCenterSheet + distance * previewDirection',
  'distance <= PREVIEW_LOOKAHEAD',
  'drawSharpPreview',
  'ensureExactTarget',
  'ensureExactTarget(targetFrame);',
  'exactLoadingImage',
  'if (exactLoadingIndex >= 0 && exactLoadingIndex !== targetFrame) abortExactLoad();',
  'data-preview-root-mobile',
  'data-preview-root-desktop',
  'previewVariant',
  'previewVariant: previewVariant',
  'preview-sharp',
  'Math.round(frame / previewStep)',
  'full-fallback',
  'data-target-frame',
  'requestAnimationFrame',
  'drawImage',
  'SogniScrollCanvas',
  '__sogniScrollCanvas',
]) {
  assert.ok(runtime.includes(contract), `runtime must include ${contract}`);
}
for (const contract of [
  'HD_PREVIEW_SHEET_CACHE_LIMIT = 4',
  'HD_PREVIEW_LOOKAHEAD = 2',
  'function allowsHdPreview(navigatorObject)',
  'connection.saveData',
  "connection.effectiveType === 'slow-2g'",
  "connection.effectiveType === '2g'",
  'var hdEnabled = !isMobile && allowsHdPreview(global.navigator);',
  'function drawHdPreview(frame)',
  'function ensureHdPreview(frame, direction)',
  "setRenderedState(hdPreviewFrame, 'preview-hd');",
  "canvas.setAttribute('data-hd-enabled', hdEnabled ? 'true' : 'false');",
  "canvas.setAttribute('data-hd-errors', String(hdFailed.size));",
]) {
  assert.ok(runtime.includes(contract), `runtime must include HD contract: ${contract}`);
}
const exactDrawIndex = runtime.indexOf("drawFullFrame(targetFrame, 'full')");
const hdDrawIndex = runtime.indexOf('drawHdPreview(targetFrame)');
const standardDrawIndex = runtime.indexOf('drawSharpPreview(targetFrame)', hdDrawIndex);
assert.ok(exactDrawIndex >= 0 && hdDrawIndex > exactDrawIndex && standardDrawIndex > hdDrawIndex,
  'render order must be exact frame, HD preview, then standard preview');
assert.ok(!runtime.includes('currentTime'), 'canvas runtime must not seek video');
assert.ok(!runtime.includes('idleCursor'), 'runtime must not background-load the entire sequence');
assert.ok(!runtime.includes('SPARSE_BATCH_SIZE'), 'sparse keyframes must not be artificially delayed in batches');
assert.ok(!runtime.includes('warmNavigationFrames'), 'runtime must not warm sparse full-resolution navigation frames');
assert.ok(!runtime.includes('navigationFrames'), 'runtime must not keep a sparse full-resolution navigation set');
assert.ok(!runtime.includes('MAX_CONCURRENT'), 'runtime must not run background full-resolution downloads during motion');
assert.ok(!runtime.includes('NEIGHBOR_RADIUS'), 'runtime must not prefetch full-resolution neighbors during motion');
assert.ok(!runtime.includes('enqueueNeighborhood'), 'runtime must not enqueue exact-frame neighborhoods during motion');
assert.ok(!runtime.includes('pumpQueue'), 'runtime must not maintain a background exact-frame queue');
assert.ok(!runtime.includes('var mix ='), 'runtime must not crossfade moving object positions');
assert.ok(
  !runtime.includes('loadPreviewSheet(previewCenterSheet - direction'),
  'runtime must reserve the five-sheet preview cache for the current scroll direction',
);

new Function(runtime);
console.log('PASS: canvas runtime contract and syntax are valid');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(html.includes('<canvas class="scrolly-canvas"'), 'banner must use canvas');
assert.ok(html.includes('data-frame-count="361"'), 'canvas must declare 361 frames');
for (const contract of [
  'data-preview-root-desktop="assets/gpu-scroll-preview-desktop/sheet-"',
  'data-preview-width-desktop="960"',
  'data-preview-height-desktop="540"',
  'data-preview-root-mobile="assets/gpu-scroll-preview-mobile/sheet-"',
  'data-preview-width-mobile="450"',
  'data-preview-height-mobile="800"',
  'data-preview-count="121"',
  'data-preview-step="3"',
  'data-preview-columns="4"',
  'data-preview-rows="1"',
  'data-preview-root-desktop-hd="assets/gpu-scroll-preview-desktop-hd/sheet-"',
  'data-preview-width-desktop-hd="1440"',
  'data-preview-height-desktop-hd="810"',
  'data-preview-count-desktop-hd="181"',
  'data-preview-step-desktop-hd="2"',
  'data-preview-columns-desktop-hd="3"',
  'data-preview-rows-desktop-hd="1"',
  'data-frame-version="canvas19"',
]) {
  assert.ok(html.includes(contract), `canvas must include ${contract}`);
}
assert.ok(html.includes('assets/gpu-scroll-canvas.js?v=canvas19'), 'HTML must load the current canvas runtime');
assert.ok(
  !html.includes('rel="preload" href="assets/gpu-scroll-preview-desktop-hd'),
  'HTML must not statically preload HD sheets',
);
assert.ok(
  !html.includes('<link rel="preload" href="assets/gpu-scroll-preview-'),
  'HTML must not statically preload both device tracks',
);
for (const contract of [
  "var previewVariant = window.matchMedia('(max-width: 720px)').matches ? 'mobile' : 'desktop';",
  'function preloadPreviewSheet(index, priority)',
  'for (var index = 0; index < 10; index += 1)',
  "preloadPreviewSheet(index, 'high');",
  "window.setTimeout(function () {",
  'for (var index = 10; index < 31; index += 1)',
  "preloadPreviewSheet(index, 'low');",
  '}, 750);',
  "link.rel = 'preload';",
  "link.as = 'image';",
  "link.type = 'image/webp';",
  'link.fetchPriority = priority;',
  "link.href = 'assets/gpu-scroll-preview-' + previewVariant + '/sheet-' + index + '.webp?v=canvas19';",
  'document.head.appendChild(link);',
]) {
  assert.ok(html.includes(contract), `HTML must include selected-track preload contract: ${contract}`);
}
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
