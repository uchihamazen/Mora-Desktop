import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/images.js').catch(() => ({}));
const png = size => { const bytes = Buffer.alloc(size); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); return { mediaType: 'image/png', base64Data: bytes.toString('base64') }; };
test('imageLimitsAndSignatures', () => {
  assert.equal(typeof api.validateImages, 'function');
  assert.equal(api.validateImages([png(10 * 1024 * 1024)])[0].type, 'image');
  assert.equal(api.validateImages([png(10 * 1024 * 1024), png(10 * 1024 * 1024)]).length, 2);
  assert.throws(() => api.validateImages([png(10 * 1024 * 1024 + 1)]), /10 MB/);
  assert.throws(() => api.validateImages([png(10 * 1024 * 1024), png(10 * 1024 * 1024), png(8)]), /20 MB/);
  assert.throws(() => api.validateImages([{ mediaType: 'image/png', base64Data: Buffer.from('<svg/>').toString('base64') }]), /format|image/i);
  assert.throws(() => api.validateImages([{ mediaType: 'image/png', base64Data: '!notbase64!' }]), /base64/i);
});
