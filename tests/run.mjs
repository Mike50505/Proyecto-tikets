import {spawnSync} from 'node:child_process';
import {compose,ensureIsolated} from './helpers.mjs';
const selected=process.argv.slice(2);
const suites=['e2e','inventory','reports','maintenance','settings','security','plant-plan','public-lookup','pending'];
if(selected.some(suite=>!suites.includes(suite)))throw new Error('Suite desconocida');
function run(binary,args){const result=spawnSync(binary,args,{stdio:'inherit',env:{...process.env,TEST_URL:'http://127.0.0.1:18082',ADMIN_USER:'test-admin',ADMIN_PASSWORD:'Only-for-isolated-tests-2026!'}});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${binary} terminó con código ${result.status}`);}
try{
  run('docker',[...compose,'up','-d','--build','--wait']);
  await ensureIsolated();
  run('docker',[...compose,'exec','-T','api','python','/tests/test_api.py']);
  for(const suite of selected.length?selected:suites)run(process.execPath,[`tests/${suite}.mjs`]);
  run(process.execPath,['tests/restore.mjs']);
  console.log('Todas las comprobaciones solicitadas pasaron en la base temporal.');
}finally{if(!process.env.KEEP_TEST_STACK)run('docker',[...compose,'down']);}
