import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/video-frames.js').catch(() => ({}));

test('video validation accepts supported files at the limits and rejects the rest', () => {
  assert.equal(typeof api.videoFileError, 'function');
  assert.equal(api.videoFileError({ mediaType: 'video/mp4', size: 100 * 1024 * 1024, durationSeconds: 600 }), null);
  assert.equal(api.videoFileError({ mediaType: 'video/quicktime', size: 10 }), null);
  assert.equal(api.videoFileError({ mediaType: 'video/webm', size: 10 }), null);
  assert.equal(api.videoFileError({ mediaType: 'video/avi', size: 10 }), 'Attach an MP4, MOV, or WebM video.');
  assert.equal(api.videoFileError({ mediaType: 'text/plain', size: 10 }), 'Attach an MP4, MOV, or WebM video.');
  assert.equal(api.videoFileError({}), 'Attach an MP4, MOV, or WebM video.');
  assert.equal(api.videoFileError({ mediaType: 'video/mp4', size: 100 * 1024 * 1024 + 1 }), 'Keep videos to 100 MB.');
  assert.equal(api.videoFileError({ mediaType: 'video/mp4', size: 10, durationSeconds: 601 }), 'Keep videos to 10 minutes.');
  assert.equal(api.videoFileError({ mediaType: 'video/mp4', size: 10, durationSeconds: 0 }), 'This video has no playable duration.');
  assert.equal(api.videoFileError({ mediaType: 'video/mp4', size: 10, durationSeconds: NaN }), 'This video has no playable duration.');
});

test('frame timestamps spread evenly inside the duration', () => {
  assert.equal(typeof api.frameTimes, 'function');
  assert.deepEqual(api.frameTimes(80), [5, 15, 25, 35, 45, 55, 65, 75]);
  assert.deepEqual(api.frameTimes(80, 4), [10, 30, 50, 70]);
  assert.deepEqual(api.frameTimes(0), []);
  assert.deepEqual(api.frameTimes(NaN), []);
  assert.deepEqual(api.frameTimes(-3), []);
  assert.deepEqual(api.frameTimes(Infinity), []);
});
