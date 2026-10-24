// A small, video-only MP4 writer. WebCodecs supplies H.264 samples and avcC;
// this module supplies their timestamps, sizes, keyframe table and container.
// No video decoding or encoding happens here; no external library is used.
import { TIME_SCALE } from './video-timing.js';

const text = value => new TextEncoder().encode(value);
const zeros = count => new Uint8Array(count);
function u16(...values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value));
  return bytes;
}
function u32(...values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value));
  return bytes;
}
function u64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}
function join(...parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  parts.forEach(part => { bytes.set(part, offset); offset += part.byteLength; });
  return bytes;
}
function box(type, ...parts) {
  const size = 8 + parts.reduce((total, part) => total + part.byteLength, 0);
  if (size > 0xffffffff) throw new Error('This MP4 is too large for an in-memory export.');
  return join(u32(size), text(type), ...parts);
}
const fullBox = (type, version, flags, ...parts) => box(type, u32(version * 0x1000000 + flags), ...parts);
const matrix = () => u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

// Timing tables store consecutive equal values as (count, value) entries.
function runs(values) {
  const entries = [];
  values.forEach(value => {
    const previous = entries.at(-1);
    if (previous?.value === value) previous.count++;
    else entries.push({ count: 1, value });
  });
  return join(u32(entries.length), ...entries.map(entry => u32(entry.count, entry.value)));
}

export class Mp4Writer {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.samples = [];
    this.decoderConfig = null;
    this.colorSpace = null;
    this.byteLength = 0;
  }

  addChunk(chunk, metadata, duration) {
    if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error('An encoded frame has invalid timing.');
    if (metadata?.decoderConfig?.description) {
      const description = metadata.decoderConfig.description;
      const config = ArrayBuffer.isView(description)
        ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
      if (this.decoderConfig && (config.length !== this.decoderConfig.length || config.some((value, i) => value !== this.decoderConfig[i]))) {
        throw new Error('The video encoder changed format during export. Please try again.');
      }
      this.decoderConfig = config.slice();
    }
    if (metadata?.decoderConfig?.colorSpace) this.colorSpace = { ...metadata.decoderConfig.colorSpace };
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    this.samples.push({ bytes, timestamp: chunk.timestamp, duration, key: chunk.type === 'key' });
    this.byteLength += bytes.byteLength;
  }

  makeMovie(duration, dataOffset) {
    const { width, height, samples } = this;
    const movieHeader = fullBox('mvhd', 1, 0,
      u64(0), u64(0), u32(TIME_SCALE), u64(duration), u32(0x10000),
      u16(0x100, 0), zeros(8), matrix(), zeros(24), u32(2));
    const trackHeader = fullBox('tkhd', 1, 7,
      u64(0), u64(0), u32(1, 0), u64(duration), zeros(8), u16(0, 0, 0, 0),
      matrix(), u32(width * 0x10000, height * 0x10000));
    const mediaHeader = fullBox('mdhd', 1, 0,
      u64(0), u64(0), u32(TIME_SCALE), u64(duration), u16(0x55c4, 0)); // 'und' language
    const handler = fullBox('hdlr', 0, 0, u32(0), text('vide'), zeros(12), text('VideoHandler\0'));
    const videoHeader = fullBox('vmhd', 0, 1, u16(0, 0, 0, 0));
    const dataInfo = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
    // Some encoders omit color information from the H.264 stream itself. Keep
    // their reported matrix/range in MP4 so players don't guess BT.601 colors.
    const color = this.colorSpace;
    const primaries = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
    const transfer = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 };
    const matrices = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };
    const colorBox = color ? box('colr', text('nclx'),
      u16(primaries[color.primaries] ?? 2, transfer[color.transfer] ?? 2, matrices[color.matrix] ?? 2),
      new Uint8Array([color.fullRange ? 0x80 : 0])) : zeros(0);
    const sampleEntry = box('avc1', zeros(6), u16(1), zeros(16), u16(width, height),
      u32(0x480000, 0x480000, 0), u16(1), zeros(32), u16(24, 0xffff), box('avcC', this.decoderConfig), colorBox);
    const description = fullBox('stsd', 0, 0, u32(1), sampleEntry);
    const timing = fullBox('stts', 0, 0, runs(samples.map(sample => sample.duration)));
    let decodeTime = 0;
    const compositionOffsets = samples.map(sample => {
      const offset = sample.timestamp - decodeTime;
      decodeTime += sample.duration;
      if (offset < -0x80000000 || offset > 0x7fffffff) throw new Error('The encoder returned unsupported frame timestamps.');
      return offset;
    });
    // Quality-mode encoders can reorder B-frames. Keep their presentation times.
    const composition = compositionOffsets.some(offset => offset !== 0)
      ? fullBox('ctts', 1, 0, runs(compositionOffsets)) : zeros(0);
    const chunkMap = fullBox('stsc', 0, 0, u32(1, 1, samples.length, 1));
    const sizes = fullBox('stsz', 0, 0, u32(0, samples.length), ...samples.map(sample => u32(sample.bytes.byteLength)));
    const offsets = fullBox('stco', 0, 0, u32(1, dataOffset));
    const keys = samples.map((sample, index) => sample.key ? index + 1 : null).filter(index => index !== null);
    const sync = fullBox('stss', 0, 0, u32(keys.length), ...keys.map(index => u32(index)));
    const table = box('stbl', description, timing, composition, chunkMap, sizes, offsets, sync);
    const media = box('mdia', mediaHeader, handler, box('minf', videoHeader, dataInfo, table));
    return box('moov', movieHeader, box('trak', trackHeader, media));
  }

  finish(expectedFrameCount, duration) {
    if (this.samples.length !== expectedFrameCount) throw new Error('The encoder did not return every frame. Export stopped instead of saving an incomplete video.');
    if (!this.decoderConfig || !this.samples[0]?.key) throw new Error('The encoder did not return valid H.264 initialization data.');
    if (this.byteLength + 8 > 0xffffffff) throw new Error('This video is too large for an in-memory export.');
    const sorted = [...this.samples].sort((a, b) => a.timestamp - b.timestamp);
    let expectedTime = 0;
    for (const sample of sorted) {
      if (sample.timestamp !== expectedTime) throw new Error('The encoder returned a missing or duplicated frame timestamp.');
      expectedTime += sample.duration;
    }
    if (expectedTime !== duration) throw new Error('The encoded duration does not match the composition.');
    const type = box('ftyp', text('isom'), u32(512), text('isomiso2avc1mp41'));
    let movie = this.makeMovie(duration, 0);
    // Put moov before mdat for immediate playback, then fill in its chunk offset.
    movie = this.makeMovie(duration, type.byteLength + movie.byteLength + 8);
    return new Blob([type, movie, u32(this.byteLength + 8), text('mdat'), ...this.samples.map(sample => sample.bytes)], { type: 'video/mp4' });
  }

  clear() {
    this.samples.length = 0;
    this.decoderConfig = null;
    this.colorSpace = null;
    this.byteLength = 0;
  }
}
