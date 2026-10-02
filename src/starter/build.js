import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('dist/src/',import.meta.url),{recursive:true});
for(const file of ['index.html','src/app.js'])await copyFile(new URL(file,import.meta.url),new URL('dist/'+file,import.meta.url));
console.log('Built dist/index.html and dist/src/app.js');
