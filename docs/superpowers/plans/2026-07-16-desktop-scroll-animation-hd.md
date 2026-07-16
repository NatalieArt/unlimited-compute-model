# Desktop Scroll Animation HD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a progressively loaded 1440 x 810 desktop HD preview tier that improves scroll sharpness and cadence without delaying the existing first visible animation asset.

**Architecture:** Preserve the current standard desktop and mobile sprite tracks as the critical startup path. Add a desktop-only HD sprite cache and loader to the existing canvas runtime; the renderer selects an exact frame, then HD preview, then standard preview, while network capability and bounded directional prefetch control HD requests.

**Tech Stack:** Browser JavaScript (ES5-compatible runtime style), HTML canvas, Python 3 and Pillow asset builder, Node.js contract tests, WebP sprite sheets.

## Global Constraints

- Mobile assets, selection, preload behavior, cache limits, and rendering behavior remain unchanged.
- Desktop HD tiles are exactly 1440 x 810, sampled every 2 source frames, arranged 3 columns by 1 row, and encoded at WebP quality 76.
- The existing standard desktop sheet remains the high-priority first animation asset.
- Desktop HD loading starts only after the first canvas render and never eagerly loads the full animation.
- `saveData`, `slow-2g`, and `2g` connections disable desktop HD requests.
- Exact full frames remain the resting-quality source after the settle delay.
- No video seeking or `currentTime` behavior may be introduced.
- Implementation work happens in a Desktop copy; the source local project is not replaced.

---

### Task 1: Generate the desktop HD preview track

**Files:**
- Modify: `scripts/build-scroll-preview.py`
- Modify: `tests/test-scroll-canvas.mjs`
- Create: `assets/gpu-scroll-preview-desktop-hd/sheet-0.webp` through `sheet-60.webp`

**Interfaces:**
- Consumes: source frames `assets/gpu-scroll-frames/frame-000.webp` through `frame-360.webp`.
- Produces: 181 HD preview tiles across at most 61 sheets, named `assets/gpu-scroll-preview-desktop-hd/sheet-{index}.webp`.

- [ ] **Step 1: Write the failing asset-contract test**

Add this configuration near the existing `previewTracks` data in `tests/test-scroll-canvas.mjs` and reuse the existing per-track image validation loop:

```js
{
  directory: 'gpu-scroll-preview-desktop-hd',
  expectedCount: 61,
  tileWidth: 1440,
  tileHeight: 810,
  columns: 3,
  rows: 1,
  frameStep: 2,
  previewCount: 181,
}
```

Add assertions for the builder contract:

