# Stackr

I often find myself having to use Clipchamp or some third party app to combine videos into a 3 row layout for an Instagram story, because Instagram doesn't give the option to add videos to the layout it is generating.

---

The following is generated using Codex using GPT-6.1 Sol, based on the constraints and prompts I gave it.

A small, one-page PWA for combining photos and videos into a portrait Instagram Story. Plain HTML, CSS, and JavaScript; no runtime dependencies, account, backend, or build step. Files never leave your device.

## Run locally

Install [Node.js](https://nodejs.org/) (version 20 or newer), open a terminal in the project root, and run:

```sh
npm run dev
```

Open **http://localhost:8080**. No `npm install` is needed. Stop the server with Ctrl+C. For a different port, use `npm run dev -- --port 8081`. You can also run `node dev/server.mjs` directly. There is no `start` script: the server is a local development tool, not a production backend.

Do not double-click `index.html`: JavaScript modules and service workers need an HTTP/HTTPS origin.

## Use it

The interface is light, with a black 9:16 preview and no promotional intro or footer. The header is compact on desktop and mobile. Smaller windows can scroll vertically; the editor is not forced into a fixed screen height.

1. Choose **2 rows** or **3 rows**. Neither is selected initially.
2. Click or tap each frame to choose a photo or video. Browser-readable files work; JPEG, PNG, and H.264 MP4 are good choices. Some phones' HEIC/HEVC files may need conversion before the browser can read them.
3. Drag a photo or video to adjust its crop. Media automatically fills the frame, without stretching or empty edges. Tap it to show the minus/plus buttons and zoom slider (1×–3×). Each frame keeps its own zoom and position, which are applied to both preview and export.
4. Tap an occupied frame for the **Replace** and **Remove** icons. Frame numbers and media labels are not displayed. With a frame focused, use Enter/Space for actions, arrow keys to reposition, Shift+arrow for larger steps, and Escape to dismiss actions. The zoom slider is also keyboard accessible.
5. Fill every visible frame, then export and download. The format/duration explanation sits below the export button. The export dialog shows preparation, percentage progress, finalization, and a download action with spacing below the progress bar. Add your own music in Instagram if you like.

Videos play muted in the preview and loop together at the shortest visible video's duration. Switching to two rows keeps the third frame, including its position and zoom, in memory; it returns when you switch back. A hidden frame never affects the export or its duration. A canceled or failed replacement keeps the original media and framing. A successful replacement starts centered at 1× zoom. Reloading or closing the app starts a new composition; there is no project storage.

There are no timelines, manual video trimming, filters, audio selection/mixing, saved projects, accounts, or extra layouts. All export processing happens in the active browser tab.

## Export behavior

- **All photos:** 1080 × 1920 JPEG, quality 0.92.
- **At least one video:** 1080 × 1920, silent H.264 MP4 at 60 fps, targeting 12 Mbps in the encoder's quality mode. Videos start from zero and end with the shortest visible video. Photos stay on screen for that duration.
- Preview and export use the same crop and zoom calculations. Preview buttons, zoom controls, outlines, and thin pane guides are never exported.
- The pre-export size estimate uses `duration × VIDEO_BITS_PER_SECOND ÷ 8 ÷ 1,000,000` to get decimal MB. The bitrate constant is shared with the encoder configuration. It estimates about 1.5 MB per second (15 MB per 10 seconds); variable encoding bitrate and MP4 container overhead can change the result. The completion dialog reports the actual blob size.
- Video export prepares and draws each frame individually, then encodes it with the browser's native **WebCodecs VideoEncoder**. A small local MP4 writer packages the H.264 samples. Export does not record live playback or depend on display refresh rate: slower decoding/encoding takes longer instead of skipping timeline frames. Progress counts processed frames. The writer validates frame count, presentation timestamps, and duration before saving.
- Source videos stay paused during export. The output uses a fixed 60 fps timeline: sources below 60 fps repeat frames as needed; sources above 60 fps are sampled at 60 fps. This is designed to retain the cadence of 60 fps inputs, with no 30 fps cap. H.264 export is still lossy compression and output remains 1080 × 1920; it is not a lossless copy or a way to add detail missing from the source.
- Export speed depends on input decoding and the device, and may be slower than the video's duration. The output is held in memory, so long videos can produce large files and use substantial memory.
- Stay in the app during export. Canceling, decoding/encoding failures, or moving to the background stops the export and preserves your composition. A screen wake lock is requested when available, but isn't required. Preview playback resumes afterward.
- MP4 export requires WebCodecs with H.264 Level 4.2 support at 1080p60. The app probes the complete encoder configuration and never silently falls back to 30 fps, lower resolution, or WebM. If unavailable, editing and all-photo JPEG export still work. Try current Chrome/Edge or Safari on a supported device. File decoding can also depend on the device's installed codecs.
- Mobile operating systems may block automatic video playback (for example, in low-power mode). Tap **resume video preview** if it appears. The browser may still refuse recording under resource pressure.
- On iPhone/iPad, the download may be saved to **Files**. Open the MP4 there and use Share → Save Video to put it in Photos if that option is available.

## Host and install

Upload `index.html`, `styles.css`, `js/`, `icons/`, `manifest.webmanifest`, and `sw.js` to any static **HTTPS** host. The remaining files are for documentation, development, or testing. Relative paths support hosting under a subdirectory as well as at a domain root. Serve `.js` as JavaScript and `.webmanifest` as `application/manifest+json`. No SPA routing or special server headers are needed.

### Vercel

Import the repository with its project root as Vercel's Root Directory. The included `vercel.json` explicitly selects the **Other** framework preset, skips installation and build commands, and serves the existing files from `.`. There is no generated output folder and no production Node server to run. These settings follow [Vercel's configuration documentation](https://vercel.com/docs/project-configuration/vercel-json).

The included `.vercelignore` excludes `dev/`, local test media/browser artifacts, and development documentation from deployment. Keep it at the repository root; see [Vercel's file-exclusion documentation](https://vercel.com/docs/deployments/vercel-ignore). The `dev` folder contains the local server, tests, and verification report. Keep it locally for development; it is not needed by the hosted app.

### Install and offline use

- **Chrome/Edge on desktop or Android:** use the browser's install action or the app's **Install app** button when offered.
- **Safari on iPhone/iPad:** open the HTTPS URL, then Share → Add to Home Screen.
- **Safari on macOS:** use Add to Dock when offered by your Safari version.

After the first successful online load and service-worker installation, the app shell works offline. Selected files are local; they are not cached or uploaded. Reloading offline still starts a fresh composition. `localhost` is permitted for local development, but an ordinary phone LAN address over HTTP is not a secure origin for PWA installation; use an HTTPS host to install on a phone.

For updates, change `VERSION` in `sw.js` along with your app changes. The new worker installs all shell assets together and waits for old tabs to close before taking over. Close all installed-app windows/browser tabs for the site and reopen to activate an update. Caches are scoped to the deployment directory.

## Read the code

| File | Responsibility |
| --- | --- |
| `index.html` | Page structure, SVG symbols, and export dialog |
| `styles.css` | Light responsive interface and black preview |
| `js/app.js` | Layout selection, per-frame state, pointer/keyboard controls, preview playback, dialog, installation |
| `js/renderer.js` | Shared crop/zoom geometry, drag limits, canvas composition, shortest duration |
| `js/media.js` | Loading, seeking, playback, and local file cleanup |
| `js/export.js` | Full-resolution JPEG, encoder capability checks, frame-by-frame silent MP4 export |
| `js/video-timing.js` | Shared 60 fps/12 Mbps settings and integer-microsecond frame timestamps |
| `js/mp4.js` | Video-only MP4 container writer, frame validation, playback timing, and encoder color metadata |
| `sw.js` / `manifest.webmanifest` | Offline shell and PWA installation |
| `dev/server.mjs` | Optional local static server using Node's standard library; serves the project root |
| `dev/tests/` | Node tests for crop/zoom geometry, duration, frame timing, and MP4 container integrity |
| `dev/VERIFICATION.md` | Browser/export verification results and device-testing limitations |
| `vercel.json` / `.vercelignore` | Explicit static-host settings and files excluded from Vercel deployment |

There are no public APIs or remote services. The three media slots exist only in page memory. Each stores a loaded media element and its original dimensions/duration, a local blob URL, a normalized crop position, zoom level, and loading/error state. Only the selected number of slots is rendered or exported.

## Checks

```sh
npm test
```

This uses Node's built-in test runner. It checks crop and zoom geometry, matching preview/export framing, movement boundaries, pane placement, shortest-video duration, exact frame timing, MP4 sample offsets, reordered presentation timestamps, and rejection of missing/duplicated encoded frames. See [dev/VERIFICATION.md](dev/VERIFICATION.md) for browser checks and their limitations. Chromium on Windows and emulated mobile touch have been checked; Safari and physical Android/iOS devices remain unverified.

For an optional end-to-end cadence check, install Python and FFmpeg/ffprobe, then run `python dev/check-frame-cadence.py generate .qa`. Load the three generated clips in order (0, 17, 79) into the three-row layout without zooming or repositioning, export, and run `python dev/check-frame-cadence.py verify path/to/export.mp4`. It checks the frame IDs in every row, rather than trusting only the MP4's reported frame rate. These tools are not app dependencies.
