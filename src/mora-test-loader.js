import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Candidate source stays isolated; installed dependencies are read from the project.
const dependencyRoot=process.env.MORA_MODE_DEPENDENCY_ROOT;
if(dependencyRoot)registerHooks({resolve(specifier,context,nextResolve){
  try{return nextResolve(specifier,context);}catch(error){
    if(!['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code)||specifier.startsWith('.')||specifier.startsWith('/')||specifier.includes(':'))throw error;
    return nextResolve(specifier,{...context,parentURL:pathToFileURL(path.join(dependencyRoot,'package.json')).href});
  }
}});
