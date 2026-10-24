import { drawStory, shortestDuration, STORY_WIDTH, STORY_HEIGHT } from './renderer.js';
import { seekVideo } from './media.js';
import { Mp4Writer } from './mp4.js';
import { VIDEO_FRAME_RATE, VIDEO_BITS_PER_SECOND, TIME_SCALE, videoTimeline, frameTiming } from './video-timing.js';

export { VIDEO_FRAME_RATE, VIDEO_BITS_PER_SECOND } from './video-timing.js';

let configPromise;
export function getVideoExportConfig() {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame) return Promise.resolve(null);
  configPromise ??= (async () => {
    // Level 4.2 supports 1080 x 1920 at 60 fps; the old Level 4.0 did not.
    for (const codec of ['avc1.64002a', 'avc1.4d402a', 'avc1.42e02a']) {
      try {
        const config = {
          codec, width: STORY_WIDTH, height: STORY_HEIGHT,
          framerate: VIDEO_FRAME_RATE, bitrate: VIDEO_BITS_PER_SECOND,
          bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'avc' },
        };
        if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
      } catch { /* Try another H.264 profile, never a lower resolution or fps. */ }
    }
    return null;
  })();
  return configPromise;
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  return canvas;
}

// Cancellation must interrupt both browser seeking and asynchronous encoding.
function interruptible(promise, signal, message, timeoutMs = 30000) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timeout); signal.removeEventListener('abort', aborted); };
    const aborted = () => { clean(); reject(signal.reason); };
    const timeout = setTimeout(() => { clean(); reject(new Error(message)); }, timeoutMs);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
  });
}

export async function exportPhoto(panes, signal) {
  signal.throwIfAborted();
  const canvas = makeCanvas();
  drawStory(canvas.getContext('2d', { alpha: false }), panes, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  canvas.width = canvas.height = 1;
  signal.throwIfAborted();
  if (!blob) throw new Error('The image could not be saved. Please try again.');
  return blob;
}

export async function exportVideo(panes, { signal, onProgress }) {
  const duration = shortestDuration(panes);
  const { durationUs, frameCount } = videoTimeline(duration);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', forwardAbort, { once: true });
  if (signal.aborted) forwardAbort();
  const jobSignal = controller.signal;
  const videos = panes.filter(pane => pane.media.kind === 'video').map(pane => pane.media.element);
  const canvas = makeCanvas();
  const context = canvas.getContext('2d', { alpha: false });
  const writer = new Mp4Writer(canvas.width, canvas.height);
  const frameDurations = new Map();
  let encoder;
  let lastProgress = -1;
  try {
    jobSignal.throwIfAborted();
    onProgress({ phase: 'preparing', duration });
    const config = await interruptible(getVideoExportConfig(), jobSignal, 'The browser took too long to check video encoding support.');
    if (!config) throw new Error('This browser cannot encode 1080p60 H.264 video. Try current Chrome, Edge, or Safari on a supported device.');
    videos.forEach(video => video.pause());
    encoder = new VideoEncoder({
      output(chunk, metadata) {
        if (jobSignal.aborted) return;
        try { writer.addChunk(chunk, metadata, frameDurations.get(chunk.timestamp)); }
        catch (error) { controller.abort(error); }
      },
      error(error) { controller.abort(new Error(`Video encoding failed: ${error.message}`)); },
    });
    encoder.configure(config);

    for (let index = 0; index < frameCount; index++) {
      jobSignal.throwIfAborted();
      const timing = frameTiming(index, durationUs);
      // Seek inside the interval to avoid rounding onto the preceding source
      // frame. Videos stay paused: wall-clock speed cannot skip source frames.
      const sampleTime = (timing.timestamp + timing.duration / 2) / TIME_SCALE;
      await Promise.all(videos.map(video => seekVideo(video, Math.min(sampleTime, video.duration - 0.000001), jobSignal)));
      jobSignal.throwIfAborted();
      if (videos.some(video => video.readyState < 2)) throw new Error('A video frame could not be decoded. Please replace that clip and try again.');
      drawStory(context, panes, canvas.width, canvas.height);
      const frame = new VideoFrame(canvas, timing);
      frameDurations.set(timing.timestamp, timing.duration);
      try { encoder.encode(frame, { keyFrame: index % (VIDEO_FRAME_RATE * 2) === 0 }); }
      finally { frame.close(); }
      // Bound queued work. Waiting is fine; dropping an input frame to keep up
      // with a real-time recording clock is not.
      if (encoder.encodeQueueSize > 4) {
        await interruptible(encoder.flush(), jobSignal, 'The browser encoder stopped responding. Please try again.');
      }
      const progress = Math.min(99, Math.floor((index + 1) / frameCount * 100));
      if (progress !== lastProgress) {
        onProgress({ phase: 'encoding', progress, duration, frames: index + 1, frameCount });
        lastProgress = progress;
      }
    }
    onProgress({ phase: 'finalizing', duration });
    await interruptible(encoder.flush(), jobSignal, 'The browser took too long to finish encoding. Please try again.');
    jobSignal.throwIfAborted();
    return writer.finish(frameCount, durationUs);
  } finally {
    signal.removeEventListener('abort', forwardAbort);
    if (encoder && encoder.state !== 'closed') encoder.close();
    videos.forEach(video => video.pause());
    writer.clear();
    canvas.width = canvas.height = 1;
  }
}
