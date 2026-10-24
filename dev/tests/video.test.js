import test from 'node:test';
import assert from 'node:assert/strict';
import { videoTimeline, frameTiming } from '../../js/video-timing.js';
import { Mp4Writer } from '../../js/mp4.js';

test('a ten-second export contains all 600 frame intervals with no timing drift', () => {
  const { durationUs, frameCount } = videoTimeline(10);
  assert.equal(frameCount, 600);
  let expectedTime = 0;
  for (let index = 0; index < frameCount; index++) {
    const frame = frameTiming(index, durationUs);
    assert.equal(frame.timestamp, expectedTime);
    assert.ok(frame.duration > 0);
    expectedTime += frame.duration;
  }
  assert.equal(expectedTime, 10_000_000);
});

test('fractional durations end at the shortest video, without an extra empty frame', () => {
  for (const duration of [1 / 60, 0.016667, 0.033333, 1.001, 1.016667, 3.999, 10.123456]) {
    const { durationUs, frameCount } = videoTimeline(duration);
    let end = 0;
    for (let index = 0; index < frameCount; index++) {
      const frame = frameTiming(index, durationUs);
      assert.ok(frame.duration > 0);
      assert.equal(frame.timestamp, end);
      end += frame.duration;
    }
    assert.equal(end, durationUs);
  }
  assert.equal(videoTimeline(0.016667).frameCount, 1);
});

test('unusable durations are rejected', () => {
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => videoTimeline(duration));
});

function sample(writer, index, { timestamp, duration }, key = index === 0) {
  const bytes = new Uint8Array([0, 0, 0, 2, 0x65, index]);
  writer.addChunk({ byteLength: bytes.length, timestamp, type: key ? 'key' : 'delta', copyTo: target => target.set(bytes) },
    index === 0 ? { decoderConfig: {
      description: new Uint8Array([1, 100, 0, 42]),
      colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: false },
    } } : {}, duration);
}

function boxes(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  for (let offset = start; offset < end;) {
    const size = view.getUint32(offset);
    assert.ok(size >= 8 && offset + size <= end);
    result.push({ type: new TextDecoder().decode(bytes.slice(offset + 4, offset + 8)), start: offset, end: offset + size });
    offset += size;
  }
  return result;
}

test('MP4 metadata precedes data and its chunk offset points at the encoded bytes', async () => {
  const writer = new Mp4Writer(1080, 1920);
  const timeline = videoTimeline(0.05);
  for (let index = 0; index < timeline.frameCount; index++) sample(writer, index, frameTiming(index, timeline.durationUs));
  const blob = writer.finish(3, timeline.durationUs);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const root = boxes(bytes);
  assert.deepEqual(root.map(box => box.type), ['ftyp', 'moov', 'mdat']);
  let children = boxes(bytes, root[1].start + 8, root[1].end);
  for (const type of ['trak', 'mdia', 'minf', 'stbl']) {
    const box = children.find(box => box.type === type);
    assert.ok(box, type);
    children = boxes(bytes, box.start + 8, box.end);
  }
  const offsets = children.find(box => box.type === 'stco');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(offsets.start + 16), root[2].start + 8);
  const sizes = children.find(box => box.type === 'stsz');
  assert.equal(view.getUint32(sizes.start + 16), 3);
  const timing = children.find(box => box.type === 'stts');
  let totalTime = 0;
  const entries = view.getUint32(timing.start + 12);
  for (let i = 0; i < entries; i++) totalTime += view.getUint32(timing.start + 16 + i * 8) * view.getUint32(timing.start + 20 + i * 8);
  assert.equal(totalTime, 50000);
  assert.equal(blob.type, 'video/mp4');
  writer.clear();
  assert.equal(writer.samples.length, 0);
});

test('missing or duplicated encoded frames cannot be saved as a completed export', () => {
  const writer = new Mp4Writer(1080, 1920);
  sample(writer, 0, { timestamp: 0, duration: 16667 });
  assert.throws(() => writer.finish(2, 33333), /every frame/);
  sample(writer, 1, { timestamp: 0, duration: 16666 });
  assert.throws(() => writer.finish(2, 33333), /duplicated frame/);
});

test('MP4 preserves encoder color metadata so players use the correct matrix and range', async () => {
  const writer = new Mp4Writer(1080, 1920);
  sample(writer, 0, { timestamp: 0, duration: 16667 });
  const bytes = new Uint8Array(await writer.finish(1, 16667).arrayBuffer());
  const label = new TextEncoder().encode('colr');
  const index = bytes.findIndex((_, i) => label.every((value, j) => bytes[i + j] === value));
  assert.ok(index > 0);
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(index + 4, index + 8)), 'nclx');
  assert.equal(view.getUint16(index + 8), 1); // BT.709 primaries
  assert.equal(view.getUint16(index + 10), 13); // sRGB transfer
  assert.equal(view.getUint16(index + 12), 1); // BT.709 matrix
  assert.equal(bytes[index + 14], 0); // limited-range YUV
});

test('reordered encoder output retains presentation timestamps', async () => {
  const writer = new Mp4Writer(1080, 1920);
  sample(writer, 0, { timestamp: 0, duration: 16667 });
  sample(writer, 1, { timestamp: 33333, duration: 16667 });
  sample(writer, 2, { timestamp: 16667, duration: 16666 });
  const blob = writer.finish(3, 50000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const label = new TextEncoder().encode('ctts');
  const index = bytes.findIndex((_, i) => label.every((value, j) => bytes[i + j] === value));
  assert.ok(index > 0);
  assert.equal(bytes[index + 4], 1); // signed composition offsets
});
