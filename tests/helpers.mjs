import {chromium} from 'playwright-core';
import {execFileSync} from 'node:child_process';
export const base=process.env.TEST_URL||'http://127.0.0.1:18082';
export const compose=['compose','-f','compose.test.yaml','-p','mesa-ti-tests'];
export async function ensureIsolated(){
  const url=new URL(base);
  if(url.hostname!=='127.0.0.1'||url.port!=='18082'||url.pathname!=='/')throw new Error('Las pruebas sólo pueden usar 127.0.0.1:18082');
  const response=await fetch(base+'/api/test-info');
  if(!response.ok||(await response.json()).isolated!==true)throw new Error('El servicio no confirmó una base de pruebas aislada');
  process.env.ADMIN_USER='test-admin';process.env.ADMIN_PASSWORD='Only-for-isolated-tests-2026!';
}
export const launchBrowser=()=>chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
export function dockerExec(...args){
  const command=[...compose,'exec','-T',...args];
  try{return execFileSync('docker',command,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
  catch(error){
    // Docker Desktop occasionally fails to discover the Compose plugin on Windows.
    // This parse error occurs before any container command runs; only that case is retried.
    if(error.status!==125||!String(error.stderr).includes("unknown shorthand flag: 'f'"))throw error;
    execFileSync('docker',['compose','version'],{stdio:'ignore'});
    return execFileSync('docker',command,{encoding:'utf8'});
  }
}
