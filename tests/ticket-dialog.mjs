// Mocked API only: no real ticket is read or changed.
import {launchBrowser} from './helpers.mjs';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await launchBrowser();mkdirSync('test-results',{recursive:true});
try{
 for(const width of [1366,390])for(const palette of ['classic','slate','night']){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ticket={code:'TK-00005',requester:'Karla Velazco',area:'Calidad',subject:'Solicitud de Laptop',description:'Se solicitó una laptop para el área de Laboratorio, para el uso correcto del brazo.',status:'Abierto',priority:'Crítica',assignee:'Sin asignar',created_at:'2026-11-17T13:30:28Z',attachments:[],comments:[]};
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname,method=route.request().method();
   if(path==='/api/admin/tickets/TK-00005'&&method==='PATCH')Object.assign(ticket,route.request().postDataJSON());
   if(path.includes('/comments')&&method==='POST')ticket.comments.push({author:'Técnico de prueba',body:route.request().postDataJSON().body,created_at:new Date().toISOString()});
   const data=path==='/api/config'?{support:{technician_name:'Prueba',site_name:'Planta de prueba',extension:'2401',email:'',hours:'Horario de prueba'},areas:[{name:'Calidad',active:true}],categories:[{name:'Hardware',active:true}]}:path==='/api/tickets'?{items:[ticket],total:1,page:1,categories:['Hardware'],dashboard:{total:1,open:1,in_progress:0,closed:0}}:path==='/api/devices'?[]:path.includes('/tickets/TK-00005')?ticket:{};
   await route.fulfill({json:data});
  });
  await page.goto(process.env.TICKET_UI_URL||'http://localhost:8082/');
  await page.evaluate(async palette=>{document.documentElement.dataset.palette=palette;await openDetail('TK-00005')},palette);
  await page.locator('#detailModal').waitFor({state:'visible'});
  assert.ok(await page.locator('#detailModal .close-button').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el}));
  assert.equal(await page.locator('#detailForm .glide-select').count(),0);
  assert.equal(await page.locator('#detailForm [name="status"]').inputValue(),'Abierto');
  assert.equal(await page.locator('#detailForm [name="priority"]').inputValue(),'Crítica');
  const geometry=await page.locator('#detailForm').evaluate(form=>{const labels=[...form.children].filter(e=>e.tagName==='LABEL').map(e=>e.getBoundingClientRect());return labels.map(r=>({left:r.left,top:r.top,right:r.right}))});
  assert.equal(geometry.length,4);assert.ok(width>600?geometry[1].left>geometry[0].left:geometry[1].top>geometry[0].top);
  assert.ok(await page.locator('#detailModal .detail-modal').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));
  const colors=await page.locator('#detailForm input').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  if(palette!=='classic'){assert.notEqual(colors.background,'rgb(255, 255, 255)');assert.notEqual(colors.color,'rgb(0, 0, 0)')}
  await page.locator('#detailForm [name="assignee"]').fill('Técnico de prueba');await page.locator('#detailForm .primary-button').click();
  await page.waitForFunction(()=>document.querySelector('#detailForm .primary-button').textContent==='Guardar cambios');assert.equal(ticket.assignee,'Técnico de prueba');
  await page.locator('#detailComment').fill('Solicitud en revisión por Sistemas.');await page.locator('#commentForm button').click();await page.waitForFunction(()=>document.querySelector('#commentList').textContent.includes('Solicitud en revisión'));
  await page.locator('#detailModal .detail-body').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`test-results/ticket-dialog-${palette}-${width}.png`});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#detailModal').isHidden(),true);assert.deepEqual(errors,[]);
  console.log(`PASS ticket dialog ${palette} ${width}: layout, native selects, themes, save, comments, Escape.`);await page.close();
 }
}finally{await browser.close()}
