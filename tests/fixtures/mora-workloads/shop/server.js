import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const files = new Set(['index.html','app.js','catalog.js','basket.js','delivery.js','checkout.js']);
const server = createServer(async (request,response) => {
  try {
    const name = new URL(request.url,'http://localhost').pathname.slice(1) || 'index.html';
    if(!files.has(name)){response.writeHead(404).end();return;}
    response.setHeader('content-type',name.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(await readFile(path.join(process.cwd(),name)));
  } catch {response.writeHead(500).end();}
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
