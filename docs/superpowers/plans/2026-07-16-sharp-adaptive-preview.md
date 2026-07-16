# Sharp Adaptive Scroll Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first cold-cache scroll pass both sharp and continuous on desktop and mobile without a visible delayed-sharpening transition.

**Architecture:** Generate separate 121-frame WebP sprite tracks for landscape desktop and portrait mobile display. The HTML preloads only the matching track, the runtime selects its metadata at the existing 720 px breakpoint, and the exact 1600×900 loader remains the final settled layer. The renderer draws the nearest preview frame at full opacity so moving objects never acquire crossfade ghosting.

**Tech Stack:** Static HTML, Canvas 2D, browser `Image`/`image.decode()`, Python Pillow, Node.js contract tests, GitHub Pages.

## Global Constraints

- Desktop preview tiles are 960×540 in eight 3840×2160 WebP sheets.
- Mobile preview tiles are center-cropped 450×800 in eight 1800×3200 WebP sheets.
- Both tracks contain source frames 0 through 360 in steps of 3 and use WebP quality 70.
- Desktop preview transfer is at most 8 MiB; mobile preview transfer is at most 5.5 MiB.
- Only the media-matched preview track is preloaded and selected.
- Exact-frame caches are 16 on desktop and 10 on mobile.
- Captions, timing, vignette, dim, stars, reduced motion, layout, and link-preview metadata remain unchanged.
- Final cache version is canvas9.

---

### Task 1: Adaptive Preview Asset Generator

**Files:**
- Modify: `scripts/build-scroll-preview.py`
- Create: `assets/gpu-scroll-preview-desktop/sheet-0.webp` through `sheet-7.webp`
- Create: `assets/gpu-scroll-preview-mobile/sheet-0.webp` through `sheet-7.webp`
- Test: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes: `assets/gpu-scroll-frames/frame-NNN.webp` for indices `range(0, 361, 3)`.
- Produces: two eight-sheet tracks with row-major 4×4 tile placement.

- [ ] **Step 1: Write the failing adaptive asset test**

Replace the single preview-directory assertion with a table-driven test:

```js
for (const track of [
  { directory: 'gpu-scroll-preview-desktop', dimensions: '3840,2160', budget: 8 * 1024 * 1024 },
  { directory: 'gpu-scroll-preview-mobile', dimensions: '1800,3200', budget: 5.5 * 1024 * 1024 },
]) {
  const directory = path.join(root, 'assets', track.directory);
  const sheets = fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => /^sheet-[0-7]\.webp$/.test(name)).sort()
    : [];
  assert.deepEqual(sheets, Array.from({ length: 8 }, (_, index) => `sheet-${index}.webp`));
  let bytes = 0;
  for (const name of sheets) {
    const filePath = path.join(directory, name);
    bytes += fs.statSync(filePath).size;
    assert.ok(fs.statSync(filePath).size > 1024);
    const dimensions = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath,
    ], { encoding: 'utf8' }).trim();
    assert.equal(dimensions, track.dimensions);
  }
  assert.ok(bytes <= track.budget);
}
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because each adaptive preview directory contains only four of the required eight sheets.

- [ ] **Step 3: Implement the two-track generator**

Define:

```python
TRACKS = {
    "desktop": {"tile": (960, 540), "sheet": (3840, 2160), "crop": False},
    "mobile": {"tile": (450, 800), "sheet": (1800, 3200), "crop": True},
}
FRAME_STEP = 3
QUALITY = 70
```

For the mobile track, center-crop each 1600×900 source to the 450:800 aspect ratio before LANCZOS resizing. Save eight sheets per track with `quality=70`, `method=6`, and `exact=True`.

- [ ] **Step 4: Generate assets and verify GREEN**

Run:

```bash
/Users/Natalie/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-scroll-preview.py
node tests/test-scroll-canvas.mjs
```

Expected: both eight-sheet tracks pass count, dimensions, truncation, and byte-budget checks.

- [ ] **Step 5: Commit the adaptive assets**

```bash
git add scripts/build-scroll-preview.py assets/gpu-scroll-preview-desktop assets/gpu-scroll-preview-mobile tests/test-scroll-canvas.mjs
git commit -m "Add sharp adaptive scroll previews"
```

### Task 2: Device-Specific Runtime Selection

**Files:**
- Modify: `assets/gpu-scroll-canvas.js`
- Test: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes canvas attributes: `data-preview-root-desktop`, `data-preview-width-desktop`, `data-preview-height-desktop`, `data-preview-root-mobile`, `data-preview-width-mobile`, and `data-preview-height-mobile`.
- Preserves: `window.SogniScrollCanvas.create(canvas)` and the `setProgress`, `resize`, `destroy`, and `getState` API.

- [ ] **Step 1: Write the failing runtime contract test**

Require the runtime to contain:

```js
'DESKTOP_CACHE_LIMIT = 16'
'MOBILE_CACHE_LIMIT = 10'
'data-preview-root-mobile'
'data-preview-root-desktop'
'previewVariant'
'drawSharpPreview'
'preview-sharp'
'Math.round(frame / previewStep)'
```

Also require `getState()` to expose `previewVariant` and require the old `var mix =` crossfade identifier to be absent.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL on `DESKTOP_CACHE_LIMIT = 16`.

- [ ] **Step 3: Select preview metadata at startup**

Use the existing `isMobile` boolean:

```js
var previewVariant = isMobile ? 'mobile' : 'desktop';
var previewRoot = canvas.getAttribute('data-preview-root-' + previewVariant) || '';
var previewTileWidth = Number(canvas.getAttribute('data-preview-width-' + previewVariant) || 0);
var previewTileHeight = Number(canvas.getAttribute('data-preview-height-' + previewVariant) || 0);
```

Keep `data-preview-count="121"`, `data-preview-step="3"`, `data-preview-columns="4"`, and `data-preview-rows="4"` shared. Set cache limits to 16/10 and return `previewVariant` from `getState()`. Replace `drawPreviewBlend(frame)` with `drawSharpPreview(frame)`, select `Math.round(frame / previewStep)`, draw one tile at alpha 1, and set `data-render-mode="preview-sharp"`.

- [ ] **Step 4: Run tests and commit**

```bash
node tests/test-scroll-canvas.mjs
git add assets/gpu-scroll-canvas.js tests/test-scroll-canvas.mjs
git commit -m "Select sharp previews by viewport"
```

Expected: all runtime syntax and contract tests pass.

### Task 3: Responsive Preloads and Canvas9 Metadata

**Files:**
- Modify: `index.html`
- Test: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Produces matching desktop/mobile preload URLs and canvas metadata for Task 2.
- Loads `assets/gpu-scroll-canvas.js?v=canvas9` and assets with `data-frame-version="canvas9"`.

- [ ] **Step 1: Write the failing HTML contract test**

Require all eight desktop preload links to use `media="(min-width: 721px)"`, all eight mobile links to use `media="(max-width: 720px)"`, and require:

```html
data-preview-root-desktop="assets/gpu-scroll-preview-desktop/sheet-"
data-preview-width-desktop="960"
data-preview-height-desktop="540"
data-preview-root-mobile="assets/gpu-scroll-preview-mobile/sheet-"
data-preview-width-mobile="450"
data-preview-height-mobile="800"
data-frame-version="canvas9"
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because the HTML still declares canvas8 and one generic preview root.

