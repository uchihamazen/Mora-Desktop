export function nextCount(value) {
  if(!Number.isInteger(value) || value<0)throw new Error('Use a non-negative whole number.');
  return value+1;
}
if(typeof document!=='undefined') {
  let count=0;
  document.querySelector('#add').addEventListener('click',()=>{
    count=nextCount(count);document.querySelector('#count').textContent=String(count);
  });
}
