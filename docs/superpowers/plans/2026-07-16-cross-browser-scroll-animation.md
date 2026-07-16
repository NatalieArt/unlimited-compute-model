# Cross-Browser Scroll Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scroll-driven MP4 seeking with a progressively loaded 361-frame WebP canvas animation that remains responsive across current desktop and mobile browsers and always retains a static fallback.

**Architecture:** The existing sticky banner keeps its captions and overlays but replaces `<video>` with `<canvas>`. A standalone dependency-free loader prioritizes the exact scroll frame and nearby frames, limits concurrent requests and decoded memory, and draws the nearest available frame while the exact image loads. The JPEG poster remains as the permanent CSS fallback.

**Tech Stack:** Static HTML/CSS/JavaScript, Canvas 2D, WebP, FFmpeg, Node.js static tests, Chrome DevTools Protocol QA.

## Global Constraints

- Export all 361 frames at 1600×900 and 24 fps.
- Allow no more than six concurrent image requests.
- Retain at most 72 decoded frames on desktop and 36 on mobile.
- Cap canvas device pixel ratio at 2×.
- Preserve captions, vignette, scale, rotation, stars, and article hand-off.
- Do not require autoplay, WebCodecs, service workers, or third-party libraries.
- Leave a correct poster visible whenever canvas, JavaScript, WebP, or a frame request fails.

---

### Task 1: Frame Asset Contract and Regression Test

**Files:**
- Create: `tests/test-scroll-canvas.mjs`
- Create: `assets/gpu-scroll-frames/` through FFmpeg generation

**Interfaces:**
- Produces: `frame-000.webp` through `frame-360.webp`, each 1600×900.
- Produces: a Node test that later tasks extend with DOM/source assertions.

- [ ] **Step 1: Write the failing asset test**

Create `tests/test-scroll-canvas.mjs` with Node assertions that enumerate `assets/gpu-scroll-frames`, require exactly 361 `.webp` files, require `frame-000.webp` and `frame-360.webp`, and fail while the directory is absent.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL with `expected 361 WebP frames, found 0`.

- [ ] **Step 3: Export the complete frame sequence**

Run:

```bash
mkdir -p assets/gpu-scroll-frames
ffmpeg -y -i assets/gpu-scroll-web.mp4 -vf fps=24 -c:v libwebp -quality 76 -compression_level 6 -preset picture -start_number 0 assets/gpu-scroll-frames/frame-%03d.webp
```

- [ ] **Step 4: Verify frame dimensions and size**

Extend the test to call `ffprobe` for the first, middle, and last frame and assert `1600,900`. Run the test and require PASS. Record total directory size with `du -sh assets/gpu-scroll-frames`.

- [ ] **Step 5: Commit the asset contract and frames**

```bash
git add tests/test-scroll-canvas.mjs assets/gpu-scroll-frames
git commit -m "Add scroll animation frame sequence"
```

### Task 2: Canvas Loader and Renderer

**Files:**
- Create: `assets/gpu-scroll-canvas.js`
- Modify: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes: a canvas with `data-frame-root`, `data-frame-count`, and `data-frame-pad` attributes.
- Produces: `window.SogniScrollCanvas.create(canvas, options)` returning `{setProgress, resize, destroy, getState}`.
- `setProgress(progress: number)` clamps 0–1, maps to frame 0–360, queues exact and neighboring frames, and schedules one draw.
- `getState()` returns `{targetFrame, drawnFrame, activeLoads, cacheSize, failedCount}` for QA.

- [ ] **Step 1: Add failing source-contract assertions**

Extend `tests/test-scroll-canvas.mjs` to require the runtime file and assert the source contains `MAX_CONCURRENT = 6`, desktop/mobile cache limits `72` and `36`, `requestAnimationFrame`, `drawImage`, `requestIdleCallback` fallback handling, and no `video.currentTime`.

- [ ] **Step 2: Verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because `assets/gpu-scroll-canvas.js` does not exist.

- [ ] **Step 3: Implement the runtime**

Implement an IIFE exposing `SogniScrollCanvas.create`. Use a priority queue with de-duplication, six active `Image` loads, an insertion-ordered `Map` for decoded images, nearest-loaded-frame lookup, cover-style canvas drawing, DPR-capped resizing, a mobile cache limit selected by `matchMedia('(max-width: 720px)')`, and failure isolation per frame. Load frame 0, then every twelfth navigation frame, then the current ±8 neighborhood; begin sequential idle warming only after the primary frame renders.

- [ ] **Step 4: Verify GREEN**

Run: `node tests/test-scroll-canvas.mjs`

Expected: PASS for the source contract and frame assets.

- [ ] **Step 5: Commit the runtime**

```bash
git add assets/gpu-scroll-canvas.js tests/test-scroll-canvas.mjs
git commit -m "Add progressive canvas frame renderer"
```

### Task 3: Replace Video Scrubbing in the GitHub HTML

