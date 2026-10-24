import { drawStory, movePosition, zoomPosition, clamp, shortestDuration, MIN_ZOOM, MAX_ZOOM } from './renderer.js';
import { loadMedia, disposeMedia, seekVideo, playVideo, formatDuration } from './media.js';
import { exportPhoto, exportVideo, getVideoExportConfig, VIDEO_BITS_PER_SECOND, VIDEO_FRAME_RATE } from './export.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const state = {
  rows: 0,
  selected: null,
  busy: false,
  // Keeping three independent slots lets a hidden third row survive layout changes.
  slots: Array.from({ length: 3 }, () => ({ media: null, position: { x: 0.5, y: 0.5 }, zoom: MIN_ZOOM, loading: false, error: '', controller: null })),
};
const previewCanvas = $('#preview-canvas');
const previewContext = previewCanvas.getContext('2d', { alpha: false });
const fileInput = $('#file-input');
const dialog = $('#export-dialog');
let mp4Supported = null; // Check the full 1080p60 encoder configuration asynchronously.
let paneElements = [];
let fileTarget = null;
let previewController;
let previewRunning = false;
let previewRestarting = false;
let exportController;
let outputUrl;
let toastTimer;
let deferredInstall;

const visiblePanes = () => state.slots.slice(0, state.rows);
const visibleVideos = () => visiblePanes().filter(pane => pane.media?.kind === 'video').map(pane => pane.media);

function announce(message) { $('#announcement').textContent = message; }
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

function updateUI() {
  const panes = visiblePanes();
  const videos = visibleVideos();
  const duration = shortestDuration(panes);
  // Bitrate × duration gives bits; divide by 8 for bytes and 1,000,000 for MB.
  const estimatedSizeMB = duration === null ? 0 : duration * VIDEO_BITS_PER_SECOND / 8 / 1_000_000;
  const loaded = panes.filter(pane => pane.media).length;
  const ready = Boolean(state.rows) && loaded === state.rows && !panes.some(pane => pane.loading);
  document.querySelectorAll('[data-rows]').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.rows) === state.rows));
    button.disabled = state.busy;
  });
  $('#empty-state').hidden = Boolean(state.rows);
  $('#story').hidden = !state.rows;
  $('#export-button').disabled = !ready || state.busy || (videos.length > 0 && mp4Supported !== true);
  $('#export-button span').textContent = state.busy ? 'Exporting your story…' : 'Export your story';
  $('#preview-status').textContent = state.busy ? 'EXPORTING' : videos.length ? 'LIVE PREVIEW' : '';
  $('#preview-status').classList.toggle('is-live', videos.length > 0 && !state.busy);
  $('#compatibility').hidden = !state.rows || mp4Supported !== false;
  $('#compatibility').textContent = 'This browser cannot encode 1080p60 H.264 video with WebCodecs. Photo layouts still export as JPEG. For video export, try current Chrome, Edge, or Safari on a supported device.';

  let hint = 'Choose a layout to get started.';
  if (state.rows) hint = `${loaded} of ${state.rows} frames filled.`;
  if (panes.some(pane => pane.loading)) hint = 'Opening your media…';
  if (ready) hint = videos.length
    ? `Silent MP4 · ${VIDEO_FRAME_RATE} fps · ${formatDuration(duration)} · about ${Math.max(0.1, estimatedSizeMB).toFixed(1)} MB`
    : 'High-quality JPEG';
  if (ready && videos.length && mp4Supported === null) hint = 'Checking 1080p60 encoding support…';
  if (ready && videos.length && mp4Supported === false) hint = '1080p60 MP4 encoding is unavailable on this device.';
  $('#export-hint').textContent = hint;

  paneElements.forEach((element, index) => {
    const pane = state.slots[index];
    const media = pane.media;
    element.classList.toggle('has-media', Boolean(media));
    element.classList.toggle('is-selected', Boolean(media) && state.selected === index && !state.busy);
    element.tabIndex = media ? 0 : -1;
    element.setAttribute('aria-label', `Frame ${index + 1}${media ? `, ${media.kind === 'video' ? 'video' : 'photo'}. Enter for actions; arrow keys to reposition.` : ', empty'}`);
    element.setAttribute('aria-busy', String(pane.loading));
    element.querySelector('.add-media').hidden = Boolean(media) || pane.loading;
    element.querySelector('.pane-loader').hidden = !pane.loading;
    element.querySelector('.pane-actions').hidden = !media || pane.loading || state.busy;
    element.querySelector('.pane-error').hidden = !pane.error;
    element.querySelector('.pane-error p').textContent = pane.error;
    const zoomInput = element.querySelector('.zoom-slider');
    zoomInput.value = pane.zoom;
    zoomInput.setAttribute('aria-valuetext', `${Math.round(pane.zoom * 100)}%`);
    element.querySelector('.zoom-out').disabled = pane.zoom <= MIN_ZOOM;
    element.querySelector('.zoom-in').disabled = pane.zoom >= MAX_ZOOM;
  });
}

