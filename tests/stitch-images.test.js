import test from 'node:test';
import assert from 'node:assert/strict';
import {stitchImageParts} from '../src/images.js';

test('Stitch image links retain text, labels and punctuation',()=>{
  const url='https://lh3.googleusercontent.com/aida/design';
  assert.deepEqual(stitchImageParts(`before (${url}) after`),[{type:'text',text:'before '},{type:'image',url,alt:'Stitch design'},{type:'text',text:' after'}]);
  assert.equal(stitchImageParts(`![Card](${url})`)[0].alt,'Card');
  assert.equal(stitchImageParts('[Design](https://lh3.googleusercontent.com/aida-public/design)')[0].type,'image');
  assert.equal(stitchImageParts(`${url}.`)[1].text,'.');
});
test('Only exact Stitch HTTPS image origin is previewed',()=>{
  for(const url of ['http://lh3.googleusercontent.com/aida/design','https://lh3.googleusercontent.com.evil.test/aida/design','https://user@lh3.googleusercontent.com/aida/design','https://lh3.googleusercontent.com:8443/aida/design','https://lh3.googleusercontent.com/other/design'])assert.deepEqual(stitchImageParts(url),[{type:'text',text:url}]);
});
test('Streaming defers a bare partial URL until its end is known',()=>{
  const url='https://lh3.googleusercontent.com/aida/design';
  assert.deepEqual(stitchImageParts(url,true),[{type:'text',text:url}]);
  assert.equal(stitchImageParts(url,false)[0].type,'image');
  assert.equal(stitchImageParts(`(${url})`,true)[0].type,'image');
});
