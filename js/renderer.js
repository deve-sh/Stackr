// This is the single source of truth for both preview and export framing.
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

// Return the part of the original image/video that fills a pane, without stretching.
export function cropRect(mediaWidth, mediaHeight, paneWidth, paneHeight, position, zoom = MIN_ZOOM) {
  const scale = Math.max(paneWidth / mediaWidth, paneHeight / mediaHeight) * clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const width = paneWidth / scale;
  const height = paneHeight / scale;
  return {
    x: Math.max(0, mediaWidth - width) * clamp(position.x),
    y: Math.max(0, mediaHeight - height) * clamp(position.y),
    width,
    height,
  };
}

// Convert a drag in preview pixels into a resolution-independent crop position.
export function movePosition(media, position, deltaX, deltaY, paneWidth, paneHeight, zoom = MIN_ZOOM) {
  const crop = cropRect(media.width, media.height, paneWidth, paneHeight, position, zoom);
  const overflowX = media.width - crop.width;
  const overflowY = media.height - crop.height;
  return {
    x: overflowX > 0.001 ? clamp(position.x - deltaX * crop.width / paneWidth / overflowX) : 0.5,
    y: overflowY > 0.001 ? clamp(position.y - deltaY * crop.height / paneHeight / overflowY) : 0.5,
  };
}

// Keep the current subject centered when zooming, clamping at the image edges.
export function zoomPosition(media, position, oldZoom, newZoom, paneWidth, paneHeight) {
  const before = cropRect(media.width, media.height, paneWidth, paneHeight, position, oldZoom);
  const after = cropRect(media.width, media.height, paneWidth, paneHeight, position, newZoom);
  const overflowX = media.width - after.width;
  const overflowY = media.height - after.height;
  return {
    x: overflowX > 0.001 ? clamp((before.x + before.width / 2 - after.width / 2) / overflowX) : 0.5,
    y: overflowY > 0.001 ? clamp((before.y + before.height / 2 - after.height / 2) / overflowY) : 0.5,
  };
}

export function shortestDuration(panes) {
  const durations = panes.filter(pane => pane.media?.kind === 'video').map(pane => pane.media.duration);
  return durations.length ? Math.min(...durations) : null;
}

export function drawStory(context, panes, width, height) {
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  const paneHeight = height / panes.length;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  panes.forEach((pane, index) => {
    const media = pane.media;
    if (!media || (media.kind === 'video' && media.element.readyState < 2)) return;
    const crop = cropRect(media.width, media.height, width, paneHeight, pane.position, pane.zoom);
    context.save();
    context.beginPath();
    context.rect(0, index * paneHeight, width, paneHeight);
    context.clip();
    context.drawImage(media.element, crop.x, crop.y, crop.width, crop.height,
      0, index * paneHeight, width, paneHeight);
    context.restore();
  });
}
