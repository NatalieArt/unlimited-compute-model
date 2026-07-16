# Cross-Browser Scroll Animation Design

## Goal

Replace scroll-driven MP4 seeking with a deterministic canvas renderer that stays responsive across current Chrome, Safari, Firefox, and Edge on desktop and mobile. Older or restricted browsers must always show a correct static frame instead of a blank or broken banner.

## Root Cause

The current implementation assigns `video.currentTime` while the user scrolls. Video seeking is asynchronous and browser-dependent. Different decoders, network range requests, caches, and hardware acceleration settings produce inconsistent latency and unfinished seek queues. Throttling reduces the problem but cannot remove the decoder dependency.

## Architecture

The banner will use three layers:

1. A CSS poster background that renders immediately without JavaScript.
2. A responsive `<canvas>` that draws the requested animation frame after that frame is decoded.
3. Existing captions, vignette, stars, zoom, rotation, and article hand-off layers above the canvas.

The MP4 will remain only as a source asset for producing frames. It will not run in the browser.

## Frame Assets

- Export all 361 frames of the complete 15.04-second animation at its native 24 fps.
- Use numbered WebP frames with deterministic zero-padded filenames.
- Keep the source aspect ratio and enough resolution for the current 1600×900 banner.
- Use lossy WebP compression tuned to preserve the detailed GPU and vortex artwork.
- Keep the existing JPEG poster as the universal fallback.
- Record the frame count and dimensions in one small JavaScript configuration object.

## Loading Strategy

Loading must never block the first screen.

1. The poster is visible immediately.
2. Load the first frame and every twelfth frame as a sparse navigation set.
3. Load frames nearest to the current scroll position with highest priority.
4. Preload a short window ahead of and behind the current direction.
5. Fill the remaining sequence during idle time.
6. If the exact requested frame is not ready, draw the closest decoded frame. Never clear the canvas or wait on the main thread.

The loader will allow at most six concurrent image requests. It will retain up to 72 decoded frames on desktop and 36 on mobile. Decoded frames outside the active window may be released and loaded again if needed.

## Rendering

- Scroll progress maps directly to an integer frame index.
- At most one canvas draw is scheduled per `requestAnimationFrame`.
- Repeated requests for the same frame are ignored.
- Canvas resolution follows its displayed size and device pixel ratio, capped at 2× to avoid oversized mobile or Retina buffers.
- Frames use cover-style cropping equivalent to the existing `object-fit: cover` video.
- Existing scale and rotation transforms remain on the canvas element.
- Caption timing and the final dimming transition remain unchanged.

## Compatibility and Fallbacks

- Current Chrome, Safari, Firefox, and Edge: full canvas animation.
- Browsers with canvas but without WebP decoding: poster remains visible and the article remains usable.
- Browsers without canvas, JavaScript, or with failed frame requests: poster remains visible.
- `prefers-reduced-motion`: show the poster and final caption without loading the frame sequence.
- The implementation must not require autoplay, video decoding, WebCodecs, service workers, or third-party libraries.

## Error Handling

- Frame failures are recorded once and skipped.
- A failed frame request must not stop loading neighboring frames.
- The renderer uses the closest available frame when an exact frame fails.
- The poster remains underneath the canvas for the entire banner lifetime.
- No user-facing loading spinner is required because useful content is always visible.

## Files and Deployment

- Update the GitHub source at `unlimited-compute-model/index.html`.
- Add generated frame assets under `assets/gpu-scroll-frames/`.
- Apply the same animation code and assets to `blog.sogni.ai/blogs/unlimited-compute-model/` while preserving that site's navigation and metadata.
- Publish the GitHub repository to `main` and verify GitHub Pages after the build completes.

## Testing

Automated checks must verify:

- the page no longer uses `<video>` or assigns `currentTime` for the banner;
- frame filenames, count, dimensions, and manifest are consistent;
- JavaScript parses without errors;
- poster fallback exists and canvas is not blank;
- frame request concurrency stays within its configured limit;
- scrolling from start to end maps to the expected first and last frames;
- repeated scroll updates do not create duplicate requests or draws;
- missing-frame behavior selects a decoded neighbor;
- reduced-motion mode does not load the sequence.

Rendered QA must cover local and GitHub URLs at desktop and mobile viewports. Each run must check page identity, meaningful content, console errors, visible poster/canvas, scroll interaction, first-to-last frame progression, and long-frame counts. Chrome is measured directly; Safari, Firefox, and Edge compatibility is ensured through standards-only APIs and should receive a final manual smoke test when those browsers are available.

## Success Criteria

- The first meaningful frame is visible immediately.
- No scroll-driven video seeking remains.
- The animation follows scroll without accumulating asynchronous work.
- A missing or slow frame never produces a blank banner.
- The page remains usable on unsupported or restricted browsers.
- Local, `blog.sogni.ai`, and GitHub Pages versions use the same animation behavior.
