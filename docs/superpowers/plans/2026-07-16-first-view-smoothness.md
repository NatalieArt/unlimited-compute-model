# First-View Scroll Animation Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first cold-cache scroll pass visually continuous while retaining exact 1600×900 quality after scrolling stops.

**Architecture:** Four lightweight 4×4 WebP sprite sheets provide a blended preview track at six-frame intervals. The existing loader renders the blended preview while scrolling, loads only exact nearby full-resolution frames, and upgrades to the exact full frame after a 120 ms settle window.

**Tech Stack:** Static HTML, Canvas 2D, browser `Image`/`image.decode()`, requestAnimationFrame, Python Pillow for asset generation, Node.js contract tests.

## Global Constraints

- Keep all 361 full-resolution 1600×900 WebP frames.
- Generate 61 preview tiles at 480×270, packed 16 per 1920×1080 sheet, quality 68, total at most 4 MB.
- Use preview blending only during motion; upgrade to an exact full frame after 120 ms without target movement.
- Do not preload the full 46 MB sequence or reintroduce MP4 seeking.
- Keep captions, timing ranges, vignette, final dim, stars, reduced-motion behavior, mobile layout, and link-preview metadata unchanged.
- Treat `fetchPriority` and `image.decode()` as optional browser enhancements with safe fallbacks.

---

### Task 1: Reproducible Preview Sprite Assets

**Files:**
- Create: `scripts/build-scroll-preview.py`
- Create: `assets/gpu-scroll-preview/sheet-0.webp`
- Create: `assets/gpu-scroll-preview/sheet-1.webp`
- Create: `assets/gpu-scroll-preview/sheet-2.webp`
- Create: `assets/gpu-scroll-preview/sheet-3.webp`
- Test: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes: `assets/gpu-scroll-frames/frame-NNN.webp` for indices 0 through 360 in steps of 6.
- Produces: four `sheet-N.webp` files, each 1920×1080, with 480×270 tiles in row-major order.

- [ ] **Step 1: Write the failing asset test**

Add checks that `assets/gpu-scroll-preview` contains exactly four files matching `sheet-[0-3].webp`, that every file is larger than 1024 bytes, that `ffprobe` reports `1920,1080`, and that their summed size is no more than `4 * 1024 * 1024` bytes.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because the preview directory or sprite sheets do not exist.

- [ ] **Step 3: Add the deterministic generator**

Implement `scripts/build-scroll-preview.py` with constants:

```python
FRAME_STEP = 6
TILE_SIZE = (480, 270)
GRID = (4, 4)
SHEET_SIZE = (1920, 1080)
QUALITY = 68
```

For each of the 61 source indices, resize with `Image.Resampling.LANCZOS`, paste into the row-major sprite cell, and save each completed sheet as WebP with `quality=68`, `method=6`, `exact=True`. Fill unused cells with `(0, 0, 0)`.

- [ ] **Step 4: Generate and verify assets**

Run:

```bash
/Users/Natalie/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-scroll-preview.py
node tests/test-scroll-canvas.mjs
```

Expected: four sheets exist, are 1920×1080, total no more than 4 MB, and the test passes.

- [ ] **Step 5: Commit the asset layer**

```bash
git add scripts/build-scroll-preview.py assets/gpu-scroll-preview tests/test-scroll-canvas.mjs
git commit -m "Add lightweight scroll preview sprites"
```

### Task 2: Two-Tier Preview and Full-Frame Renderer

**Files:**
- Modify: `assets/gpu-scroll-canvas.js`
- Test: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes canvas metadata: `data-preview-root`, `data-preview-count`, `data-preview-step`, `data-preview-columns`, `data-preview-rows`, `data-preview-tile-width`, and `data-preview-tile-height`.
- Produces diagnostic attributes: `data-render-mode="preview-blend|full|full-fallback"`, `data-drawn-frame`, `data-target-frame`, and `data-load-errors`.
- Preserves `window.SogniScrollCanvas.create(canvas)` and its `setProgress`, `resize`, `destroy`, and `getState` methods.

- [ ] **Step 1: Write the failing runtime contract test**

Require the runtime to include exact contracts for `SETTLE_DELAY = 120`, `DESKTOP_CACHE_LIMIT = 36`, `MOBILE_CACHE_LIMIT = 18`, `loadPreviewSheets`, `drawPreviewBlend`, `image.decode`, `preview-blend`, and `full-fallback`. Require the old `warmNavigationFrames` and `navigationFrames` identifiers to be absent.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL on the first missing preview-renderer contract.

- [ ] **Step 3: Implement preview loading**

Read preview metadata from the canvas. Load four sheets through `Image`, set high fetch priority when supported, call `image.decode()` after `onload` when supported, store successfully decoded sheets by index, and isolate failures in a preview-failure set without blocking full-frame loading.

