import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base=process.env.TEST_URL||'http://127.0.0.1:8082';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const login=await context.request.post(base+'/api/auth/login',{data:{username:process.env.ADMIN_USER,password:process.env.ADMIN_PASSWORD}});
assert.equal(login.status(),200);const {token}=await login.json(),headers={Authorization:`Bearer ${token}`};
const req=(method,url,data)=>context.request.fetch(base+url,{method,headers,data});
const original=await (await req('GET','/api/admin/config')).json();
const prefix=`E2E-SETTINGS-${Date.now()}`,catalogIds=[],ticketIds=[],deviceIds=[];
let changedSupport=false;
try {
  assert.equal((await context.request.get(base+'/api/admin/config')).status(),401);
  assert.equal((await context.request.patch(base+'/api/admin/config/support',{data:{site_name:'No permitido'}})).status(),401);
  assert.equal((await context.request.post(base+'/api/admin/config/catalogs/area',{data:{name:'No permitido'}})).status(),401);
  const initialPublic=await (await context.request.get(base+'/api/config')).json();
  assert.deepEqual(Object.keys(initialPublic).sort(),['areas','categories','support']);
  assert.ok(!JSON.stringify(initialPublic).includes('password'));
  for(const kind of ['area','category']) {
    const created=await req('POST',`/api/admin/config/catalogs/${kind}`,{name:`${prefix}-${kind}`,description:'Opción temporal para probar configuración'});
    assert.equal(created.status(),201);const data=await created.json(),rows=kind==='area'?data.areas:data.categories;
    catalogIds.push(rows.find(r=>r.name===`${prefix}-${kind}`).id);
  }
  const [areaId,categoryId]=catalogIds;
  assert.equal((await req('POST','/api/admin/config/catalogs/area',{name:`${prefix}-AREA`})).status(),409);
  assert.equal((await req('PATCH','/api/admin/config/support',{email:'no es un correo'})).status(),400);
  assert.deepEqual((await (await req('GET','/api/admin/config')).json()).support,original.support);
  const deviceData={name:prefix,kind:'desktop',area:`${prefix}-area`,owner:'Responsable temporal',x:null,y:null};
  const createdDevice=await req('POST','/api/devices',deviceData);assert.equal(createdDevice.status(),201);const device=await createdDevice.json();deviceIds.push(device.id);
  await page.goto(base,{waitUntil:'networkidle'});await page.evaluate(t=>sessionStorage.setItem('mesaTiToken',t),token);
  await page.getByRole('button',{name:/Acceso de TI/}).click();await page.locator('#settingsNav').click();await page.locator('#settingsContent').waitFor({state:'visible'});
  const support={technician_name:'Encargado de prueba',site_name:'Sede de prueba',extension:'9755',email:'sistemas-prueba@example.test',hours:'Lunes a viernes, 08:00 a 17:00'};
  for(const [key,value] of Object.entries(support))await page.locator(`#supportForm [name=${key}]`).fill(value);
  changedSupport=true;await page.locator('#supportSave').click();await page.waitForFunction(()=>!document.querySelector('#supportSave').disabled);
  assert.deepEqual((await (await context.request.get(base+'/api/config')).json()).support,support);
  assert.equal(await page.locator('.sidebar-user > div > strong').textContent(),support.technician_name);
  await page.screenshot({path:path.join(os.tmpdir(),'mesa-settings-desktop.png'),fullPage:true});
  await page.locator('#adminShell [data-action=public-home]').click();
  await page.locator(`.service-card[data-category="${prefix}-category"]`).click();
  const form=page.locator('#ticketForm');await form.locator('[name=requester]').fill(prefix);await form.locator('[name=area]').selectOption(`${prefix}-area`);await form.locator('[name=subject]').fill('Ticket con catálogos editables');await form.locator('[name=description]').fill('Debe conservar las opciones originales en el historial');
  assert.equal(await form.locator('[name=category]').inputValue(),`${prefix}-category`);
  const responsePromise=page.waitForResponse(r=>r.url()===base+'/api/tickets' && r.request().method()==='POST');await form.locator('button[type=submit]').click();const createdTicket=await responsePromise;assert.equal(createdTicket.status(),201);const ticket=await createdTicket.json();ticketIds.push(ticket.id);
  await page.locator('#receiptModal').waitFor({state:'visible'});
  const pdf=await context.request.get(`${base}/api/tickets/${ticket.code}/receipt.pdf`);assert.equal(pdf.status(),200);const pdfBody=await pdf.body();assert.ok(pdfBody.toString('latin1').includes('9755'));assert.ok(pdfBody.toString('latin1').includes('sistemas-prueba@example.test'));
  await writeFile(path.join(os.tmpdir(),'mesa-settings-receipt.pdf'),pdfBody);
  const imagePromise=page.waitForEvent('download');await page.locator('#downloadImage').click();await (await imagePromise).saveAs(path.join(os.tmpdir(),'mesa-settings-receipt.jpg'));
  await page.getByRole('button',{name:'Cerrar comprobante'}).click();
  assert.ok((await page.locator('.public-footer').innerText()).includes('9755'));
  await page.evaluate(t=>sessionStorage.setItem('mesaTiToken',t),token);await page.getByRole('button',{name:/Acceso de TI/}).click();await page.locator('#settingsNav').click();await page.locator('#settingsContent').waitFor({state:'visible'});
  for(const id of catalogIds){await page.locator(`[data-catalog-toggle="${id}"]`).click();await page.waitForFunction(id=>document.querySelector(`[data-catalog-toggle="${id}"]`)?.textContent==='Reactivar',id);}
  const hidden=await (await context.request.get(base+'/api/config')).json();assert.ok(!hidden.areas.some(r=>r.id===areaId));assert.ok(!hidden.categories.some(r=>r.id===categoryId));
  assert.equal((await req('POST','/api/tickets',{requester:prefix,area:`${prefix}-area`,subject:'Debe rechazarse',category:`${prefix}-category`,priority:'Media',description:'Opción inactiva'})).status(),400);
  assert.equal((await req('POST','/api/devices',{...deviceData,name:prefix+'-invalid'})).status(),400);
  const preserved=await req('PATCH',`/api/devices/${device.id}`,{...deviceData,notes:'Editar un registro de un área desactivada'});assert.equal(preserved.status(),200);
  assert.equal((await req('PATCH',`/api/admin/tickets/${ticket.code}`,{category:`${prefix}-category`,priority:'Alta'})).status(),200);
  const other=(await req('POST','/api/tickets',{requester:prefix,area:initialPublic.areas[0].name,subject:'Otro ticket de prueba',category:initialPublic.categories[0].name,priority:'Media',description:'Verifica que no se pueda cambiar a categoría inactiva'}));assert.equal(other.status(),201);const otherTicket=await other.json();ticketIds.push(otherTicket.id);
  assert.equal((await req('PATCH',`/api/admin/tickets/${otherTicket.code}`,{category:`${prefix}-category`})).status(),400);
  await page.locator('#inventoryNav').click();await page.locator('#invLoadStatus').waitFor({state:'hidden'});await page.locator('#invSearch').fill(prefix);await page.locator(`[data-device="${device.id}"]`).first().click();
  assert.equal(await page.locator('#invForm [name=area]').inputValue(),`${prefix}-area`);
  await page.locator('#invForm [name=notes]').fill('Edición con área histórica desde interfaz');await page.locator('#invSave').click();await page.locator('#deviceDialog').waitFor({state:'hidden'});
  await page.locator('#settingsNav').click();await page.locator('#settingsContent').waitFor({state:'visible'});
  for(const [kind,id] of [['area',areaId],['category',categoryId]]) {
    await page.locator(`[data-catalog-edit="${id}"]`).click();await page.locator('#catalogForm [name=name]').fill(`${prefix}-${kind}-renamed`);await page.locator('#catalogForm [name=active]').check();await page.locator('#catalogSave').click();await page.locator('#catalogDialog').waitFor({state:'hidden'});
  }
  const historical=await (await req('GET',`/api/reports/tickets/${ticket.code}`)).json();assert.equal(historical.area,`${prefix}-area`);assert.equal(historical.category,`${prefix}-category`);
  assert.equal((await (await req('GET','/api/devices')).json()).find(d=>d.id===device.id).area,`${prefix}-area`);
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:/Acceso de TI/}).click();await page.locator('#settingsNav').click();await page.locator('#settingsContent').waitFor({state:'visible'});assert.equal(await page.locator('#supportForm [name=extension]').inputValue(),'9755');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(os.tmpdir(),'mesa-settings-mobile.png'),fullPage:true});
  const longSupport={technician_name:'W'.repeat(100),site_name:'W'.repeat(80),extension:'9'.repeat(30),email:'w'.repeat(140)+'@example.test',hours:'Horario '+'W'.repeat(152)};
  assert.equal((await req('PATCH','/api/admin/config/support',longSupport)).status(),200);
  const stressBody=await (await context.request.get(`${base}/api/tickets/${ticket.code}/receipt.pdf`)).body();const positions=[...stressBody.toString('latin1').matchAll(/70 (\d+) Td/g)].map(m=>Number(m[1]));assert.ok(Math.min(...positions)>=60,'Los datos largos caben en la página');await writeFile(path.join(os.tmpdir(),'mesa-settings-receipt-long.pdf'),stressBody);
  // Verify the last-active guard in an isolated temporary schema, without disabling live catalogs.
  execFileSync('docker',['compose','exec','-T','api','python','-c',`import os,uuid,psycopg
from psycopg import sql
from psycopg.rows import dict_row
from settings import SCHEMA,handle
schema='qa_settings_'+uuid.uuid4().hex
root=psycopg.connect(os.environ['DATABASE_URL'],autocommit=True)
root.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
def db(): return psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row,options='-c search_path='+schema)
class Handler:
 def admin(self): return True
 def json(self,status,data): self.status=status
try:
 with db() as c:
  c.execute(SCHEMA);c.execute("INSERT INTO app_configuration(id,support) VALUES(1,'{}')")
  ident=c.execute("INSERT INTO config_catalog(kind,name) VALUES('area','Solo') RETURNING id").fetchone()['id']
 h=Handler();handle(h,'/api/admin/config/catalogs/'+str(ident),'PATCH',db,{'active':False});assert h.status==400
 with db() as c: assert c.execute('SELECT active FROM config_catalog WHERE id=%s',(ident,)).fetchone()['active']
finally:
 root.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)));root.close()`]);
  assert.deepEqual(errors,[]);
  console.log('Configuración: permisos, catálogos, duplicados, desactivación, historia, edición de equipos, datos de soporte, comprobantes, persistencia y móvil: OK');
} catch(error) {await page.screenshot({path:path.join(os.tmpdir(),'mesa-settings-failure.png'),fullPage:true});console.log('Errores JS:',errors);throw error;}
finally {
  if(changedSupport)await req('PATCH','/api/admin/config/support',original.support);
  execFileSync('docker',['compose','exec','-T','api','python','-c',"import os,sys,json,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); tids=[r[0] for r in c.execute('SELECT id FROM tickets WHERE id=ANY(%s) AND requester=%s',(json.loads(sys.argv[1]),sys.argv[4]))]; [c.execute('DELETE FROM '+t+' WHERE ticket_id=ANY(%s)',(tids,)) for t in ['ticket_events','comments','attachments']]; c.execute('DELETE FROM tickets WHERE id=ANY(%s)',(tids,)); c.execute('DELETE FROM devices WHERE id=ANY(%s) AND name=%s',(json.loads(sys.argv[2]),sys.argv[4])); c.execute('DELETE FROM config_catalog WHERE id=ANY(%s) AND name LIKE %s',(json.loads(sys.argv[3]),sys.argv[4]+'-%')); c.commit(); c.close()",JSON.stringify(ticketIds),JSON.stringify(deviceIds),JSON.stringify(catalogIds),prefix]);
  await browser.close();
}
