# Sharp Adaptive Scroll Preview Design

## Goal

Keep the cold-cache scroll animation continuous while making the image look sharp during motion, so the exact 1600×900 frame no longer appears to sharpen the canvas after scrolling stops.

## Confirmed Root Cause

The canvas8 motion track uses 480×270 landscape tiles. On a 390×844 portrait viewport, cover cropping uses only about 125 pixels of the tile's width before scaling that crop to the viewport. The exact 1600×900 frame uses about 416 source pixels for the same crop. Switching from the preview to the exact frame therefore creates a visible delayed-sharpening effect even though the frame motion is continuous.

## Selected Architecture

Create two device-specific preview tracks from the existing 361 exact frames:

- Desktop track: 61 landscape tiles, 960×540, source frames 0 through 360 in steps of 6.
- Mobile track: 61 center-cropped portrait tiles, 450×800, source frames 0 through 360 in steps of 6.
- Encode both tracks as WebP at quality 72 and pack 16 row-major tiles into each of four sheets.
- Desktop sheets are 3840×2160. Mobile sheets are 1800×3200.
- Keep the existing blended motion renderer and exact 1600×900 settle frame.

The HTML preloads only the track selected by a media query. The runtime selects the matching metadata at startup, so a device never downloads both preview tracks.

## Loading and Memory

- Keep all four selected preview sheets ready before the user reaches the scroll banner.
- Use `fetchpriority="high"` preloads in the document head.
- Keep the exact-frame priority loader introduced in canvas8.
- Reduce exact-frame caches to 16 frames on desktop and 10 on mobile, because the high-resolution preview remains available for backward and rapid movement.
- Target no more than 7 MiB compressed transfer for the desktop preview track and 5 MiB for the mobile preview track.

## Runtime Interface

The canvas exposes separate metadata for desktop and mobile preview roots and tile geometry. `SogniScrollCanvas.create(canvas)` chooses one configuration using the existing 720 px breakpoint, then uses the same `preview-blend`, `full`, and `full-fallback` render modes.

The runtime must continue to support browsers without `fetchPriority` or `image.decode()` and must isolate individual preview or exact-frame failures.

## Visual Behavior

- During scrolling, the current target remains continuous through interpolation between adjacent high-resolution preview tiles.
- After 120 ms without a target change, the exact full frame replaces the preview.
- Because the device-specific preview crop is close to display resolution, the replacement must not present as a visible delayed sharpening.
- Captions, timing ranges, vignette, final dim, stars, reduced-motion behavior, and layout remain unchanged.

## Verification

- Automated tests verify sheet counts, dimensions, byte budgets, runtime metadata, syntax, selected cache limits, and canvas9 cache busting.
- Local and public cold-cache QA cover 1440×900 and 390×844.
- Rapid-motion samples must use `preview-blend` without load errors.
- The stopped target must become exact `full` within one second.
- Screenshots of moving and settled states must show no obvious sharpness jump.
- Repository, local blog folder, and public GitHub Pages assets must be byte-identical.
