export const VIDEO_LIMITS = { MAX_VIDEO_BYTES: 100 * 1024 * 1024, MAX_VIDEO_SECONDS: 600, MAX_FRAMES: 8, FRAME_MAX_DIM: 1280, FRAME_QUALITY: 0.85, VIDEO_TYPES: ['video/mp4', 'video/quicktime', 'video/webm'] };

export function videoFileError({ mediaType, size, durationSeconds } = {}) {
  if (!VIDEO_LIMITS.VIDEO_TYPES.includes(mediaType)) return 'Attach an MP4, MOV, or WebM video.';
  if (typeof size === 'number' && size > VIDEO_LIMITS.MAX_VIDEO_BYTES) return 'Keep videos to 100 MB.';
  if (durationSeconds === undefined) return null;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'This video has no playable duration.';
  if (durationSeconds > VIDEO_LIMITS.MAX_VIDEO_SECONDS) return 'Keep videos to 10 minutes.';
  return null;
}

export function frameTimes(durationSeconds, max = VIDEO_LIMITS.MAX_FRAMES) {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const step = durationSeconds / max;
  return Array.from({ length: max }, (_, index) => (index + 0.5) * step);
}