function chooseFile(index) {
  if (state.busy || state.slots[index].loading) return;
  fileTarget = index;
  fileInput.value = ''; // Selecting the same file again must fire change.
  fileInput.click();
}

function buildPanes() {
  $('#panes').replaceChildren();
  $('#panes').style.gridTemplateRows = `repeat(${state.rows}, minmax(0, 1fr))`;
  paneElements = visiblePanes().map((_, index) => {
    const paneElement = document.createElement('div');
    paneElement.className = 'pane';
    paneElement.setAttribute('role', 'group');
    paneElement.innerHTML = `<button class="add-media" aria-label="Add photo or video to frame ${index + 1}"><span class="add-circle">${icon('plus')}</span></button>
      <div class="pane-actions" hidden>
        <div class="media-buttons"><button class="replace-media" aria-label="Replace media in frame ${index + 1}" title="Replace">${icon('replace')}</button><button class="remove-media" aria-label="Remove media from frame ${index + 1}" title="Remove">${icon('trash')}</button></div>
        <div class="zoom-controls" role="group" aria-label="Zoom controls for frame ${index + 1}"><button class="zoom-out" aria-label="Zoom out frame ${index + 1}" title="Zoom out">${icon('minus')}</button><input class="zoom-slider" type="range" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.05" value="1" aria-label="Zoom media in frame ${index + 1}"><button class="zoom-in" aria-label="Zoom in frame ${index + 1}" title="Zoom in">${icon('plus')}</button></div>
      </div>
      <div class="pane-loader" role="status" aria-label="Loading media" hidden><span class="spinner"></span></div>
      <div class="pane-error" role="alert" hidden><p></p><button aria-label="Dismiss error in frame ${index + 1}">${icon('close')}</button></div>`;
    paneElement.querySelector('.add-media').addEventListener('click', () => chooseFile(index));
    paneElement.querySelector('.replace-media').addEventListener('click', () => chooseFile(index));
    paneElement.querySelector('.remove-media').addEventListener('click', () => removeMedia(index));
    paneElement.querySelector('.zoom-slider').addEventListener('input', event => setZoom(index, Number(event.target.value)));
    paneElement.querySelector('.zoom-out').addEventListener('click', () => setZoom(index, state.slots[index].zoom - 0.1));
    paneElement.querySelector('.zoom-in').addEventListener('click', () => setZoom(index, state.slots[index].zoom + 0.1));
    paneElement.querySelector('.pane-error button').addEventListener('click', () => { state.slots[index].error = ''; updateUI(); });
    attachDrag(paneElement, index);
    paneElement.addEventListener('keydown', event => {
      if (event.target !== paneElement || state.busy) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        state.selected = state.selected === index ? null : index;
        updateUI();
      } else if (event.key === 'Escape') {
        state.selected = null;
        updateUI();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const pane = state.slots[index];
        if (!pane.media) return;
        const rect = paneElement.getBoundingClientRect();
        const step = event.shiftKey ? 30 : 10;
        const deltaX = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const deltaY = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        pane.position = movePosition(pane.media, pane.position, deltaX, deltaY, rect.width, rect.height, pane.zoom);
      }
    });
    $('#panes').append(paneElement);
    return paneElement;
  });
}

function setZoom(index, value) {
  const pane = state.slots[index];
  if (state.busy || pane.loading || !pane.media) return;
  const zoom = clamp(Math.round(value * 100) / 100, MIN_ZOOM, MAX_ZOOM);
  const rect = paneElements[index].getBoundingClientRect();
  pane.position = zoomPosition(pane.media, pane.position, pane.zoom, zoom, rect.width, rect.height);
  pane.zoom = zoom;
  updateUI();
}

function attachDrag(element, index) {
  let drag;
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, input') || state.busy) return;
    const pane = state.slots[index];
    if (!pane.media || pane.loading || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, position: { ...pane.position }, moved: false };
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.hypot(deltaX, deltaY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const pane = state.slots[index];
    const rect = element.getBoundingClientRect();
    pane.position = movePosition(pane.media, drag.position, deltaX, deltaY, rect.width, rect.height, pane.zoom);
    element.classList.add('dragging');
  });
  const end = event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.type === 'pointerup') {
      state.selected = drag.moved ? index : state.selected === index ? null : index;
      element.focus({ preventScroll: true });
    }
    drag = null;
    element.classList.remove('dragging');
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    updateUI();
  };
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('lostpointercapture', end);
}

