# Stackr verification — 24 October 2026

Development tools, tests, and this verification report are stored in `dev/` and excluded from the Vercel deployment. Run the local server with `npm run dev` and the geometry checks with `npm test` from the project root.

The current exporter uses WebCodecs at 60 fps. Earlier MediaRecorder results below are retained as history; the **60 fps export update** section records the current implementation's end-to-end checks.

## Environment

- Windows, Node.js 20.19.0.
- Automated Chromium browser (Chrome 156), desktop viewport and a 390 × 844 mobile context with touch enabled.
- Browser file uploads, pointer and keyboard interactions, native canvas/MediaRecorder exports, and actual file downloads.
- FFmpeg/ffprobe used only to generate test inputs and inspect exported files. Neither is an app dependency.

## Results

`npm test`: **19 tests passed**. These cover crop/zoom geometry, movement bounds, pane duration, exact 60 fps timing including fractional endings, MP4 sample offsets and duration, rejection of missing/duplicated encoded frames, reordered presentation timestamps, and encoder color metadata.

Browser checks passed:

- Neither layout selected on first load; explicit two-/three-row selection.
- Export disabled for empty, partially filled, or loading visible layouts.
- Photos, videos, mixed layouts, Replace, Remove, and keyboard pane actions.
- Pointer dragging and emulated native touch dragging change framing; movement remains bounded.
- An invalid photo replacement displays a pane error and retains the original photo and export availability.
- Switching layouts preserves existing panes, including a hidden third frame.
- All videos play muted together; forcing the shortest clip to its end restarts every video in sync.
- Preparing, percentage progress, completion at 100%, and downloadable output.
- Cancel button and Escape preserve the composition; recording stream tracks are released.
- Buffering and backgrounding failure paths preserve the composition. These were tested with injected `waiting` and `visibilitychange` events.
- Unexpected playback pause and an early recorder stop produce recoverable errors; retry works.
- A third video deliberately delayed during loading can finish loading after its pane is hidden, without interrupting an active two-row export.
- Repeated exports succeed after cancellation and errors.
- MP4 support detection was tested with native support and with `isTypeSupported()` stubbed to return false: unsupported video export is explained and disabled, while all-photo JPEG export stays enabled.
- Manifest, icons, install-event handling, service-worker activation, and offline reload.
- Offline reload and editing work both at the root URL and under a nested deployment directory with its own service-worker scope.
- Mobile layout has no horizontal overflow. Desktop and mobile screenshots were visually inspected.
- The final fresh browser run had no console errors or warnings. Chromium's informational message about the app handling the install prompt is expected.

## Exported files

| Composition | Verified output |
| --- | --- |
| Two photos, including a repositioned portrait image | JPEG, 1080 × 1920, 86,805 bytes |
| Three animated H.264 videos, lasting 10, 15, and 20 seconds; inputs include audio | H.264 MP4, 1080 × 1920, 9.9802 seconds, 7,192,433 bytes, no audio stream |
| A 10-second video plus a photo; third video finishes loading while hidden | H.264 MP4, 1080 × 1920, 9.988667 seconds, 6,103,580 bytes, no audio stream |

Decoded one frame per second from each of the three exported video rows. Each row had ten distinct frame hashes, confirming that all three rows animate throughout the export. Output is variable-frame-rate native recording, targeting 30 fps; effective cadence and bitrate depend on the device/browser.

Test media, downloaded outputs, and screenshots are in the ignored `.qa/` directory. They are not part of the PWA shell or needed for deployment. Browser-tool logs and duplicate downloads are ignored under `.playwright-mcp/`.

## Stackr rename and copy removal

Updated the displayed name, document title, PWA manifest, package name, server message, download filenames, README, and service-worker cache namespace. Removed the promotional intro, subtitles, footer, empty-state text, and dialog headlines without replacement text. Removed their unused styles.

The eight unit tests still pass. A Chromium smoke check verified both layouts' selection controls, JPEG and short mixed-media MP4 exports, `stackr-` download filenames, mobile sizing, offline reload, and migration from the previous cache namespace to the Stackr v2 cache. No page errors occurred.

## How the browser checks were performed

FFmpeg's `testsrc2` source generated animated test patterns at 30 fps. The three clips used landscape, portrait, and square dimensions, different hue offsets, and durations of 10, 15, and 20 seconds. They were encoded with `libx264`; sine-wave audio was included so ffprobe could confirm that the exported files contained no audio stream.

Playwright handled navigation, accessible-name/CSS element lookup, clicks, keyboard input, file uploads, screenshots, and downloads in a separate automated Chromium browser. Most interactions used its normal APIs, such as `getByRole(...).click()` and `locator(...).setInputFiles(...)`. Touch dragging used a Chrome DevTools Protocol session and `Input.dispatchTouchEvent`. Some failure cases used JavaScript event injection, as noted above.

## Zoom and export-layout update

