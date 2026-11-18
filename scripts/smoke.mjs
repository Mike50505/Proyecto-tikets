// Read-only operational smoke test. It creates/revokes a login session, not records.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base='http://127.0.0.1:8082';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
let token;
try{
  assert.equal((await context.request.get(base+'/api/health')).status(),200);
  const login=await context.request.post(base+'/api/auth/login',{data:{username:process.env.ADMIN_USER,password:process.env.ADMIN_PASSWORD}});
  assert.equal(login.status(),200,'Las credenciales existentes siguen funcionando');
  token=(await login.json()).token;const headers={Authorization:`Bearer ${token}`};
  const response=await context.request.get(base+'/api/tickets',{headers});assert.equal(response.status(),200);
  const data=await response.json();assert.ok(Array.isArray(data.items));assert.ok(data.items.length<=25);
  if(data.items[0])assert.equal((await context.request.get(base+'/api/tickets/'+data.items[0].code)).status(),404);
  await page.goto(base,{waitUntil:'networkidle'});await page.evaluate(value=>sessionStorage.setItem('mesaTiToken',value),token);
  await page.getByRole('button',{name:/Acceso de TI/}).click();await page.locator('#adminShell').waitFor({state:'visible'});
  await page.locator('#settingsNav').click();await page.locator('#settingsContent').waitFor({state:'visible'});await page.locator('#accountsAdmin').waitFor({state:'visible'});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    const toggle=page.locator('#adminShell .mesa-palette-toggle');await toggle.click();
    const select=page.locator('#adminShell .mesa-palette-panel select');
    for(const key of ['classic','pearl','ivory','sage','slate','night']){await select.selectOption(key,{force:true});assert.equal(await page.locator('html').getAttribute('data-palette'),key);}
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sin desbordamiento horizontal');
  }
  const logout=page.waitForResponse(response=>response.url()===base+'/api/auth/logout',{timeout:10000});
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await logout;
  assert.equal((await context.request.get(base+'/api/tickets',{headers})).status(),401);
  assert.deepEqual(errors,[]);
  console.log('PASS: salud, acceso existente, consulta protegida, cuentas, seis paletas, escritorio/móvil y revocación. No se modificaron registros operativos.');
}finally{
  if(token)await context.request.post(base+'/api/auth/logout',{headers:{Authorization:`Bearer ${token}`},data:{}}).catch(()=>{});
  await browser.close();
}
