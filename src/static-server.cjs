const {createServer}=require('node:http');
const {readFile,lstat}=require('node:fs/promises');
const path=require('node:path');
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};
async function serveStatic(root) {
 const {projectFile}=await import('./project.js'),{checkpointSource}=await import('./checkpoints.js');
 await projectFile(root,'index.html');
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
  try{
   let name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/,'')||'index.html';
   if(name.includes('\\'))return res.writeHead(404).end();
   if(!checkpointSource(name)||name.split('/').some(part=>part.startsWith('.'))||/^AGENTS(?:\.override)?\.md$/i.test(path.basename(name)))return res.writeHead(404).end();
   let file=await projectFile(root,name);if((await lstat(file)).isDirectory()){name=path.join(name,'index.html');file=await projectFile(root,name);}
   const info=await lstat(file);if(!info.isFile()||info.size>16*1024*1024)return res.writeHead(404).end();
   const type=types[path.extname(file).toLowerCase()];if(!type)return res.writeHead(404).end();
   const data=await readFile(file);res.setHeader('Content-Type',type);res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404).end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return server;
}
module.exports={serveStatic};
if(require.main===module)serveStatic(process.cwd()).then(server=>console.log('http://127.0.0.1:'+server.address().port+'/')).catch(error=>{console.error(error.message);process.exitCode=1;});