```js
const builder = fs.readFileSync(path.join(root, 'scripts', 'build-scroll-preview.py'), 'utf8');
assert.ok(builder.includes('"desktop-hd"'), 'builder must define desktop-hd track');
assert.ok(builder.includes('"step": 2'), 'desktop-hd track must sample every 2 frames');
assert.ok(builder.includes('"grid": (3, 1)'), 'desktop-hd track must use a 3 x 1 grid');
assert.ok(builder.includes('"quality": 76'), 'desktop-hd track must use WebP quality 76');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because `assets/gpu-scroll-preview-desktop-hd` and the `desktop-hd` builder configuration do not exist.

- [ ] **Step 3: Make track settings per-configuration**

Replace global cadence/grid/quality use in `scripts/build-scroll-preview.py` with per-track values. Add:

```python
TRACKS = {
    "desktop": {
        "tile": (960, 540), "grid": (4, 1), "step": 3,
        "quality": 70, "crop": False,
    },
    "mobile": {
        "tile": (450, 800), "grid": (4, 1), "step": 3,
        "quality": 70, "crop": True,
    },
    "desktop-hd": {
        "tile": (1440, 810), "grid": (3, 1), "step": 2,
        "quality": 76, "crop": False,
    },
}
```

Inside `build_track`, derive `grid`, `step`, `quality`, and `sheet_size`:

```python
grid = configuration["grid"]
step = configuration["step"]
quality = configuration["quality"]
sheet_size = (tile_size[0] * grid[0], tile_size[1] * grid[1])
indices = list(range(0, 361, step))
tiles_per_sheet = grid[0] * grid[1]
```

Use `grid[0]` for column/row placement and save with `quality=quality`.

- [ ] **Step 4: Build the sprites and verify GREEN**

Run: `python3 scripts/build-scroll-preview.py`

Expected: existing standard tracks are regenerated and 61 desktop HD sheets are written.

Run: `node tests/test-scroll-canvas.mjs`

Expected: PASS for asset count, dimensions, cadence, and builder configuration.

- [ ] **Step 5: Commit the asset tier**

```bash
git add scripts/build-scroll-preview.py tests/test-scroll-canvas.mjs assets/gpu-scroll-preview-desktop-hd
git commit -m "Add desktop HD scroll preview assets"
```

### Task 2: Add progressive desktop HD loading and fallback

**Files:**
- Modify: `assets/gpu-scroll-canvas.js`
- Modify: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes: canvas attributes `data-preview-root-desktop-hd`, `data-preview-width-desktop-hd`, `data-preview-height-desktop-hd`, `data-preview-count-desktop-hd`, `data-preview-step-desktop-hd`, and `data-preview-columns-desktop-hd`.
- Produces: desktop-only HD requests, rendering mode `preview-hd`, and attributes `data-hd-enabled`, `data-hd-errors` for diagnostics.

- [ ] **Step 1: Write failing runtime contract tests**

Add exact assertions:

```js
for (const contract of [
  "var HD_PREVIEW_SHEET_CACHE_LIMIT = 4;",
  "var hdEnabled = !isMobile && allowsHdPreview(global.navigator);",
  "connection.saveData",
  "connection.effectiveType === 'slow-2g'",
  "connection.effectiveType === '2g'",
  "function drawHdPreview(frame)",
  "function ensureHdPreview(frame)",
  "setRenderedState(hdPreviewFrame, 'preview-hd');",
  "canvas.setAttribute('data-hd-enabled', hdEnabled ? 'true' : 'false');",
]) {
  assert.ok(runtime.includes(contract), `runtime must include HD contract: ${contract}`);
}
```

Also assert source order by comparing string indices: `drawFullFrame(targetFrame, 'full')` precedes `drawHdPreview(targetFrame)`, which precedes `drawSharpPreview(targetFrame)`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL at the first missing HD runtime contract.

- [ ] **Step 3: Implement connection gating and HD state**

Add:

```js
var HD_PREVIEW_SHEET_CACHE_LIMIT = 4;

function allowsHdPreview(navigatorObject) {
  var connection = navigatorObject && (
    navigatorObject.connection || navigatorObject.mozConnection || navigatorObject.webkitConnection
  );
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}
```

Within `create`, read the six HD canvas attributes, define `hdEnabled = !isMobile && allowsHdPreview(global.navigator)`, and maintain `hdSheets`, `hdLoading`, and `hdFailed` sets/maps separately from standard preview state.

- [ ] **Step 4: Implement bounded HD loading**

Implement `ensureHdPreview(frame)` so it converts the target frame to an HD preview and sheet index, loads only that sheet plus a directional lookahead, decodes before caching, calls `scheduleDraw()`, records failures, and trims the decoded cache to `HD_PREVIEW_SHEET_CACHE_LIMIT`. Do not call it during `create`; call it after the first successful standard/full canvas draw and from target updates thereafter.

- [ ] **Step 5: Implement HD rendering and source order**

Implement `drawHdPreview(frame)` using the same crop-safe `drawRegion` path as standard sprites. Change `drawBestFrame()` to:

```js
if (loaded.has(targetFrame) && drawFullFrame(targetFrame, 'full')) return;
if (drawHdPreview(targetFrame)) return;
if (drawSharpPreview(targetFrame)) return;
var fallback = nearestLoaded(targetFrame);
if (fallback >= 0) drawFullFrame(fallback, 'full-fallback');
```

Preserve the active-scroll behavior by requesting exact frames only from the existing settle path.

- [ ] **Step 6: Run the test and verify GREEN**

Run: `node tests/test-scroll-canvas.mjs`

Expected: PASS with all existing and new runtime contracts intact.

- [ ] **Step 7: Commit the runtime tier**

```bash
git add assets/gpu-scroll-canvas.js tests/test-scroll-canvas.mjs
git commit -m "Load desktop HD scroll previews progressively"
```

### Task 3: Wire HTML metadata without delaying startup

**Files:**
- Modify: `index.html`
- Modify: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes: the HD runtime attributes from Task 2 and assets from Task 1.
- Produces: canvas HD metadata, cache version `canvas19`, while preserving the standard selected-track preload.

- [ ] **Step 1: Write failing HTML contract tests**

Add:

```js
for (const contract of [
  'data-preview-root-desktop-hd="assets/gpu-scroll-preview-desktop-hd/sheet-"',
  'data-preview-width-desktop-hd="1440"',
  'data-preview-height-desktop-hd="810"',
  'data-preview-count-desktop-hd="181"',
  'data-preview-step-desktop-hd="2"',
  'data-preview-columns-desktop-hd="3"',
  'data-frame-version="canvas19"',
  'assets/gpu-scroll-canvas.js?v=canvas19',
]) {
  assert.ok(html.includes(contract), `HTML must include HD contract: ${contract}`);
}
assert.ok(!html.includes('rel="preload" href="assets/gpu-scroll-preview-desktop-hd'),
  'HTML must not statically preload HD sheets');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because the canvas lacks HD metadata and still uses `canvas18`.

