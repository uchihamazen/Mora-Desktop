import test from 'node:test';
import assert from 'node:assert/strict';
import {products,searchProducts} from '../catalog.js';
import {basketSummary} from '../basket.js';
import {deliveryEstimate} from '../delivery.js';
import {checkout} from '../checkout.js';

test('original catalog, cart and delivery behavior stays available', () => {
  assert.equal(products.length,3);
  assert.equal(searchProducts('mug')[0].id,'mug');
  assert.equal(searchProducts('').length,3);
  const lines = [{price:60,quantity:2},{price:85,quantity:1}];
  assert.equal(basketSummary(lines).total,205);
  assert.equal(basketSummary(lines).count,3);
  assert.deepEqual(deliveryEstimate('Cairo'),{fee:35,days:2});
  assert.deepEqual(deliveryEstimate('Other'),{fee:65,days:5});
  assert.equal(checkout([{price:60,quantity:1}],'Cairo').total,95);
});
