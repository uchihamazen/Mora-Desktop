import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/video-frames.js';

test('video preflight refuses invalid byte sizes',()=>{
 for(const size of [-1,NaN,Infinity,'100'])assert.match(api.videoFileError({mediaType:'video/mp4',size}),/size/i);
});

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

test('media preflight bounds combined input bytes and resulting frame count before reading files',()=>{
 assert.throws(()=>api.validateMediaSelection([{name:'a.mp4',size:60*1024*1024},{name:'b.mov',size:60*1024*1024}]),/100 MB/);
 assert.throws(()=>api.validateMediaSelection([{name:'a.webm',size:100}],{imageCount:13}),/20/);
 assert.throws(()=>api.validateMediaSelection([{name:'a.png',size:10*1024*1024}],{imageBytes:15*1024*1024}),/20 MB/);
 const picked=api.validateMediaSelection([{name:'clip.MP4',size:100},{name:'a.png',size:100}]);
 assert.equal(picked[0].mediaType,'video/mp4');assert.equal(picked[1].mediaType,'image/png');
 assert.throws(()=>api.validateMediaSelection([{name:'a.avi',size:1}]),/PNG|MP4/);
});
