import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {base,ensureIsolated,launchBrowser} from './helpers.mjs';
await ensureIsolated();await mkdir('test-results',{recursive:true});
const browser=await launchBrowser();const page=await browser.newPage();
try{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 await page.locator('[data-action=new-ticket]').first().click();
 const form=page.locator('#ticketForm');await form.locator('[name=payroll]').fill('000777');await form.locator('[name=area]').selectOption('Sistemas');await form.locator('[name=subject]').fill('Consulta por nomina');await form.locator('[name=description]').fill('Detalle de la solicitud\nSegunda linea con evidencia.');
 const response=page.waitForResponse(r=>r.url()===base+'/api/tickets'&&r.request().method()==='POST');await form.locator('button[type=submit]').click();const ticket=await (await response).json();assert.ok(ticket.code);
 const pdf=await page.request.get(`${base}/api/tickets/${ticket.code}/receipt.pdf`);assert.equal(pdf.status(),200);await writeFile('test-results/receipt-formatted.pdf',await pdf.body());
 await page.locator('[data-action=close-receipt]').first().click();
 await page.locator('#lookupMode').selectOption('payroll');await page.locator('#lookupInput').fill('000777');await page.locator('#lookupForm button[type=submit]').click();await page.locator('.public-ticket-result').first().click();await page.locator('.public-ticket-card').waitFor();assert.ok((await page.locator('.public-ticket-card').innerText()).includes('000777'));assert.equal(await page.locator('.public-ticket-card input,.public-ticket-card select,.public-ticket-card textarea').count(),0);
 await page.locator('#lookupSection').screenshot({path:'test-results/public-lookup-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('#lookupSection').screenshot({path:'test-results/public-lookup-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#lookupMode').selectOption('folio');await page.locator('#lookupInput').fill(ticket.code);await page.locator('#lookupForm button[type=submit]').click();await page.locator('.public-ticket-card').waitFor();assert.ok((await page.locator('.public-ticket-card').innerText()).includes('Segunda linea'));
 const name='Public identity test';await page.request.post(base+'/api/tickets',{data:{requester:name,area:'Sistemas',subject:'Nombre solamente',category:'Hardware',priority:'Media',description:'Por nombre'}});
 await page.locator('#lookupMode').selectOption('requester');await page.locator('#lookupInput').fill(name);await page.locator('#lookupForm button[type=submit]').click();await page.locator('.public-ticket-result').first().click();assert.ok((await page.locator('.public-ticket-card').innerText()).includes(name));assert.deepEqual(errors,[]);
 console.log('Alta por nomina, consulta por nomina/nombre/folio, tarjeta de solo lectura, PDF y movil: OK');
}finally{await browser.close();}
