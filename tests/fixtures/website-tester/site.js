import {createServer} from 'node:http';

export async function startWebsiteFixture({faulty=false}={}) {
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url.startsWith('/settings'))return res.end('<!doctype html><html lang="en"><head><title>Settings</title></head><body><main><h1>Settings</h1><p>Enabling updates checks the Updates option.</p><label><input type="checkbox">Updates</label><a href="/">Catalog</a></main></body></html>');
    res.end(`<!doctype html><html lang="en"><head><title>Catalog</title><style>body{font:18px sans-serif;color:#111;background:white}label,output{display:block;margin:12px}dialog{color:#111;background:white}</style></head><body><main><h1>Catalog</h1>
      <p>Searching for Tea shows Tea. Latest search wins after Search ready appears. Changing quantity to 2 shows Total: 20. Cancel closes Details without saving.</p>
      <a href="/settings">Settings</a><a href="/?page=2">Next page</a>
      <label>Search<input id="search" type="search"></label><output id="search-state" role="status" aria-label="Search status">Search ready</output><output id="results" aria-label="Search results">No search yet</output>
      <label>Quantity<input id="quantity" type="number" required min="1" max="5" value="1"></label><output id="total" aria-label="Order total">Total: 10</output>
      <button id="details">Details</button><dialog aria-label="Details"><h2>Details</h2><p>No changes saved.</p><button id="cancel">Cancel</button></dialog>
      ${faulty?'<input id="unlabelled">':''}
      <script>
      let latest=0,pending=0;const search=document.querySelector('#search'),results=document.querySelector('#results'),status=document.querySelector('#search-state');
      search.oninput=()=>{const text=search.value,id=++latest;pending++;status.textContent='Searching';setTimeout(()=>{if(${faulty?'true':'id===latest'})results.textContent=['Tea','Coffee','شاي'].filter(s=>s.toLowerCase().includes(text.toLowerCase())).join(', ')||'No matching results';if(--pending===0)status.textContent='Search ready'},text==='Tea'?600:20)};
      document.querySelector('#quantity').oninput=event=>document.querySelector('#total').textContent='Total: '+Number(event.target.value)*${faulty?11:10};
      document.querySelector('#details').onclick=()=>document.querySelector('dialog').showModal();document.querySelector('#cancel').onclick=()=>document.querySelector('dialog').close();
      </script></main></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};
}