- The JPEG/MP4 explanation is inside the export section, below the export button on desktop and mobile.
- Panes have no persistent visible text or labels. Add, Replace, Remove, and zoom controls use icons, with accessible labels retained.
- Each pane supports 1×–3× zoom through minus/plus buttons and a keyboard/touch-accessible slider. The crop stays within the source boundaries and preserves its center where possible. Hidden panes retain their zoom; successful replacement resets it, while a failed replacement preserves it.
- A zoomed 1080 × 1920 JPEG was downscaled and compared with the preview canvas: the average RGB-channel difference was 0.73 out of 255, consistent with JPEG compression and scaling. The crop matched.
- A zoomed mixed photo/video layout exported as H.264 MP4 at 1080 × 1920, 1.033433 seconds, 268,466 bytes, with no audio stream. Browser checks exercised native touch slider interaction and both zoom buttons.
- The completed export dialog has a measured 24 px gap between the progress bar and download button.
- Desktop/mobile screenshots were inspected; mobile had no horizontal overflow. The desktop browser check recorded no page errors.
- The pre-export size estimate and recorder now share one bitrate constant. The completion dialog continues to report actual blob size. The service-worker shell version is v3.

## Compact header and development-folder update

- Header height reduced from 104 px to 64 px on desktop, and from 79 px to 56 px on mobile. Main top padding reduced from 32 px to 20 px. The selected editor fits in Chromium at desktop viewports of 1280 × 720 and 1366 × 768; smaller screens retain normal vertical scrolling. The 390 px mobile viewport has no horizontal overflow.
- Local server moved to `dev/server.mjs`, with its document root adjusted to the parent app directory. `npm run dev -- --port 8080` starts correctly and serves the root page, modules, stylesheet, manifest, service worker, and icons with successful responses and appropriate content types.
- Tests moved to `dev/tests/renderer.test.js` and their import path updated. All 12 tests pass through `npm test`.
- Added explicit Vercel static-site configuration and `.vercelignore` deployment exclusions. Configuration JSON was parsed and settings checked against Vercel's documentation; an actual Vercel deployment was not performed.
- The service-worker shell version is now v4. README instructions use `npm run dev`, describe the development/static-hosting split, and include the current features, export behavior, and device limitations.

## 60 fps export update

- Replaced live canvas/MediaRecorder recording with paused, frame-by-frame composition and native WebCodecs H.264 encoding. Timestamps are integer microseconds on a 60 fps timeline. The target bitrate is 12 Mbps, with quality-mode encoding and Level 4.2 H.264 profiles.
- Removed the preview's 30 fps throttle. Export stops redundant preview drawing and does not use animation callbacks, the display refresh rate, or a wall-clock recording timer to choose output frames.
- Added a dependency-free MP4 writer with fast-start metadata, sample/presentation timing, keyframe tables, and explicit encoder-provided color matrix, transfer, primaries, and range. The writer rejects missing/duplicated timestamps, incomplete frame counts, mismatched duration, and unsupported format changes.
- Generated 60 fps, 4-/5-/6-second source videos whose individual frames encode unique binary IDs, with different offsets in each pane. The three-row output is H.264 High / Level 4.2, 1080 × 1920, exactly 4 seconds and 240 decoded frames, with both reported average and nominal frame rates at 60/1. Every source ID in every row was present in sequence: **zero missing or duplicated source frames**.
- Repeated that check while adding a 25 ms delay to each seek completion. The export waited for the source frames; all three rows again preserved all 240 IDs in order.
- Tested a moving 60 fps source containing B-frames. The final output is 4 seconds, 240 frames, 1080 × 1920, 4,643,368 bytes, and has no audio. ffprobe reports BT.709 matrix/primaries, sRGB transfer, and limited-range YUV matching the encoder metadata. Four sampled output frames were compared with the corresponding uncompressed canvas frames: RGB SSIM was 0.962–0.965 on this saturated, high-frequency test pattern. H.264 remains lossy; this is not a lossless-export claim.
- Cancellation during encoding and an injected encoder failure both close the encoder and preserve the composition. Repeated exports succeed afterward. Injected backgrounding still aborts cleanly.
- With WebCodecs deliberately unavailable, JPEG export remains functional at 1080 × 1920 and MP4 export is disabled with a compatibility message. There is no silent 30 fps fallback.
- An offline reload followed by a zoomed mixed-media MP4 export succeeds in a 390 × 844 Chromium touch context. Completion reports 60 fps and 100%, with no horizontal overflow. The service-worker shell is v5 and includes both new JavaScript modules.
- `dev/check-frame-cadence.py` reproduces the binary-frame-ID test with optional development-only Python/FFmpeg tools. Both the normal and delayed-decoding exported files passed its verifier. Test artifacts are under ignored `.qa/` paths.

## Remaining device checks

Safari, Edge, physical Android/iOS devices, OS-level installation, phone low-power modes, HEIC/HEVC sources, and long/resource-intensive exports were not tested on this Windows environment. Mobile touch testing used Chromium emulation, not a physical phone. Browser support checks handle unavailable native MP4 encoding, but cannot guarantee sufficient resources for every input or device.

Before sharing broadly, open an HTTPS deployment on your intended phones, install it from the browser, and export a short composition from each phone's camera files.
