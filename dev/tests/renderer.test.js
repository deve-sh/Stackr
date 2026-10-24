import test from 'node:test';
import assert from 'node:assert/strict';
import { cropRect, movePosition, zoomPosition, shortestDuration, drawStory } from '../../js/renderer.js';

test('a wide photo fills a portrait pane without distortion', () => {
  const crop = cropRect(1920, 1080, 1080, 960, { x: 0.5, y: 0.5 });
  assert.equal(crop.height, 1080);
  assert.equal(crop.width, 1215);
  assert.equal(crop.x, 352.5);
  assert.equal(crop.y, 0);
});

test('a tall video fills a three-row pane and can be framed vertically', () => {
  const crop = cropRect(1080, 1920, 1080, 640, { x: 0.5, y: 1 });
  assert.deepEqual(crop, { x: 0, y: 1280, width: 1080, height: 640 });
});

test('preview and export select the same source crop', () => {
  const position = { x: 0.23, y: 0.77 };
  assert.deepEqual(cropRect(1920, 1080, 540, 320, position), cropRect(1920, 1080, 1080, 640, position));
});

test('dragging beyond any boundary never reveals empty space', () => {
  for (const media of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1000, height: 1000 }]) {
    for (const delta of [-100000, 100000]) {
      const position = movePosition(media, { x: 0.5, y: 0.5 }, delta, delta, 250, 250 * 16 / 27);
      const crop = cropRect(media.width, media.height, 1080, 640, position);
      assert.ok(crop.x >= 0 && crop.y >= 0);
      assert.ok(crop.x + crop.width <= media.width + 0.001);
      assert.ok(crop.y + crop.height <= media.height + 0.001);
    }
  }
});

test('drag direction follows the picture and does not move an axis with no overflow', () => {
  const moved = movePosition({ width: 1080, height: 1920 }, { x: 0.5, y: 0.5 }, 100, 100, 270, 160);
  assert.equal(moved.x, 0.5);
  assert.ok(moved.y < 0.5);
});

test('zoom crops around the same subject in preview and export', () => {
  const media = { width: 2000, height: 1000 };
  const beforePosition = { x: 0.2, y: 0.7 };
  const position = zoomPosition(media, beforePosition, 1, 2, 500, 500);
  const before = cropRect(2000, 1000, 500, 500, beforePosition, 1);
  const after = cropRect(2000, 1000, 500, 500, position, 2);
  assert.equal(after.width, before.width / 2);
  assert.equal(after.height, before.height / 2);
  assert.equal(after.x + after.width / 2, before.x + before.width / 2);
  assert.equal(after.y + after.height / 2, before.y + before.height / 2);
  assert.deepEqual(after, cropRect(2000, 1000, 1000, 1000, position, 2));
});

test('dragging at every zoom level stays inside the source image', () => {
  for (const zoom of [1, 1.5, 3]) {
    for (const media of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 800, height: 800 }]) {
      for (const delta of [-100000, 100000]) {
        const position = movePosition(media, { x: 0.5, y: 0.5 }, delta, delta, 270, 160, zoom);
        const crop = cropRect(media.width, media.height, 1080, 640, position, zoom);
        assert.ok(crop.x >= 0 && crop.y >= 0);
        assert.ok(crop.x + crop.width <= media.width + 0.001);
        assert.ok(crop.y + crop.height <= media.height + 0.001);
      }
    }
  }
});

test('zooming back out near an edge clamps the crop and restores fill size', () => {
  const media = { width: 1080, height: 1920 };
  const position = zoomPosition(media, { x: 0, y: 0 }, 3, 1, 1080, 640);
  assert.deepEqual(cropRect(1080, 1920, 1080, 640, position, 1), { x: 0, y: 0, width: 1080, height: 640 });
});

test('zoom limits prevent black edges or excessive scaling', () => {
  const position = { x: 0.5, y: 0.5 };
  assert.deepEqual(cropRect(1920, 1080, 1080, 640, position, 0.1), cropRect(1920, 1080, 1080, 640, position, 1));
  assert.deepEqual(cropRect(1920, 1080, 1080, 640, position, 20), cropRect(1920, 1080, 1080, 640, position, 3));
});

test('shortest video determines length; still images and empty panes do not', () => {
  const panes = [{ media: { kind: 'video', duration: 20 } }, { media: { kind: 'video', duration: 10 } }, { media: { kind: 'video', duration: 15 } }];
  assert.equal(shortestDuration(panes), 10);
  assert.equal(shortestDuration([{ media: { kind: 'image' } }, panes[1], { media: null }]), 10);
  assert.equal(shortestDuration([{ media: { kind: 'image' } }]), null);
});

test('hidden third row does not affect the two-row duration', () => {
  const slots = [15, 20, 10].map(duration => ({ media: { kind: 'video', duration } }));
  assert.equal(shortestDuration(slots.slice(0, 2)), 15);
  assert.equal(shortestDuration(slots), 10);
});

test('renderer covers the canvas and places panes without exported dividers or controls', () => {
  const calls = [];
  const context = { fillRect: (...args) => calls.push(['fill', ...args]), save() {}, beginPath() {}, rect() {}, clip() {}, restore() {}, drawImage: (...args) => calls.push(['draw', ...args]) };
  const element = {};
  const panes = Array.from({ length: 3 }, () => ({ media: { kind: 'image', width: 100, height: 100, element }, position: { x: 0.5, y: 0.5 } }));
  drawStory(context, panes, 1080, 1920);
  assert.deepEqual(calls[0], ['fill', 0, 0, 1080, 1920]);
  assert.deepEqual(calls.slice(1).map(call => call.slice(-4)), [[0, 0, 1080, 640], [0, 640, 1080, 640], [0, 1280, 1080, 640]]);
});
