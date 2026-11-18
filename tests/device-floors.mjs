import {ensureIsolated,launchBrowser,base} from './helpers.mjs';
import assert from 'node:assert/strict';
await ensureIsolated();
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1280,height:900}});
const page=await context.newPage();page.setDefaultTimeout(12000);
const login=await context.request.post(base+'/api/auth/login',{data:{username:process.env.ADMIN_USER,password:process.env.ADMIN_PASSWORD}});
assert.equal(login.status(),200);
const {token}=await login.json();const headers={Authorization:`Bearer ${token}`};
const ids=[];const prefix=`FLOORS-${Date.now()}`;
try {
  for(const floor of ['','ground','upper']) {
    const response=await context.request.post(base+'/api/devices',{headers,data:{name:prefix+(floor || '-unassigned'),kind:'desktop',area:'Sistemas',owner:'Prueba',floor,office:'Contabilidad',x:23,y:68}});
    assert.equal(response.status(),201);ids.push((await response.json()).id);
  }
  for(const floor of ['ground','upper']) {
    const response=await context.request.post(base+'/api/devices',{headers,data:{name:prefix+'-plant-'+floor,kind:'desktop',area:'Sistemas',owner:'Prueba',floor,x:40,y:40}});
    assert.equal(response.status(),201);ids.push((await response.json()).id);
  }
  for(const x of [53.5,82.3]) {
    const response=await context.request.post(base+'/api/devices',{headers,data:{name:prefix+'-office-'+x,kind:'desktop',area:'Sistemas',owner:'Prueba',floor:'upper',x,y:68}});
    assert.equal(response.status(),201);ids.push((await response.json()).id);
  }
  await page.goto(base,{waitUntil:'networkidle'});
  await page.evaluate(value=>sessionStorage.setItem('mesaTiToken',value),token);
  await page.getByRole('button',{name:/Acceso de TI/}).click();
  await page.locator('#inventoryNav').click();
  await page.locator('#invLoadStatus').waitFor({state:'hidden'});
  await page.locator('#invSearch').fill(prefix);
  assert.equal(await page.locator('#invList tbody tr').count(),7);
  await page.locator('[data-inv-view=map]').click();
  for(const zone of ['office-2','office-3']){await page.locator('#invMapZone').selectOption(zone);await page.locator('#invMapFloor').selectOption('upper');}
  await page.locator('#invMapZone').selectOption('office-1');
  for(const [index,floor] of ['','ground','upper'].entries()) {
    await page.locator('#invMapFloor').selectOption(floor);
    assert.equal(await page.locator('#invMarkers [data-device]').count(),5);
    assert.equal(await page.locator(`#invMarkers [data-device="${ids[index]}"]`).count(),1);
  }
  for(const id of ids.slice(3,5))assert.equal(await page.locator(`#invMarkers [data-device="${id}"]`).count(),1);
  await page.locator('[data-inv-view=list]').click();
  await page.locator(`#invList [data-device="${ids[1]}"]`).click();
  assert.ok((await page.locator('#invDeviceSummary').innerText()).includes('Planta baja'));
  await page.locator('#invEdit').click();
  await page.locator('#invForm [name=floor]').selectOption('upper');
  await page.locator('#invForm [name=office]').fill('Recursos Humanos');
  await page.locator('#invChoosePosition').click();
  assert.equal(await page.locator('#invMapFloor').inputValue(),'upper');
  await page.locator('#invPlaceCancel').click();
  await page.locator('#invSave').click();
  await page.locator('#deviceDialog').waitFor({state:'hidden'});
  const devices=await (await context.request.get(base+'/api/devices',{headers})).json();
  const saved=devices.find(device=>device.id===ids[1]);
  assert.equal(saved.floor,'upper');assert.equal(saved.office,'Recursos Humanos');
  assert.equal(saved.x,23);assert.equal(saved.y,68);
  assert.equal(await page.locator('#invMarkers [data-device]').count(),6);
  await page.locator('[data-inv-view=list]').click();
  await page.locator(`#invList [data-device="${ids[3]}"]`).click();
  await page.locator('#invEdit').click();
  assert.equal(await page.locator('#invForm [name=floor]').isDisabled(),true);
  await page.locator('#invCancel').click();
  await page.locator('#invCancel').click();
  console.log('Pisos separados, coordenadas compartidas, ficha, oficina y persistencia: OK');
} finally {
  for(const id of ids)await context.request.delete(base+`/api/devices/${id}`,{headers});
  await browser.close();
}
