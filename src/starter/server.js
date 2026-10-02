import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const server=createServer(async(req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  const file=route==='/'?'index.html':route==='/src/app.js'?'src/app.js':null;
  if(!file){res.writeHead(404).end('Page not found');return;}
  try {res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(await readFile(new URL(file,import.meta.url)));}
  catch {res.writeHead(500).end('Unable to load this file');}
});
server.listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>console.log(`Your app is ready at http://127.0.0.1:${server.address().port}`));
