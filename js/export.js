import { drawStory, shortestDuration, STORY_WIDTH, STORY_HEIGHT } from './renderer.js';
import { seekVideo, playVideo } from './media.js';

// Also used for the pre-export file-size estimate in the editor.
export const VIDEO_BITS_PER_SECOND = 6_000_000;

export function getMp4MimeType() {
  if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  // Explicit H.264 first. The native MP4 default covers Safari's generic MIME support.
  return ['video/mp4;codecs=avc1.42E028', 'video/mp4;codecs=avc1.4D4028',
    'video/mp4;codecs=avc1', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  return canvas;
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
  const mimeType = getMp4MimeType();
  if (!mimeType) throw new Error('MP4 export is unavailable in this browser. Try a current version of Chrome, Edge, or Safari.');
  const videos = panes.filter(pane => pane.media.kind === 'video').map(pane => pane.media.element);
  const duration = shortestDuration(panes);
  const canvas = makeCanvas();
  const context = canvas.getContext('2d', { alpha: false });
  let stream;
  let recorder;
  try {
    signal.throwIfAborted();
    videos.forEach(video => video.pause());
    onProgress({ phase: 'preparing', duration });
    await Promise.all(videos.map(video => seekVideo(video, 0, signal)));
    drawStory(context, panes, canvas.width, canvas.height);
    stream = canvas.captureStream(30);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    await Promise.all(videos.map(video => playVideo(video, signal)));
    signal.throwIfAborted();

    return await new Promise((resolve, reject) => {
      const chunks = [];
      let frame;
      let endTimer;
      let settled = false;
      let finishing = false;
      let lastPaint = 0;
      const startedAt = performance.now();

      const clean = () => {
        cancelAnimationFrame(frame);
        clearTimeout(endTimer);
        clearTimeout(finalizeTimer);
        signal.removeEventListener('abort', aborted);
        videos.forEach(video => {
          video.removeEventListener('waiting', stalled);
          video.removeEventListener('pause', interrupted);
          video.removeEventListener('error', failed);
        });
        recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        clean();
        if (recorder.state !== 'inactive') recorder.stop();
        reject(error);
      };
      const aborted = () => fail(signal.reason);
      const stalled = () => {
        // An ended shortest clip is expected, not a buffering failure.
        if (!finishing && performance.now() - startedAt < duration * 1000 - 150) {
          fail(new Error('A video paused to buffer. Your layout is safe; please try exporting again.'));
        }
      };
      const failed = () => fail(new Error('A video could not be read during export. Try replacing that clip.'));
      const interrupted = () => {
        if (!finishing && !settled) fail(new Error('Video playback was interrupted. Keep the app open and try again.'));
      };
      let finalizeTimer;
      const finish = () => {
        if (settled || finishing) return;
        finishing = true;
        cancelAnimationFrame(frame);
        clearTimeout(endTimer);
        videos.forEach(video => video.pause());
        onProgress({ phase: 'finalizing', duration });
        finalizeTimer = setTimeout(() => fail(new Error('Saving took too long. Try exporting again.')), 15000);
        if (recorder.state !== 'inactive') recorder.stop();
      };
      const paint = now => {
        if (settled || finishing) return;
        if (now - lastPaint >= 1000 / 30 - 1) {
          drawStory(context, panes, canvas.width, canvas.height);
          lastPaint = now;
          onProgress({ phase: 'recording', progress: Math.min(99, (now - startedAt) / (duration * 10)), duration });
        }
        frame = requestAnimationFrame(paint);
      };

      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => fail(new Error('The browser could not encode this video. Close other apps and try again.'));
      recorder.onstop = () => {
        if (settled) return;
        if (!finishing) {
          fail(new Error('Recording stopped before the story finished. Keep the app open and try again.'));
          return;
        }
        settled = true;
        clean();
        if (!chunks.length) { reject(new Error('The browser produced an empty video. Please try again.')); return; }
        resolve(new Blob(chunks, { type: 'video/mp4' }));
      };
      signal.addEventListener('abort', aborted, { once: true });
      videos.forEach(video => {
        video.addEventListener('waiting', stalled);
        video.addEventListener('pause', interrupted);
        video.addEventListener('error', failed);
      });
      if (signal.aborted) { aborted(); return; }
      recorder.start(250);
      frame = requestAnimationFrame(paint);
      endTimer = setTimeout(finish, duration * 1000);
    });
  } finally {
    videos.forEach(video => video.pause());
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    canvas.width = canvas.height = 1;
  }
}
