// Files are opened as local blob URLs. They never leave the device.
export function disposeMedia(media) {
  if (!media) return;
  if (media.kind === 'video') {
    media.element.pause();
    media.element.removeAttribute('src');
    media.element.load();
  }
  media.element.remove();
  URL.revokeObjectURL(media.url);
}

export async function loadMedia(file, pool, signal) {
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
  if (!kind) throw new Error('Choose a photo or video file.');
  const element = document.createElement(kind === 'video' ? 'video' : 'img');
  const media = { kind, element, url: URL.createObjectURL(file), fileName: file.name };
  if (kind === 'video') {
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.preload = 'auto';
    element.setAttribute('playsinline', '');
  } else {
    element.alt = '';
  }
  pool.append(element);
  try {
    await new Promise((resolve, reject) => {
      const event = kind === 'video' ? 'loadeddata' : 'load';
      const clean = () => {
        clearTimeout(timeout);
        element.removeEventListener(event, ready);
        element.removeEventListener('error', failed);
        signal?.removeEventListener('abort', aborted);
      };
      const ready = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new Error('This file could not be opened. Try a JPEG, PNG, or H.264 MP4.')); };
      const aborted = () => { clean(); reject(signal.reason); };
      const timeout = setTimeout(() => { clean(); reject(new Error('Loading took too long. Try a smaller file.')); }, 30000);
      element.addEventListener(event, ready, { once: true });
      element.addEventListener('error', failed, { once: true });
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      element.src = media.url;
      if (kind === 'video') element.load();
    });
    media.width = kind === 'video' ? element.videoWidth : element.naturalWidth;
    media.height = kind === 'video' ? element.videoHeight : element.naturalHeight;
    media.duration = kind === 'video' ? element.duration : null;
    if (!media.width || !media.height || (kind === 'video' && (!Number.isFinite(media.duration) || media.duration <= 0))) {
      throw new Error('This file has no usable picture or duration. Try another file.');
    }
    return media;
  } catch (error) {
    disposeMedia(media);
    throw error;
  }
}

export function seekVideo(video, time, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', ready);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const ready = () => { clean(); resolve(); };
    const failed = () => { clean(); reject(new Error('A video could not be prepared. Try replacing it.')); };
    const aborted = () => { clean(); reject(signal.reason); };
    const timeout = setTimeout(() => { clean(); reject(new Error('A video took too long to seek. Please try again.')); }, 15000);
    video.addEventListener('seeked', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    video.currentTime = time;
  });
}

// play() can remain pending if the OS suspends playback. Always allow cancellation.
export function playVideo(video, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timeout); signal?.removeEventListener('abort', aborted); };
    const aborted = () => { clean(); reject(signal.reason); };
    const timeout = setTimeout(() => { clean(); reject(new Error('Playback could not start. Tap resume, then try again.')); }, 15000);
    signal?.addEventListener('abort', aborted, { once: true });
    video.play().then(() => { clean(); resolve(); }, error => { clean(); reject(error); });
  });
}

export function formatDuration(seconds) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
