import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../src/',import.meta.url)));
const bridge=fileURLToPath(new URL('./ui-preview-bridge.js',import.meta.url));
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.wav':'audio/wav'};
const demo='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#12151c;color:#edf0f8;font:16px system-ui;display:grid;place-items:center;min-height:100vh}main{text-align:center;border:1px solid #343b4c;border-radius:14px;padding:40px}small{color:#a2adbf}h1{font-size:26px}output{display:block;font-size:64px;padding:20px}button{font:inherit;background:#292f3d;border:1px solid #4b566c;color:inherit;border-radius:8px;padding:10px 20px;margin:5px}</style></head><body><main><small>Sample preview</small><h1>Counter app</h1><output id="count">0</output><button onclick="count.textContent=Number(count.textContent)-1">−</button><button onclick="count.textContent=0">Reset</button><button onclick="count.textContent=Number(count.textContent)+1">+</button></main></body></html>';
export function createPreviewServer(){
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      let content,type;
      if(pathname==='/demo'){content=demo;type='text/html';}
      else if(pathname==='/preview-bridge.js'){content=await readFile(bridge);type='application/javascript';}
      else{
        const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
        if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
        type=types[path.extname(file)];if(!type){res.writeHead(404).end();return;}
        const resolved=await realpath(file);if(!resolved.startsWith(root+path.sep)){res.writeHead(403).end();return;}
        content=await readFile(resolved);
        if(file===path.join(root,'index.html'))content=content.toString()
          // Browser annotation tools inject their UI stylesheet. Keep scripts
          // restricted; relax styles only in this loopback sample workbench.
          .replace("style-src 'self';","style-src 'self' 'unsafe-inline';")
          .replace('<script type="module" src="renderer.js">','<script src="/preview-bridge.js"></script><script type="module" src="renderer.js">');
      }
      res.setHeader('Content-Type',type+'; charset=utf-8');res.end(req.method==='HEAD'?undefined:content);
    }catch{res.writeHead(404).end();}
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const requested=process.argv.indexOf('--port'),port=requested<0?4173:Number(process.argv[requested+1]);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Choose a valid local port.');
  const server=createPreviewServer();server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Mora UI preview: http://127.0.0.1:${server.address().port} — sample data, no engine or filesystem access`));
}
