import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base=process.env.TEST_URL||'http://127.0.0.1:8082';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
const page=await context.newPage(),errors=[],ids=[];
page.on('pageerror',e=>errors.push(e.message));
const login=await context.request.post(`${base}/api/auth/login`,{data:{username:process.env.ADMIN_USER,password:process.env.ADMIN_PASSWORD}});
assert.equal(login.status(),200);const {token}=await login.json();
const headers={Authorization:`Bearer ${token}`};
const req=(method,url,data)=>context.request.fetch(base+url,{method,headers,data});
const prefix=`E2E-REPORT-${Date.now()}`;
try {
  assert.equal((await context.request.get(`${base}/api/reports/tickets`)).status(),401);
  const invalid=await req('POST','/api/tickets',{requester:prefix,area:'Sistemas',subject:'Adjunto inválido',category:'Hardware',priority:'Media',description:'No debe guardar un ticket rechazado',attachments:[{data:'%%%'}]});
  assert.equal(invalid.status(),400);
  assert.equal((await (await req('GET','/api/reports/tickets')).json()).filter(t=>t.requester===prefix).length,0,'Una solicitud rechazada no aparece en el historial');
  for(let i=0;i<27;i++) {
    const response=await req('POST','/api/tickets',{requester:prefix,area:i%2?'Calidad':'Sistemas',subject:i===0?'=1+1':`${prefix} ${i}`,category:i%2?'Software':'Hardware',priority:'Media',description:'Registro temporal de validación de reportes',attachments:i===0?[{name:'evidencia-reportes.txt',type:'text/plain',data:Buffer.from('Evidencia temporal de prueba').toString('base64')}]:[]});
    assert.equal(response.status(),201);const t=await response.json();ids.push(t.id);
  }
  const data=await (await req('GET','/api/tickets')).json();
  const t=data.find(t=>t.id===ids[0]),archive=data.find(t=>t.id===ids[1]);
  let changed=await (await req('PATCH',`/api/admin/tickets/${t.code}`,{status:'Cerrado',assignee:'Técnico de prueba'})).json();
  assert.ok(changed.closed_at);
  const firstClose=changed.closed_at;
  changed=await (await req('PATCH',`/api/admin/tickets/${t.code}`,{priority:'Alta'})).json();
  assert.equal(changed.closed_at,firstClose,'Editar prioridad conserva fecha de cierre');
  const countBefore=(await (await req('GET',`/api/reports/tickets/${t.code}`)).json()).events.length;
  await req('PATCH',`/api/admin/tickets/${t.code}`,{priority:'Alta'});
  assert.equal((await (await req('GET',`/api/reports/tickets/${t.code}`)).json()).events.length,countBefore,'Sin cambios no duplica historial');
  changed=await (await req('PATCH',`/api/admin/tickets/${t.code}`,{status:'En progreso'})).json();
  assert.equal(changed.closed_at,null);
  await req('POST',`/api/admin/tickets/${t.code}/comments`,{body:'Seguimiento después de reabrir'});
  changed=await (await req('PATCH',`/api/admin/tickets/${t.code}`,{status:'Cerrado'})).json();
  assert.ok(changed.closed_at>=firstClose);
  const history=await (await req('GET',`/api/reports/tickets/${t.code}`)).json();
  assert.equal(history.events.filter(e=>e.changes.status?.despues==='Cerrado').length,2);
  assert.equal(history.comments.length,1);
  assert.equal((await req('PATCH',`/api/admin/tickets/${t.code}`,{status:'No existe'})).status(),400);
  await req('DELETE',`/api/admin/tickets/${archive.code}`);
  assert.equal((await context.request.get(`${base}/api/tickets/${archive.code}`)).status(),404);
  assert.equal((await req('PATCH',`/api/admin/tickets/${archive.code}`,{status:'Cerrado'})).status(),404);
  const archived=await (await req('GET',`/api/reports/tickets/${archive.code}`)).json();
  assert.ok(archived.deleted_at);assert.equal(archived.events.at(-1).action,'Archivado');
  // A legacy closed ticket has no known close date and must not acquire a fabricated one.
  execFileSync('docker',['compose','exec','-T','api','python','-c',"import os,sys,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(\"UPDATE tickets SET status='Cerrado',closed_at=NULL WHERE id=%s AND requester=%s\",(int(sys.argv[1]),sys.argv[2])); c.commit(); c.close()",String(ids[2]),prefix]);
  await page.goto(base,{waitUntil:'networkidle'});await page.evaluate(t=>sessionStorage.setItem('mesaTiToken',t),token);
  await page.getByRole('button',{name:/Acceso de TI/}).click();await page.locator('#reportsNav').click();
  await page.locator('#reportContent').waitFor({state:'visible'});
  await page.locator('#reportSearch').fill(prefix);
  assert.equal(await page.locator('.report-table tbody tr').count(),25);
  assert.ok((await page.locator('#reportCount').textContent()).startsWith('27'));
  await page.locator('#reportNext').click();assert.equal(await page.locator('.report-table tbody tr').count(),2);
  await page.locator('#reportStatus').selectOption('Cerrado');assert.equal(await page.locator('.report-table tbody tr').count(),2);
  assert.ok((await page.locator('#reportTable').innerText()).includes('Fecha no registrada'));
  await page.locator('#reportBasis').selectOption('closed_at');assert.equal(await page.locator('.report-table tbody tr').count(),1);
  await page.locator('#reportBasis').selectOption('created_at');
  await page.locator('#reportFrom').fill('2026-12-31');await page.locator('#reportTo').fill('2026-01-01');assert.equal(await page.locator('#reportError').isVisible(),true);
  await page.locator('#reportFrom').fill('');await page.locator('#reportTo').fill('');
  await page.screenshot({path:path.join(os.tmpdir(),'mesa-reports-desktop.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.locator('#reportExport').click();const download=await downloadPromise;
  const csv=await readFile(await download.path(),'utf8');assert.ok(csv.includes("'=1+1"),'CSV protege fórmulas');assert.ok(csv.includes(t.code));
  await page.locator(`[data-report-code="${t.code}"]`).click();await page.locator('#reportHistoryExport').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#reportHistoryExport').disabled);
  assert.equal(await page.locator('.report-timeline li').count(),history.events.length);
  const attachmentDownload=page.waitForEvent('download');await page.locator('[data-report-attachment]').click();assert.equal(await readFile(await (await attachmentDownload).path(),'utf8'),'Evidencia temporal de prueba');
  await page.screenshot({path:path.join(os.tmpdir(),'mesa-reports-history.png'),fullPage:true});
  const movementDownload=page.waitForEvent('download');await page.locator('#reportHistoryExport').click();const movementCSV=await readFile(await (await movementDownload).path(),'utf8');assert.ok(movementCSV.includes('Seguimiento después de reabrir'));
  await page.locator('#reportDone').click();
  await page.locator('#reportStatus').selectOption('');
  await page.evaluate(()=>{window.print=()=>{};});await page.locator('#reportPrint').click();
  assert.equal(await page.locator('.report-table tbody tr').count(),27,'Impresión incluye todas las páginas');
  await page.emulateMedia({media:'print'});await page.screenshot({path:path.join(os.tmpdir(),'mesa-reports-print.png'),fullPage:true});
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await page.locator('#reportArchive').selectOption('archived');assert.equal(await page.locator('.report-table tbody tr').count(),1);
  await page.locator('#reportArchive').selectOption('active');assert.ok((await page.locator('#reportCount').textContent()).startsWith('26'));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'mesa-reports-mobile.png'),fullPage:true});
  if(!await page.locator('#inventoryNav').isVisible())await page.locator('#menuButton').click();
  await page.locator('#inventoryNav').click();assert.equal(await page.locator('#reportsPage').isVisible(),false);assert.equal(await page.locator('#inventoryPage').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('Reportes: cierre y reapertura, historial, archivo, fechas desconocidas, filtros, paginación, CSV, impresión completa, móvil y navegación: OK');
} catch(error) {
  await page.screenshot({path:path.join(os.tmpdir(),'mesa-reports-failure.png'),fullPage:true});console.log('Errores JS:',errors);throw error;
} finally {
  // Permanently remove only the records created by this test, not normal archived tickets.
  if(ids.length) execFileSync('docker',['compose','exec','-T','api','python','-c',"import os,sys,json,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); ids=[r[0] for r in c.execute('SELECT id FROM tickets WHERE id=ANY(%s) AND requester=%s',(json.loads(sys.argv[1]),sys.argv[2]))]; [c.execute('DELETE FROM '+table+' WHERE ticket_id=ANY(%s)',(ids,)) for table in ['ticket_events','comments','attachments']]; c.execute('DELETE FROM tickets WHERE id=ANY(%s)',(ids,)); c.commit(); c.close()",JSON.stringify(ids),prefix]);
  await browser.close();
}
