import assert from 'node:assert/strict';
import {base,ensureIsolated,launchBrowser,dockerExec} from './helpers.mjs';
await ensureIsolated();
const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
let code;
try{
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:/Levantar un ticket/i}).first().click();
  await page.locator('#ticketForm [name=requester]').fill('Prueba móvil aislada');await page.locator('#ticketForm [name=area]').selectOption('Sistemas');await page.locator('#ticketForm [name=subject]').fill('Validación móvil completa');await page.locator('textarea[name=description]').fill('Ticket temporal en una base exclusiva de pruebas');
  await page.locator('#ticketForm button[type=submit]').click();await page.locator('#receiptModal:not([hidden])').waitFor();code=await page.locator('#receiptCode').textContent();
  assert.equal(await page.locator('#lookupKey').count(),0);assert.equal(await page.locator('#ticketForm [name=requester]').inputValue(),'');
  const pdf=await page.request.get(`${base}/api/tickets/${code}/receipt.pdf`);assert.equal(pdf.status(),200);assert.equal(pdf.headers()['content-type'],'application/pdf');
  await page.locator('#copyCode').click();await page.waitForFunction(value=>document.querySelector('#toast').textContent.includes(value),code);assert.ok((await page.locator('#toast').innerText()).includes(code));
  const image=page.waitForEvent('download');await page.locator('#downloadImage').click();await image;
  const download=page.waitForEvent('download');await page.locator('#downloadPdf').click();await download;
  await page.getByRole('button',{name:'Cerrar comprobante',exact:true}).click();
  await page.locator('#lookupInput').fill(code);await page.locator('#lookupForm button').click();await page.locator('.public-ticket-card h3').filter({hasText:code}).waitFor();assert.equal(await page.locator('.public-ticket-status').innerText(),'Abierto');
  await page.getByRole('button',{name:/Acceso de TI/i}).first().click();await page.locator('#loginForm [name=username]').fill(process.env.ADMIN_USER);await page.locator('#loginForm [name=password]').fill(process.env.ADMIN_PASSWORD);await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#globalSearch').fill(code);await page.locator('.ticket-row').filter({hasText:code}).click();
  await page.locator('#detailForm [name=status]').selectOption('En progreso');await page.locator('#detailForm [name=assignee]').fill('Técnico E2E');await page.locator('#detailForm .primary-button').click();await page.getByText('Cambios guardados',{exact:true}).waitFor();
  await page.locator('#commentForm textarea').fill('Comentario de la prueba móvil');await page.locator('#commentForm button').click();await page.locator('#commentList').getByText('Comentario de la prueba móvil',{exact:true}).waitFor();assert.equal(await page.locator('#commentForm textarea').inputValue(),'');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#deleteTicket').click();await page.locator('#detailModal').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.locator('#publicPortal').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);console.log('Flujo móvil: alta, limpieza, folio, consulta, comprobantes, edición, comentario, archivo y salida: OK');
}finally{
  if(code)dockerExec('api','python','-c',"import os,sys,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); ids=[r[0] for r in c.execute('SELECT id FROM tickets WHERE code=%s AND requester=%s',(sys.argv[1],'Prueba móvil aislada'))]; [c.execute('DELETE FROM '+t+' WHERE ticket_id=ANY(%s)',(ids,)) for t in ['ticket_events','comments','attachments']]; c.execute('DELETE FROM tickets WHERE id=ANY(%s)',(ids,)); c.commit()",code);
  await browser.close();
}
