# Desktop Scroll Animation HD Design

## Goal

Improve the desktop scroll-driven GPU animation so it looks materially sharper and remains smooth, without delaying the first useful render of the page. The mobile animation is already acceptable and must retain its current assets and runtime behavior.

The two equally important success criteria are:

1. The page and first animation image appear quickly on a cold load.
2. The desktop animation remains sharp and fluid while the user scrolls.

## Current System

The banner uses a canvas renderer backed by 361 full-resolution WebP frames. During active scrolling, it draws responsive preview tiles from desktop or mobile sprite sheets. After scrolling settles, it loads and draws the exact full-resolution frame.

The current desktop preview track contains every third frame at 960 x 540. This keeps startup light but causes visible softness and temporal stepping during motion. The mobile preview track is acceptable and is out of scope.

## Chosen Approach

Add a progressive desktop HD preview tier while retaining the current desktop preview tier as the startup fallback.

- Keep the existing first desktop preview sheet at high priority so the first visual is not blocked by HD assets.
- Generate a desktop HD track at 1440 x 810 with one preview for every two source frames.
- Begin loading HD sheets only after the critical first render.
- Prioritize the HD sheet containing the current target frame, then prefetch a bounded number of sheets in the current scroll direction.
- Draw from the HD tier whenever its required sheet is decoded; otherwise draw the existing standard preview immediately.
- Continue loading the exact full-resolution frame after the user settles, preserving maximum resting sharpness.
- Keep the mobile asset selection, preload behavior, cache limits, and rendering behavior unchanged.

## Loading and Rendering Flow

1. HTML selects the existing preview variant based on viewport width.
2. On desktop, the current standard sheet for the opening region is preloaded at high priority.
3. The canvas paints the standard preview as soon as it is decoded.
4. After the first render, the runtime schedules the matching HD sheet at lower priority.
5. During scrolling, the renderer requests the HD sheet nearest the target frame and a small directional lookahead window.
6. Rendering chooses the best decoded source in this order: exact full frame, desktop HD preview, standard preview, nearest loaded full frame.
7. After the settle delay, the exact full frame is requested and replaces the preview.

This order prevents HD downloads from blocking startup while allowing quality to improve progressively during interaction.

## Network Adaptation

The HD tier is enabled only on desktop. If `navigator.connection.saveData` is true, or the effective connection type is `slow-2g` or `2g`, the runtime stays on the existing standard preview tier. Browsers without the Network Information API use the HD tier because it is loaded progressively and remains bounded by the cache.

HD prefetch must not load the complete animation eagerly. The runtime keeps a limited decoded-sheet cache and evicts sheets outside the current directional window. This bounds memory and prevents background downloads from competing indefinitely with the rest of the page.

## Assets

The preview build script gains a desktop HD configuration:

- output directory: `assets/gpu-scroll-preview-desktop-hd/`
- source cadence: every 2 frames
- sprite layout: 3 columns by 1 row, producing at most 61 independently cacheable sheets
- tile size: 1440 x 810
- WebP quality: 76, subject to rejection only if visual and file-size verification shows it misses either success criterion

The existing desktop and mobile tracks remain available as fallbacks. Asset URLs receive a new cache-busting version shared by HTML and the runtime contract.

## Failure Handling

- A missing or failed HD sheet never blanks the canvas; the standard preview remains available.
- Failed HD URLs are remembered for the session to prevent repeated requests.
- A full-frame failure falls back to the best decoded preview.
- The current no-video-seeking behavior remains intact.

## Testing

Automated contract tests will be written before runtime changes and must initially fail for the missing HD behavior. They will verify:

- desktop HD metadata and URLs are present;
- mobile metadata and behavior are unchanged;
- HD loading begins after the startup path rather than replacing the critical standard preload;
- slow connections and data-saver mode disable HD requests;
- rendering falls back to standard previews when HD sheets are unavailable;
- cache and directional prefetch remain bounded;
- JavaScript syntax and the existing canvas/caption contract remain valid.

Visual verification will compare the existing and new desktop paths at representative start, middle, and end positions, plus fast and slow scrolling. Network verification will use a cold load to confirm that the first visible animation asset remains the standard high-priority sheet and that HD requests follow progressively. Mobile will receive a regression check at a narrow viewport.

## Working Copy and Delivery

Implementation will be performed in a separate copy of the project on the user's Desktop. The current local project at `/Users/Natalie/Documents/New project 2/unlimited-compute-model` will not receive implementation changes. Once the Desktop copy passes automated, visual, and network checks, changes may be committed and pushed to the configured GitHub repository in parallel with user review of the copied build. Replacing the original local project remains a separate, explicit follow-up action.

## Out of Scope

- Redesigning the animation, captions, scroll timing, or page layout.
- Changing the mobile preview tier.
- Returning to video seeking.
- Eagerly downloading all 361 full-resolution frames.
- Replacing the user's original local project during this implementation phase.