- [ ] **Step 3: Add metadata and bump the shared version**

Add the six HD data attributes to `.scrolly-canvas`. Replace every `canvas18` occurrence in `index.html`, `assets/gpu-scroll-canvas.js` asset requests, and matching tests with `canvas19`. Keep the existing standard selected-track preload script unchanged except for the shared version.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node tests/test-scroll-canvas.mjs`

Expected: `PASS: canvas runtime contract and syntax are valid` and `PASS: HTML uses canvas and preserves caption timing`.

- [ ] **Step 5: Commit HTML integration**

```bash
git add index.html assets/gpu-scroll-canvas.js tests/test-scroll-canvas.mjs
git commit -m "Wire progressive desktop HD animation tier"
```

### Task 4: Verify loading, visual quality, and mobile regression

**Files:**
- Modify only if verification reveals a defect: `assets/gpu-scroll-canvas.js`, `index.html`, `tests/test-scroll-canvas.mjs`
- Create: local-only screenshots and network evidence under `/tmp/unlimited-compute-hd-verification/`

**Interfaces:**
- Consumes: completed desktop HD animation.
- Produces: automated, visual, and network evidence suitable for deciding whether to replace the original local project.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
node tests/test-scroll-canvas.mjs
git diff --check
git status --short
```

Expected: test PASS, no whitespace errors, and only intentional changes or generated evidence excluded from Git.

- [ ] **Step 2: Start a local server and test a cold desktop load**

Run: `python3 -m http.server 4173`

In a fresh browser context at `http://127.0.0.1:4173/`, verify the first animation request is a standard desktop preview sheet, the canvas becomes ready before any HD dependency is required, and HD sheet requests follow after the first render.

- [ ] **Step 3: Compare desktop quality and motion**

Capture the start, middle, and end at 1440 x 900. Perform slow and fast scroll passes. Confirm no blank canvas, no visible fallback flash, reduced softness, and reduced three-frame stepping. Inspect `data-render-mode` to confirm `preview-hd` appears during interaction and `full` appears after settling.

- [ ] **Step 4: Verify constrained-network fallback**

With data saver or an emulated `2g` Network Information value, reload and scroll. Confirm no `gpu-scroll-preview-desktop-hd` request occurs and the standard preview remains functional.

- [ ] **Step 5: Verify mobile regression**

At a 390 x 844 viewport, cold-load and scroll through the animation. Confirm requests remain under `gpu-scroll-preview-mobile`, no HD request occurs, captions retain their timing, and the canvas never blanks.

- [ ] **Step 6: Inspect asset budget**

Run:

```bash
du -sh assets/gpu-scroll-preview-desktop-hd
find assets/gpu-scroll-preview-desktop-hd -type f -maxdepth 1 -print0 | xargs -0 ls -lh
```

Reject the encoding if the opening HD sheet materially delays unrelated page assets or individual sheets are too large for progressive loading. If rejected, first reduce WebP quality from 76 to 72, rebuild, and repeat Tasks 1 and 4 rather than changing tile size or cadence.

- [ ] **Step 7: Final verification and commit any corrections**

Run:

```bash
node tests/test-scroll-canvas.mjs
git diff --check
git status --short
```

Expected: all tests pass and the worktree contains no unintended files.

If verification required corrections:

```bash
git add assets/gpu-scroll-canvas.js index.html tests/test-scroll-canvas.mjs scripts/build-scroll-preview.py
git commit -m "Polish desktop HD scroll animation"
```

After verification, push the copied repository's `main` branch to its configured GitHub origin. Do not copy implementation changes back into `/Users/Natalie/Documents/New project 2/unlimited-compute-model` without a separate explicit instruction.
