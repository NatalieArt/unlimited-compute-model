# First-View Scroll Animation Smoothness Design

## Context

The current canvas animation is smooth after one complete viewing because the browser has cached the 1600×900 WebP frames. On a cold first viewing, network transfer and image decoding can temporarily leave the renderer using sparse high-resolution fallback frames. The visible result is a small jump during fast scrolling. The full sequence is about 46 MB, so downloading every full-resolution frame before interaction would replace the jump with a long initial wait.

## Decision

Use a two-tier renderer:

1. A lightweight preview track is available for continuous motion immediately after page load.
2. Full-resolution frames load only around the current scroll position and replace the preview after scrolling settles.

This preserves the current final image quality while making the cold first pass visually continuous.

## Preview Track

- Generate 61 preview frames from full-resolution frames 0, 6, 12, …, 360.
- Resize each preview tile to 480×270.
- Pack 16 tiles into each 4×4 WebP sprite sheet at 1920×1080.
- Produce four sprite sheets; unused cells in the last sheet remain black and are never addressed.
- Encode the sheets at WebP quality 68 with a total transfer budget of at most 4 MB.
- Load the four sheets with high priority at startup. Four requests replace the current set of many sparse high-resolution requests.

## Rendering

- While the target scroll frame is changing, derive its position between the two adjacent preview tiles.
- Draw the lower preview tile, then draw the upper tile with fractional alpha. This crossfade acts as lightweight visual interpolation and avoids sparse-frame jumps.
- Mark preview rendering with `data-render-mode="preview-blend"` and report the requested target in `data-drawn-frame` for diagnostics.
- When the target remains unchanged for 120 ms and its exact 1600×900 frame is decoded, replace the preview with that exact frame and mark `data-render-mode="full"`.
- If preview sheets are unavailable, fall back to the current nearest-loaded full-resolution behavior. The CSS poster remains the zero-network visual fallback.

## Full-Resolution Loading

- Remove startup preloading of sparse full-resolution frames; the preview sprites replace that role.
- Keep loading the exact target and three neighboring full-resolution frames in the current scroll direction.
- Promote current-target requests over queued older requests.
- Wait for `image.decode()` before making a full-resolution image drawable when supported; use `onload` as the compatibility fallback.
- Reduce the full-resolution in-memory cache to 36 frames on desktop and 18 on mobile because preview sprites provide navigation coverage.

## Compatibility and Failure Handling

- Use Canvas 2D, WebP, `Image`, and `requestAnimationFrame`; no WebCodecs or browser-specific video seeking.
- Treat `fetchPriority` and `image.decode()` as optional enhancements.
- A failed preview sheet must not stop full-frame loading.
- A failed full-resolution frame must leave the preview animation usable.
- `prefers-reduced-motion` behavior remains unchanged and does not load the animation.
- Existing captions, transform, vignette, final dim, stars, and mobile layout remain unchanged.

## Validation

Automated checks must verify:

- four non-empty 1920×1080 sprite sheets exist;
- preview metadata is present in HTML;
- the loader contains preview blending, the 120 ms settle rule, decode-before-draw, and full-frame fallbacks;
- all 361 full-resolution frames remain present and non-truncated;
- inline scripts parse and no video `currentTime` seeking returns.

Rendered QA must cover a cold public load at 1440×900 and 390×844:

- the first visible frame is immediate;
- every rapid-scroll sample has either an exact full frame or `preview-blend` output for the current target;
- the stopped position upgrades to `full` within one second on the tested connection;
- no relevant console errors, framework overlay, horizontal overflow, blank frame, or broken caption transition appears;
- a warm second pass remains at least as smooth as the current version.

## Non-Goals

- Do not preload all 46 MB.
- Do not permanently lower the displayed still-frame quality.
- Do not reintroduce MP4 seeking.
- Do not change article content, captions, timing ranges, or link-preview metadata.
