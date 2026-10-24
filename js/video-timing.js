// Integer microseconds match WebCodecs and avoid cumulative clock drift.
export const VIDEO_FRAME_RATE = 60;
export const VIDEO_BITS_PER_SECOND = 12_000_000;
export const TIME_SCALE = 1_000_000;

export function videoTimeline(duration) {
  const durationUs = Math.round(duration * TIME_SCALE);
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0) throw new Error('The video has no usable duration.');
  // A rounded 1/60 second is 16,667 us; do not add a zero-duration second frame.
  return { durationUs, frameCount: Math.ceil((durationUs - 0.5) * VIDEO_FRAME_RATE / TIME_SCALE) };
}

export function frameTiming(index, durationUs) {
  const timestamp = Math.round(index * TIME_SCALE / VIDEO_FRAME_RATE);
  const end = Math.min(durationUs, Math.round((index + 1) * TIME_SCALE / VIDEO_FRAME_RATE));
  return { timestamp, duration: end - timestamp };
}