function stopPreview() {
  previewController?.abort();
  previewRunning = false;
  previewRestarting = false;
  state.slots.forEach(pane => { if (pane.media?.kind === 'video') pane.media.element.pause(); });
}

async function restartPreview() {
  // A hidden pane can finish loading while an export is running. Never pause
  // the export's video elements in response to that background load.
  if (state.busy) return;
  stopPreview();
  const videos = visibleVideos();
  $('#resume-button').hidden = true;
  if (!videos.length || state.busy || document.hidden) return;
  const controller = new AbortController();
  previewController = controller;
  previewRestarting = true;
  try {
    await Promise.all(videos.map(media => seekVideo(media.element, 0, controller.signal)));
    await Promise.all(videos.map(media => playVideo(media.element, controller.signal)));
    if (controller.signal.aborted) return;
    previewRunning = true;
  } catch {
    if (!controller.signal.aborted) {
      videos.forEach(media => media.element.pause());
      $('#resume-button').hidden = false;
      announce('Video playback needs a tap. Use the resume preview button.');
    }
  } finally {
    if (previewController === controller) previewRestarting = false;
  }
}

function removeMedia(index) {
  if (state.busy) return;
  const pane = state.slots[index];
  pane.controller?.abort();
  disposeMedia(pane.media);
  Object.assign(pane, { media: null, loading: false, error: '', position: { x: 0.5, y: 0.5 }, zoom: MIN_ZOOM });
  state.selected = null;
  updateUI();
  restartPreview();
  paneElements[index].querySelector('.add-media').focus({ preventScroll: true });
  announce(`Frame ${index + 1} cleared.`);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  const index = fileTarget;
  if (!file || index === null || state.busy) return;
  const pane = state.slots[index];
  pane.controller?.abort();
  const controller = new AbortController();
  pane.controller = controller;
  pane.loading = true;
  pane.error = '';
  updateUI();
  try {
    const media = await loadMedia(file, $('#media-pool'), controller.signal);
    if (controller.signal.aborted) { disposeMedia(media); return; }
    if (index < state.rows && !state.busy) stopPreview();
    disposeMedia(pane.media);
    pane.media = media;
    pane.position = { x: 0.5, y: 0.5 };
    pane.zoom = MIN_ZOOM;
    state.selected = null;
    announce(`${media.kind === 'video' ? 'Video' : 'Photo'} added to frame ${index + 1}. Drag it to adjust the framing.`);
  } catch (error) {
    if (!controller.signal.aborted) pane.error = error.message;
  } finally {
    if (pane.controller === controller) {
      pane.loading = false;
      updateUI();
      restartPreview();
    }
    fileInput.value = '';
  }
});

document.querySelectorAll('[data-rows]').forEach(button => button.addEventListener('click', () => {
  if (state.busy || state.rows === Number(button.dataset.rows)) return;
  stopPreview();
  state.rows = Number(button.dataset.rows);
  state.selected = null;
  buildPanes();
  updateUI();
  restartPreview();
  announce(`${state.rows}-row layout selected. Add media to each frame.`);
}));

// The same renderer draws a smaller preview and the full-resolution export.
function previewFrame() {
  // Use the display refresh rate for preview. During export the paused source
  // elements belong to the frame encoder; avoid drawing a redundant preview.
  if (state.rows && !document.hidden && !state.busy) {
    if (previewRunning && !previewRestarting && !state.busy) {
      const videos = visibleVideos();
      const master = videos.reduce((shortest, media) => !shortest || media.duration < shortest.duration ? media : shortest, null);
      if (master?.element.ended || (master && master.element.currentTime >= master.duration - 1 / 120)) restartPreview();
      else if (master) videos.forEach(media => {
        if (media !== master && !media.element.seeking && Math.abs(media.element.currentTime - master.element.currentTime) > 0.2) {
          media.element.currentTime = master.element.currentTime;
        }
      });
    }
    drawStory(previewContext, visiblePanes(), previewCanvas.width, previewCanvas.height);
  }
  requestAnimationFrame(previewFrame);
}
requestAnimationFrame(previewFrame);
$('#resume-button').addEventListener('click', restartPreview);