**Files:**
- Modify: `index.html:79-86`
- Modify: `index.html:1180-1184`
- Modify: `index.html:1378-1470`
- Modify: `tests/test-scroll-canvas.mjs`

**Interfaces:**
- Consumes: `SogniScrollCanvas.create(canvas)` from Task 2.
- Produces: `<canvas class="scrolly-canvas" data-frame-root="assets/gpu-scroll-frames/frame-" data-frame-count="361" data-frame-pad="3">`.

- [ ] **Step 1: Add failing integration assertions**

Require `index.html` to include the canvas and runtime script, exclude `<video class="scrolly-video">`, exclude `currentTime`, and retain the four caption timing ranges.

- [ ] **Step 2: Verify RED**

Run: `node tests/test-scroll-canvas.mjs`

Expected: FAIL because the HTML still contains the video implementation.

- [ ] **Step 3: Replace markup and CSS**

Replace the video with the canvas, rename `.scrolly-video` styles to `.scrolly-canvas`, retain the poster background, and include `assets/gpu-scroll-canvas.js?v=canvas1` before the inline scroll controller.

- [ ] **Step 4: Replace the controller**

Create the renderer once, call `renderer.setProgress(p)` inside the existing render loop, apply scale/rotation to the canvas, call `renderer.resize()` on resize and orientation changes, and call `renderer.destroy()` on pagehide. In reduced-motion mode, do not create the renderer; retain the poster and final caption.

- [ ] **Step 5: Verify GREEN and parse all scripts**

Run `node tests/test-scroll-canvas.mjs` and parse every inline script with `new Function`. Expected: all checks PASS, no `currentTime`, and no banner video markup.

- [ ] **Step 6: Commit the integration**

```bash
git add index.html tests/test-scroll-canvas.mjs
git commit -m "Replace scroll video with canvas frames"
```

### Task 4: Synchronize the Blog Folder

**Files:**
- Modify: `/Users/Natalie/Documents/blog.sogni.ai/blogs/unlimited-compute-model/index.html`
- Create: `/Users/Natalie/Documents/blog.sogni.ai/blogs/unlimited-compute-model/assets/gpu-scroll-canvas.js`
- Create: `/Users/Natalie/Documents/blog.sogni.ai/blogs/unlimited-compute-model/assets/gpu-scroll-frames/`

**Interfaces:**
- Consumes: verified GitHub runtime and frame directory.
- Produces: the same animation behavior while preserving the blog folder's canonical URL, navigation includes, and footer.

- [ ] **Step 1: Stage the blog HTML inside the writable workspace**

Copy the blog HTML to a staging file, apply the same targeted CSS, canvas markup, script include, and controller replacement, then run the Node integration assertions against the staged path.

- [ ] **Step 2: Verify the staged blog RED/GREEN transition**

First run the integration assertions against the unchanged source and require failure on video markup. Run them again against the staged file and require PASS.

- [ ] **Step 3: Deploy with approved file access**

Copy the verified staged HTML, runtime, and frame directory into the blog folder. Do not overwrite unrelated navigation or site assets.

- [ ] **Step 4: Verify deployed hashes and scripts**

Compare SHA-1 hashes for the runtime and sampled frames, parse blog inline scripts, and assert the blog controller contains canvas integration and no `currentTime`.

### Task 5: Browser QA, Performance Measurement, and GitHub Deployment

**Files:**
- Temporary only: `/tmp/verify-canvas-animation.mjs`

**Interfaces:**
- Consumes: local file URL and deployed GitHub Pages URL.
- Produces: desktop/mobile QA metrics and screenshots without committed diagnostic artifacts.

- [ ] **Step 1: Run local desktop and mobile QA**

Use Chrome DevTools Protocol at 1440×900 and 390×844. Verify page identity, nonblank content, zero relevant console errors, canvas visibility, poster fallback, frame progression from 0 toward 360, active loads ≤6, cache size within 72/36, and no long frames above 50 ms during a controlled scroll.

- [ ] **Step 2: Capture screenshots**

Capture the first viewport and a mid-animation frame at desktop and mobile sizes. Visually check cover cropping, captions, vignette, zoom, rotation, and absence of blank flashes.

- [ ] **Step 3: Run the complete test suite**

Run `node tests/test-scroll-canvas.mjs`, inline-script parsing, `git diff --check`, and asset count/dimension checks. Expected: zero failures.

- [ ] **Step 4: Push and wait for GitHub Pages**

Push `main`, trigger or poll the Pages build, and require the deployed commit status `built`.

- [ ] **Step 5: Repeat QA against GitHub Pages**

Run the same desktop/mobile flow against a cache-busted public URL. Confirm the live HTML matches the local HTML, frame URLs return 200, the poster is immediate, canvas progresses, and there are no runtime errors or long-frame regressions.

- [ ] **Step 6: Final repository verification**

Require `git status --short --branch` to show `main...origin/main` with no changes. Report tested browsers honestly: direct Chrome desktop/mobile emulation, standards-based compatibility for Safari/Firefox/Edge, and any remaining physical-device test gap.