- [ ] **Step 4: Implement blended preview drawing**

Add a region-drawing helper that cover-crops a 480×270 tile into the canvas. `drawPreviewBlend(targetFrame)` must:

```js
var position = targetFrame / previewStep;
var lower = Math.floor(position);
var upper = Math.min(previewCount - 1, Math.ceil(position));
var mix = position - lower;
```

Draw the lower tile at alpha 1, the upper tile at alpha `mix`, reset `globalAlpha` to 1, and set `data-render-mode="preview-blend"` plus `data-drawn-frame` equal to the current target.

- [ ] **Step 5: Implement settle-to-full rendering and decode-before-draw**

Update `lastTargetChange` only when the rounded target changes. While less than 120 ms have elapsed, prefer preview blending. After settling, draw the exact full frame when loaded. If preview is unavailable, draw the nearest loaded full frame with `data-render-mode="full-fallback"`. Full images enter the loaded map only after `image.decode()` settles or the compatibility fallback completes.

- [ ] **Step 6: Remove sparse full-resolution warming and reduce caches**

Delete startup navigation-frame loading. Keep exact plus radius-three neighborhood loading and urgent promotion. Set desktop/mobile full-frame cache limits to 36/18.

- [ ] **Step 7: Run tests and commit**

```bash
node tests/test-scroll-canvas.mjs
git add assets/gpu-scroll-canvas.js tests/test-scroll-canvas.mjs
git commit -m "Blend preview sprites during cold scroll"
```

Expected: all frame, sprite, runtime syntax, and contract checks pass.

### Task 3: HTML Metadata and Cache Version

**Files:**
- Modify: `index.html`
- Test: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Produces preview metadata for `SogniScrollCanvas.create(canvas)`.
- Loads `assets/gpu-scroll-canvas.js?v=canvas7` and requests full/preview assets with `data-frame-version="canvas7"`.

- [ ] **Step 1: Write the failing HTML test**

Require the canvas to contain:

```html
data-preview-root="assets/gpu-scroll-preview/sheet-"
data-preview-count="61"
data-preview-step="6"
data-preview-columns="4"
data-preview-rows="4"
data-preview-tile-width="480"
data-preview-tile-height="270"
data-frame-version="canvas7"
```

Require the runtime URL to be `assets/gpu-scroll-canvas.js?v=canvas7`.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because preview metadata and the canvas7 cache version are absent.

- [ ] **Step 3: Add metadata and cache busting**

Add the exact attributes above to `.scrolly-canvas`, replace both canvas6 version markers with canvas7, and leave all caption and presentation markup unchanged.

- [ ] **Step 4: Run tests and commit**

```bash
node tests/test-scroll-canvas.mjs
git add index.html tests/test-scroll-canvas.mjs
git commit -m "Enable cold-cache preview track"
```

Expected: HTML contract, inline script syntax, sprite, and runtime tests all pass.

### Task 4: Local Sync, Cold Public QA, and Deployment

**Files:**
- Copy: `index.html` to `/Users/Natalie/Documents/blog.sogni.ai/blogs/unlimited-compute-model/index.html`
- Copy: `assets/gpu-scroll-canvas.js` to the matching blog assets directory.
- Copy: `assets/gpu-scroll-preview/` to the matching blog assets directory.

**Interfaces:**
- Produces byte-identical repo, local blog, and GitHub Pages HTML/runtime/preview assets.

- [ ] **Step 1: Run local automated verification**

Run `node tests/test-scroll-canvas.mjs`, `git diff --check HEAD`, and compare the four sprite dimensions and total size. Expected: zero failures.

- [ ] **Step 2: Run local rendered QA**

Serve the repository on `127.0.0.1`, test 1440×900 and 390×844, and rapidly scroll the animation. Every sample must show either `full` or `preview-blend`, no load errors, no horizontal overflow, and the stopped target must become `full` within one second.

- [ ] **Step 3: Sync and verify the blog folder**

Copy the three changed surfaces, verify `cmp -s` for HTML/runtime/sprites, and confirm 361 non-truncated full frames plus four non-truncated preview sheets.

- [ ] **Step 4: Push and wait for Pages**

Push `main`, then poll the ordinary public URL until HTML contains `canvas7` and preview metadata. Do not rely only on a query-parameter URL.

- [ ] **Step 5: Run cold public QA and final verification**

Use a cache-busted public page URL at desktop and mobile viewports. Exercise rapid scroll, wait one second, confirm `preview-blend` during motion and exact `full` at rest, capture screenshots, check console warnings/errors, and compare public HTML/runtime/sprites byte-for-byte with local files.

- [ ] **Step 6: Leave the ordinary public link open**

Reset the temporary viewport, navigate to `https://natalieart.github.io/unlimited-compute-model/`, verify canvas7 frame 0 without errors, and preserve that tab as the deliverable.
