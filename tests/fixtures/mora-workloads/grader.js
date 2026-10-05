import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Kept outside the worker project: grades outcomes independently of worker claims.
export async function gradeWorkload(project, {dependent = false} = {}) {
  const load = file => import(pathToFileURL(path.join(project,file)).href);
  const catalog = await load('catalog.js'),basket = await load('basket.js'),delivery = await load('delivery.js');
  const results = [];
  const check = (name, body) => {try{body();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}};
  check('accent folding and token/category search', () => {
    assert.deepEqual(catalog.searchProducts('  cafe  DRINKS ').map(p=>p.id),['coffee']);
    assert.deepEqual(catalog.searchProducts('home mug').map(p=>p.id),['mug']);
    assert.deepEqual(catalog.searchProducts('شاي').map(p=>p.id),['tea']);
  });
  check('catalog filters compose and preserve input', () => {
    const before = JSON.stringify(catalog.products);
    assert.deepEqual(catalog.searchProducts('',{category:'drinks',inStock:true,minPrice:100,maxPrice:150}).map(p=>p.id),['coffee']);
    assert.deepEqual(catalog.searchProducts('',{maxPrice:90}).map(p=>p.id),['tea','mug']);
    assert.equal(JSON.stringify(catalog.products),before);
  });
  check('coupon and cent rounding', () => {
    const result = basket.basketSummary([{price:120,quantity:1},{price:85,quantity:1}],{coupon:' save10 '});
    assert.equal(result.subtotal,205);assert.equal(result.discount,20.5);assert.equal(result.total,184.5);assert.equal(result.count,2);
    assert.equal(basket.basketSummary([{price:60,quantity:1}],{coupon:'SAVE10'}).discount,0);
    assert.equal(basket.basketSummary([{price:101.05,quantity:1}],{coupon:'SAVE10'}).discount,10.11);
    assert.equal(basket.basketSummary([{price:120,quantity:1}],{coupon:'unknown'}).discount,0);
  });
  check('basket rejects invalid prices and quantities', () => {
    for(const quantity of [0,-1,1.2,100,NaN])assert.throws(()=>basket.basketSummary([{price:10,quantity}]));
    for(const price of [-1,NaN,Infinity])assert.throws(()=>basket.basketSummary([{price,quantity:1}]));
  });
  check('Egypt delivery regions, free standard and paid express', () => {
    assert.deepEqual(delivery.deliveryEstimate(' alexandria ',{subtotal:200}),{fee:45,days:3});
    assert.deepEqual(delivery.deliveryEstimate(' cairo ',{subtotal:500}),{fee:0,days:2});
    assert.deepEqual(delivery.deliveryEstimate('Cairo',{subtotal:500,express:true}),{fee:65,days:1});
    assert.deepEqual(delivery.deliveryEstimate('Other',{subtotal:200,express:true}),{fee:95,days:4});
    assert.throws(()=>delivery.deliveryEstimate('Cairo',{subtotal:-1}));
    assert.throws(()=>delivery.deliveryEstimate('Cairo',{subtotal:NaN}));
  });
  if(dependent) {
    const {checkout,checkoutReceipt} = await load('checkout.js');
    check('dependent checkout exposes discount and post-discount shipping', () => {
      assert.deepEqual(checkout([{price:120,quantity:1}],'Alexandria',{coupon:'SAVE10'}),{items:1,subtotal:120,discount:12,shipping:45,total:153,days:3});
      const summary=checkout([{price:560,quantity:1}],'Cairo',{coupon:'SAVE10',express:true});
      assert.equal(summary.total,569);assert.equal(summary.shipping,65);
      assert.throws(()=>checkout([{price:120,quantity:0}],'Cairo'));
    });
    check('dependent receipt consumes the new cart and delivery contract', () => {
      assert.equal(typeof checkoutReceipt,'function');
      assert.equal(checkoutReceipt([{price:120,quantity:1}],'Alexandria',{coupon:'SAVE10'}),'Items: 1\nSubtotal: EGP 120.00\nDiscount: EGP 12.00\nDelivery: EGP 45.00\nTotal: EGP 153.00\nETA: 3 days');
      assert.throws(()=>checkoutReceipt([{price:120,quantity:0}],'Cairo'));
    });
  }
  return {passed:results.every(result=>result.passed),checks:results};
}
