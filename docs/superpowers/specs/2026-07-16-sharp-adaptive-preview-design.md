# Sharp Adaptive Scroll Preview Design

## Goal

Keep the cold-cache scroll animation continuous while making the image look sharp during motion, so the exact 1600×900 frame no longer appears to sharpen the canvas after scrolling stops.

## Confirmed Root Cause

The canvas8 motion track uses 480×270 landscape tiles. On a 390×844 portrait viewport, cover cropping uses only about 125 pixels of the tile's width before scaling that crop to the viewport. The exact 1600×900 frame uses about 416 source pixels for the same crop. Switching from the preview to the exact frame therefore creates a visible delayed-sharpening effect even though the frame motion is continuous.

## Selected Architecture

Create two device-specific preview tracks from the existing 361 exact frames:

- Desktop track: 121 landscape tiles, 960×540, source frames 0 through 360 in steps of 3.
- Mobile track: 121 center-cropped portrait tiles, 450×800, source frames 0 through 360 in steps of 3.
- Encode both tracks as WebP at quality 70 and pack 4 row-major tiles into each of thirty-one sheets.
- Desktop sheets are 3840×540. Mobile sheets are 1800×800.
- Draw the nearest preview tile at full opacity instead of crossfading two moving objects. Keep the exact 1600×900 settle frame.

An inline head script checks the existing 720 px media query and creates preload links only for the selected track. The runtime selects the matching metadata at startup, so a device never downloads both preview tracks.

## Loading and Memory

- Request the first ten selected preview sheets immediately at high priority. After 750 ms, request sheets 10 through 30 at low priority so they warm in the background without competing with the first visible frame.
- Decode only a five-sheet directional window around the current preview frame; an urgent runtime request can still fetch a later current sheet directly.
- Decode the current sheet first so the requested frame can be painted immediately, then decode four sheets ahead in the current scroll direction. On direction changes, the current sheet remains visible while the five-sheet window pivots. The browser HTTP cache retains compressed responses for fast section changes.
- During motion, do not request exact-frame neighborhoods. After 120 ms without a target change, request only the single exact target frame at high priority.
- Reduce exact-frame caches to 16 frames on desktop and 10 on mobile, because the high-resolution preview remains available for backward and rapid movement.
- Target no more than 8 MiB compressed transfer for the desktop preview track and 5.5 MiB for the mobile preview track.

## Runtime Interface

The canvas exposes separate metadata for desktop and mobile preview roots and tile geometry. `SogniScrollCanvas.create(canvas)` chooses one configuration using the existing 720 px breakpoint, then uses `preview-sharp`, `full`, and `full-fallback` render modes.

The runtime must continue to support browsers without `fetchPriority` or `image.decode()` and must isolate individual preview or exact-frame failures.

## Visual Behavior

- During scrolling, the nearest source frame is selected from a 121-frame high-resolution preview track. No two object positions are composited together, so moving edges remain sharp.
- After 120 ms without a target change, the exact full frame replaces the preview.
- Because the device-specific preview crop is close to display resolution, the replacement must not present as a visible delayed sharpening.
- Captions, timing ranges, vignette, final dim, stars, reduced-motion behavior, and layout remain unchanged.

## Verification

- Automated tests verify thirty-one-sheet counts, dimensions, byte budgets, nearest-frame rendering without alpha blending, current-first directional five-sheet loading, staged selected-track preloading, settle-only exact loading, runtime metadata, syntax, selected cache limits, and canvas18 cache busting.
- Local and public cold-cache QA cover 1440×900 and 390×844.
- Rapid-motion samples must use `preview-sharp` without load errors.
- The stopped target must become exact `full` within one second.
- Screenshots of moving and settled states must show no obvious sharpness jump.
- Repository, local blog folder, and public GitHub Pages assets must be byte-identical.