- [ ] **Step 3: Add responsive preload and metadata markup**

Add all eight media-qualified preload links per variant. Set shared metadata to `data-preview-count="121"` and `data-preview-step="3"`, keep the six adaptive attributes, and retain runtime plus frame version canvas9.

- [ ] **Step 4: Run tests and commit**

```bash
node tests/test-scroll-canvas.mjs
git add index.html tests/test-scroll-canvas.mjs
git commit -m "Enable sharp responsive preview tracks"
```

Expected: HTML, inline script syntax, runtime, exact-frame, and both asset-track tests pass.

### Task 4: Cold QA, Blog Sync, and GitHub Pages Deployment

**Files:**
- Copy: `index.html` to `/Users/Natalie/Documents/blog.sogni.ai/blogs/unlimited-compute-model/index.html`
- Copy: `assets/gpu-scroll-canvas.js` to the matching blog assets directory
- Copy: both adaptive preview directories to the matching blog assets directory

**Interfaces:**
- Produces byte-identical repo, blog-folder, and public GitHub Pages canvas9 surfaces.

- [ ] **Step 1: Run local automated verification**

Run `node tests/test-scroll-canvas.mjs`, `git diff --check HEAD`, verify 361 exact frames, and verify sixteen non-truncated adaptive preview sheets.

- [ ] **Step 2: Run cold local rendered QA**

Serve on `127.0.0.1`, test 1440×900 and 390×844 using a fresh canvas9 asset version, and rapidly scroll. Require `preview-sharp` during motion, the drawn preview within two target frames, exact `full` within one second, no load errors, and no horizontal overflow. Compare moving and settled screenshots for ghosting or an obvious sharpness jump.

- [ ] **Step 3: Sync and verify the blog folder**

Copy HTML, runtime, desktop preview sheets, and mobile preview sheets. Verify every file with `cmp -s`, plus 361 exact frames and sixteen adaptive sheets larger than 1024 bytes.

- [ ] **Step 4: Push and wait for ordinary Pages URL**

Push `main`, then poll `https://natalieart.github.io/unlimited-compute-model/` until the ordinary HTML contains canvas9.

- [ ] **Step 5: Run cold public desktop and mobile QA**

Repeat the local motion/settle assertions on the public origin. Confirm the network-selected preview variant matches the viewport, console warnings/errors are empty, and public HTML/runtime/adaptive sheets are byte-identical to the repository.

- [ ] **Step 6: Leave the ordinary link open**

Reset the temporary viewport, navigate to the ordinary public link, verify canvas9 frame 0 in `full` mode without errors, and keep that tab as the deliverable.
