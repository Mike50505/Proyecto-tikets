import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {base,ensureIsolated,launchBrowser} from './helpers.mjs';
await ensureIsolated();await mkdir('test-results',{recursive:true});
const browser=await launchBrowser();const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  const login=await context.request.post(base+'/api/auth/login',{data:{username:process.env.ADMIN_USER,password:process.env.ADMIN_PASSWORD}});
  const {token}=await login.json(),headers={Authorization:`Bearer ${token}`};
  await page.goto(base);await page.evaluate(t=>sessionStorage.setItem('mesaTiToken',t),token);
  await page.getByRole('button',{name:/Acceso de TI/}).first().click();await page.locator('#adminShell').waitFor({state:'visible'});
  await page.locator('#pendingNav').click();await page.locator('#pendingBoard').waitFor({state:'visible'});
  assert.equal(await page.locator('#dashboard').isVisible(),false);
  const day=await page.locator('#pendingDate').inputValue();
  const beforeTickets=await (await context.request.get(base+'/api/tickets',{headers})).json();
  await page.locator('#pendingQuickTitle').fill('Revisar respaldo del servidor');
  await page.locator('#pendingQuick button[type=submit]').click();
  const card=page.locator('.pending-card').filter({hasText:'Revisar respaldo del servidor'});
  await card.waitFor();assert.equal(await page.locator('#pendingQuickTitle').inputValue(),'');
  await card.locator('[data-edit]').click();await page.locator('#pendingForm [name=status]').selectOption('doing');await page.locator('#pendingSave').click();await page.locator('#pendingDialog').waitFor({state:'hidden'});
  await page.locator('.pending-card.pending-doing').filter({hasText:'Revisar respaldo del servidor'}).waitFor();
  await card.locator('[data-edit]').click();
  await page.locator('#pendingForm [name=notes]').fill('Respaldo confirmado.\nFalta validar la restauración. <img src=x onerror="window.pendingXss=1">');
  await page.locator('#pendingForm [name=assignee]').fill('Equipo de TI');
  await page.locator('#pendingSave').click();await page.locator('#pendingDialog').waitFor({state:'hidden'});
  await card.getByText('Equipo de TI',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.pendingXss),undefined);
  await card.locator('[data-check]').check();await page.locator('.pending-card.pending-done').filter({hasText:'Revisar respaldo del servidor'}).waitFor();
  assert.equal(await page.locator('#pendingSummary').innerText(),'1 de 1 completados');
  assert.equal(await page.locator('.topbar').isVisible(),false);
  assert.ok((await page.locator('#pendingBoard').boundingBox()).y<350,'Lista visible cerca del inicio en escritorio');
  assert.equal(await page.locator('.pending-checklist').count(),1);
  assert.equal(await page.locator('.pending-column').count(),0);
  assert.ok((await card.locator('.pending-task-title').evaluate(el=>getComputedStyle(el).textDecorationLine)).includes('line-through'));
  assert.equal(await card.locator('.pending-task-title').evaluate(el=>getComputedStyle(el).color),'rgb(134, 139, 147)');
  await page.reload();await page.getByRole('button',{name:/Acceso de TI/}).first().click();await page.locator('#pendingNav').click();
  await page.locator('.pending-card.pending-done').waitFor();await card.locator('[data-check]').uncheck();await page.locator('.pending-card.pending-todo').waitFor();
  const yesterday=new Date(day+'T12:00:00');yesterday.setDate(yesterday.getDate()-1);const previous=yesterday.toISOString().slice(0,10);
  for(const data of [
    {title:'Preparar equipos de nuevo ingreso',notes:'Instalar aplicaciones y validar los accesos.',assignee:'Sistemas',due_date:day},
    {title:'Revisar conexión de la sala',notes:'Validar el cableado antes de la reunión.',assignee:'Equipo de TI',due_date:previous},
    {title:'Actualizar inventario de monitores',notes:'Registrar los equipos entregados.',assignee:'Sistemas',due_date:day}
  ])assert.equal((await context.request.post(base+'/api/pending',{headers,data})).status(),201);
  await page.locator('#pendingRefresh').click();await page.getByText('Pendiente desde '+new Date(previous+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'}),{exact:true}).waitFor();
  const newCard=page.locator('.pending-card').filter({hasText:'Actualizar inventario de monitores'});await newCard.locator('[data-check]').check();
  await page.locator('.pending-card.pending-done').filter({hasText:'Actualizar inventario de monitores'}).waitFor();
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:'test-results/pending-desktop.png',fullPage:true});
  await page.locator('#pendingSearch').fill('sin coincidencias');assert.equal(await page.locator('.pending-card').count(),0);await page.locator('#pendingSearch').fill('');
  await page.evaluate(()=>{document.documentElement.dataset.palette='night';document.documentElement.dataset.theme='dark';});
  await page.screenshot({path:'test-results/pending-dark.png',fullPage:true});
  await page.evaluate(()=>{document.documentElement.dataset.palette='classic';document.documentElement.dataset.theme='light';});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sin desbordamiento horizontal en móvil');
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:'test-results/pending-mobile.png',fullPage:true});
  await page.locator('#pendingAdd').click();await page.locator('#pendingForm [name=title]').fill('Comprobar impresora de recepción');
  await page.locator('#pendingForm [name=notes]').fill('Confirmar prueba de impresión con recepción.');
  await page.locator('#pendingDialog').screenshot({path:'test-results/pending-dialog-mobile.png'});
  await page.locator('#pendingSave').click();await page.locator('#pendingDialog').waitFor({state:'hidden'});
  const printer=page.locator('.pending-card').filter({hasText:'Comprobar impresora de recepción'});await printer.waitFor();
  await printer.locator('[data-edit]').click();page.once('dialog',d=>d.accept());await page.locator('#pendingArchive').click();await page.locator('#pendingDialog').waitFor({state:'hidden'});await printer.waitFor({state:'detached'});
  await page.setViewportSize({width:1440,height:1050});
  const afterTickets=await (await context.request.get(base+'/api/tickets',{headers})).json();assert.equal(afterTickets.total,beforeTickets.total);
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
  assert.equal(await page.locator('#pendingDialog').isVisible(),false);assert.equal(await page.locator('.pending-card').count(),0);
  assert.equal((await context.request.get(base+'/api/pending?scope=all')).status(),401);
  assert.deepEqual(errors,[]);
  console.log('Pendientes: alta rápida, notas, responsable, estados, reapertura, persistencia, anteriores, búsqueda, archivo, móvil y acceso TI: OK');
}finally{await browser.close();}
