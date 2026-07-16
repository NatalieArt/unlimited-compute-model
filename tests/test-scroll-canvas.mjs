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

for (const name of ['frame-000.webp', 'frame-180.webp', 'frame-360.webp']) {
  const dimensions = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
    path.join(framesDir, name),
  ], { encoding: 'utf8' }).trim();
  assert.equal(dimensions, '1600,900', `${name} must be 1600x900`);
}

console.log('PASS: 361 WebP frames are present at 1600x900');