function resetDialog() {
  if (outputUrl) { URL.revokeObjectURL(outputUrl); outputUrl = null; }
  $('#download-button').hidden = true;
  $('#download-button').removeAttribute('href');
  $('#retry-button').hidden = true;
  $('#progress-area').hidden = false;
  $('#dialog-symbol').innerHTML = '<span class="spinner"></span>';
  $('#dialog-detail').textContent = '';
  $('#dialog-close').textContent = 'Cancel export';
  $('#dialog-note').textContent = 'Keep this app open until your export is ready.';
  $('#dialog-note').hidden = false;
  $('#export-progress').removeAttribute('value');
  $('#progress-label').textContent = 'Preparing';
  $('#progress-value').textContent = '';
  if (!dialog.open) dialog.showModal();
}

function showProgress({ phase, progress, frames, frameCount }) {
  if (phase === 'encoding') {
    $('#dialog-detail').textContent = `Encoding ${frames} of ${frameCount} frames at ${VIDEO_FRAME_RATE} fps.`;
    $('#export-progress').value = progress;
    $('#progress-label').textContent = 'Encoding';
    $('#progress-value').textContent = `${Math.floor(progress)}%`;
  } else if (phase === 'finalizing') {
    $('#dialog-detail').textContent = 'Finishing your MP4 file…';
    $('#export-progress').removeAttribute('value');
    $('#progress-label').textContent = 'Finalizing';
    $('#progress-value').textContent = '';
  }
}

async function startExport() {
  if (state.busy || $('#export-button').disabled) return;
  const panes = visiblePanes();
  const isVideo = visibleVideos().length > 0;
  state.busy = true;
  state.selected = null;
  stopPreview();
  updateUI();
  resetDialog();
  exportController = new AbortController();
  const { signal } = exportController;
  let wakeLock;
  try {
    // Optional: prevent a phone from sleeping during export.
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Not required. */ }
    signal.throwIfAborted();
    const blob = isVideo
      ? await exportVideo(panes, { signal, onProgress: showProgress })
      : await exportPhoto(panes, signal);
    signal.throwIfAborted();
    outputUrl = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    $('#download-button').href = outputUrl;
    $('#download-button').download = `stackr-${timestamp}.${isVideo ? 'mp4' : 'jpg'}`;
    $('#download-button').hidden = false;
    $('#dialog-symbol').innerHTML = icon('check');
    $('#dialog-detail').textContent = `${isVideo ? `MP4 · ${VIDEO_FRAME_RATE} fps · silent` : 'JPEG'} · 1080 × 1920 · ${(blob.size / 1_000_000).toFixed(1)} MB`;
    $('#export-progress').value = 100;
    $('#progress-label').textContent = 'Complete';
    $('#progress-value').textContent = '100%';
    $('#dialog-note').hidden = true;
    $('#dialog-close').textContent = 'Back to editing';
    announce('Your story is ready to download.');
    $('#download-button').focus();
  } catch (error) {
    if (error.name === 'AbortError') {
      dialog.close();
      toast('Export canceled. Your layout is still here.');
    } else {
      $('#dialog-symbol').innerHTML = icon('close');
      $('#dialog-detail').textContent = error.message || 'The export could not finish. Your layout is still here.';
      $('#progress-area').hidden = true;
      $('#dialog-note').textContent = 'Your media and framing have been kept.';
      $('#dialog-close').textContent = 'Back to editing';
      $('#retry-button').hidden = false;
      announce('Export could not finish. Your layout is safe.');
    }
  } finally {
    state.busy = false;
    exportController = null;
    updateUI();
    restartPreview();
    if (wakeLock) wakeLock.release().catch(() => {});
  }
}

$('#export-button').addEventListener('click', startExport);
$('#retry-button').addEventListener('click', startExport);
$('#dialog-close').addEventListener('click', () => {
  if (state.busy) exportController?.abort(new DOMException('Export canceled', 'AbortError'));
  else dialog.close();
});
dialog.addEventListener('cancel', event => {
  if (state.busy) {
    event.preventDefault();
    exportController?.abort(new DOMException('Export canceled', 'AbortError'));
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.busy) exportController?.abort(new Error('Export stopped because the app moved into the background. Keep it open and try again.'));
    else stopPreview();
  } else if (!state.busy) restartPreview();
});
window.addEventListener('pagehide', () => {
  exportController?.abort(new DOMException('Page closed', 'AbortError'));
  stopPreview();
  // Keep media intact if the browser is placing this page in its back/forward cache.
});
window.addEventListener('pageshow', () => { if (state.rows && !state.busy) restartPreview(); });

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstall = event;
  $('#install-button').hidden = false;
});
$('#install-button').addEventListener('click', async () => {
  if (!deferredInstall) return;
  await deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('#install-button').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install-button').hidden = true; });

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      toast('Offline setup was unavailable. You can still use the app while this page is open.');
    });
  });
}
getVideoExportConfig().then(config => {
  mp4Supported = Boolean(config);
  updateUI();
});
updateUI();
