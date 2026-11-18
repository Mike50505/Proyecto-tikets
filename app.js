let tickets = [];
let activeTicket = null;
let receiptTicket = null;
let sessionUser = null;
let ticketCategories = [];
let ticketPage=1,ticketTotal=0,ticketVersion=0,ticketSummary=null;
const ticketPager=document.createElement('div');ticketPager.id='ticketPager';ticketPager.className='report-pagination';
ticketPager.innerHTML='<button id="ticketPrev" class="secondary-button">Anterior</button><span id="ticketPageLabel" role="status"></span><button id="ticketNext" class="secondary-button">Siguiente</button>';
document.querySelector('#ticketList').after(ticketPager);

const state = { filter: "Todos", category: "Todas", search: "", limit: Infinity };
const list = document.querySelector("#ticketList");
const empty = document.querySelector("#emptyState");
const modal = document.querySelector("#ticketModal");
const receiptModal = document.querySelector("#receiptModal");
const loginModal = document.querySelector("#loginModal");
const detailModal = document.querySelector("#detailModal");

async function api(path, options = {}) {
  const token=sessionStorage.getItem('mesaTiToken');
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){if(response.status===401&&!path.includes('/auth/login'))showPublic();const error=new Error(data.error||(response.status===413?'Los archivos exceden el tamaño permitido.':'No fue posible completar la operación'));error.status=response.status;throw error;}
  return data;
}
async function downloadFile(url,name,headers={}){
  const token=sessionStorage.getItem('mesaTiToken');
  const response=await fetch(url,{headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers}});
  if(!response.ok)throw new Error('No se pudo descargar el archivo. Verifica tu acceso.');
  const blob=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=blob;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
}
async function encodeFiles(files){ return Promise.all([...files].map(file=>new Promise((resolve,reject)=>{ if(file.size>10*1024*1024)return reject(new Error(`${file.name} supera 10 MB`)); const reader=new FileReader();reader.onload=()=>resolve({name:file.name,type:file.type||"application/octet-stream",data:String(reader.result).split(',')[1]});reader.onerror=()=>reject(new Error(`No se pudo leer ${file.name}`));reader.readAsDataURL(file); }))); }
function normalize(ticket){ return {...ticket,id:ticket.code||ticket.id,title:ticket.subject||ticket.title,date:ticket.created_at?new Date(ticket.created_at).toLocaleString("es-MX"):ticket.date}; }
async function loadTickets(){
  const version=++ticketVersion;
  const params=new URLSearchParams({page:String(ticketPage),page_size:'25',...(state.filter!=='Todos'?{status:state.filter}:{}),...(state.category!=='Todas'?{category:state.category}:{}),search:state.search});
  try{const data=await api('/api/tickets?'+params);if(version!==ticketVersion)return;tickets=data.items.map(normalize);ticketPage=data.page;ticketTotal=data.total;ticketCategories=data.categories;ticketSummary=data.dashboard;updateCounters();renderTickets();}
  catch(error){if(version===ticketVersion)showToast('No se pudo cargar',error.message);}
}
function reloadTickets(){ticketPage=1;return loadTickets();}
function updateCounters(){
  const data=ticketSummary||{opened:0,progress:0,closed_month:0,average_hours:null};
  document.querySelector('#openCount').textContent=data.opened;document.querySelector('#progressCount').textContent=data.progress;
  document.querySelector('#openNavCount').textContent=data.opened;document.querySelector('#closedCount').textContent=data.closed_month;
  document.querySelector('#resolutionAverage').textContent=data.average_hours===null?'—':`${data.average_hours.toFixed(1)} h`;
}
document.querySelector('#ticketPrev').addEventListener('click',()=>{ticketPage--;loadTickets();});
document.querySelector('#ticketNext').addEventListener('click',()=>{ticketPage++;loadTickets();});

function statusClass(status) { return status === "Abierto" ? "open" : status === "En progreso" ? "progress" : "closed"; }
function categorySymbol(category) { return ({ Hardware: "□", Software: "◇", Red: "⌁", Accesos: "♙" })[category] || "?"; }
function renderTickets() {
  const filtered = tickets;
  list.innerHTML = filtered.map(ticket => `
    <article class="ticket-row" tabindex="0">
      <div class="ticket-main"><span class="category-icon">${categorySymbol(ticket.category)}</span><div class="ticket-title"><strong>${safe(ticket.title)}</strong><span>${safe(ticket.id)} · ${safe(ticket.requester)}</span></div></div>
      <div class="ticket-meta category"><strong>${safe(ticket.category)}</strong><span>Categoría</span></div>
      <div><span class="badge ${statusClass(ticket.status)}">${safe(ticket.status)}</span></div>
      <div class="ticket-meta priority"><strong class="priority ${({Baja:'baja',Media:'media',Alta:'alta','Crítica':'crítica'})[ticket.priority]||'media'}">${safe(ticket.priority)}</strong><span>${safe(ticket.date)}</span></div>
      <span class="chevron">›</span>
    </article>`).join("");
  empty.hidden = filtered.length > 0;
  list.hidden = filtered.length === 0;
  document.querySelector('#ticketPrev').disabled=ticketPage<=1;
  document.querySelector('#ticketNext').disabled=ticketPage*25>=ticketTotal;
  document.querySelector('#ticketPageLabel').textContent=`Página ${ticketPage} de ${Math.max(1,Math.ceil(ticketTotal/25))} · ${ticketTotal} tickets`;
  document.dispatchEvent(new Event('mesa:tickets-rendered'));
}

function openModal() { modal.hidden = false; document.body.style.overflow = "hidden"; document.dispatchEvent(new Event('mesa:new-ticket')); modal.querySelector("input[name='requester']").focus(); }
function closeModal() { modal.hidden = true; document.body.style.overflow = ""; }
function showToast(title, message) {
  const toast = document.querySelector("#toast");
  toast.querySelector("strong").textContent = title; toast.querySelector("p").textContent = message;
  toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3500);
}
function mobileSafeDate(value = new Date()) { const date=value instanceof Date?value:new Date(value); if(Number.isNaN(date.getTime()))return "Ahora"; const pad=n=>n<10?`0${n}`:`${n}`; return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function supportContact(){const s=window.mesaConfig?.support;return s?[s.extension?'Ext. '+s.extension:'',s.email,s.hours].filter(Boolean).join(' · '):'Consulta al equipo de Sistemas.';}
function showPublic(){
  const token=sessionStorage.getItem('mesaTiToken');
  if(token)fetch('/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
  sessionStorage.removeItem('mesaTiToken');sessionUser=null;ticketVersion++;tickets=[];ticketSummary=null;ticketCategories=[];
  list.replaceChildren();closeDetail();closeLogin();document.querySelector('#publicPortal').hidden=false;document.querySelector('#adminShell').hidden=true;
  document.dispatchEvent(new Event('mesa:session-changed'));window.scrollTo({top:0,behavior:'smooth'});
}
function setAdminView(view) {
  document.querySelector('#adminShell').classList.toggle('pending-active',view==='pending');
  for (const [id,name] of [['pendingPage','pending'],['dashboard','tickets'],['inventoryPage','inventory'],['reportsPage','reports'],['maintenancePage','maintenance'],['settingsPage','settings']]) {const page=document.getElementById(id);if(page)page.hidden=name!==view;}
  document.querySelector('#globalSearch').closest('label').hidden=view!=='tickets';
  document.querySelectorAll('#tickets-nav .nav-item').forEach(link=>{const active=(view==='tickets' && link.dataset.view==='dashboard') || (view==='pending' && link.id==='pendingNav') || (view==='inventory' && link.id==='inventoryNav') || (view==='reports' && link.id==='reportsNav') || (view==='maintenance' && link.id==='maintenanceNav') || (view==='settings' && link.id==='settingsNav');link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.dispatchEvent(new CustomEvent('mesa:view',{detail:view}));
}
async function showAdmin(){
  try{sessionUser=(await api('/api/auth/session')).user;
    document.querySelector('.sidebar-user > div > strong').textContent=sessionUser.username;
    document.querySelector('.sidebar-user > div > p').textContent=sessionUser.is_admin?'Administrador':'Técnico de TI';
    document.querySelector('.sidebar-user .avatar').textContent=sessionUser.username.slice(0,2).toUpperCase();
    document.querySelector('#dashboard .page-heading h1').textContent=`Hola, ${sessionUser.username}`;
    document.querySelector('#publicPortal').hidden=true;document.querySelector('#adminShell').hidden=false;setAdminView('tickets');
    document.dispatchEvent(new Event('mesa:session-changed'));window.scrollTo(0,0);await reloadTickets();
  }catch(error){showToast('Acceso de TI',error.message);}
}
function requestAdminAccess() { if (sessionStorage.getItem("mesaTiToken")) return showAdmin(); loginModal.hidden = false; document.querySelector("#loginError").hidden = true; document.body.style.overflow = "hidden"; setTimeout(() => loginModal.querySelector("input[name='username']").focus(), 50); }
function closeLogin() { loginModal.hidden = true; document.body.style.overflow = ""; document.querySelector("#loginForm").reset(); }
function openReceipt(ticket) { receiptTicket=ticket; document.querySelector("#receiptCode").textContent = ticket.id; document.querySelector("#receiptSubject").textContent = ticket.title; document.querySelector("#receiptCategory").textContent = ticket.category; document.querySelector("#receiptDate").textContent = mobileSafeDate(); receiptModal.removeAttribute("hidden"); receiptModal.style.display="grid"; document.body.style.overflow = "hidden"; }
function closeReceipt() { receiptModal.hidden = true; receiptModal.style.display=""; document.body.style.overflow = ""; }
function safe(value){ const node=document.createElement("div"); node.textContent=value??""; return node.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
let detailOpener=null;
async function openDetail(code){ const opening=detailModal.hidden;if(opening)detailOpener=document.activeElement;try{ activeTicket=normalize(await api(`/api/tickets/${encodeURIComponent(code)}`)); document.querySelector("#detailCode").textContent=activeTicket.id; document.querySelector("#detailCreated").textContent=`Creado: ${activeTicket.date}`; document.querySelector("#detailSubject").textContent=activeTicket.title; document.querySelector("#detailDescription").textContent=activeTicket.description; document.querySelector("#detailRequester").textContent=activeTicket.requester; document.querySelector("#detailArea").textContent=activeTicket.area; const form=document.querySelector("#detailForm"); form.querySelector('[name="status"]').value=activeTicket.status; form.querySelector('[name="priority"]').value=activeTicket.priority; form.querySelector('[name="assignee"]').value=activeTicket.assignee||""; document.querySelector("#attachmentList").innerHTML=(activeTicket.attachments||[]).map(a=>`<button class="attachment-link" data-attachment="${a.id}" data-name="${safe(a.name)}">⇩ ${safe(a.name)} (${Math.ceil(a.size/1024)} KB)</button>`).join("")||'<small>Sin archivos adjuntos</small>'; document.querySelector("#commentList").innerHTML=(activeTicket.comments||[]).map(c=>`<article class="comment"><p>${safe(c.body)}</p><small>${safe(c.author)} · ${mobileSafeDate(c.created_at)}</small></article>`).join("")||'<p class="empty-comments">Aún no hay comentarios.</p>'; detailModal.hidden=false; document.dispatchEvent(new Event('mesa:ticket-opened')); document.body.style.overflow="hidden";if(opening)detailModal.querySelector('.close-button').focus(); }catch(error){ showToast("Error",error.message); } }
function closeDetail(){ detailModal.hidden=true; document.body.style.overflow=""; activeTicket=null;detailOpener?.focus(); }

document.querySelectorAll("[data-action='new-ticket']").forEach(button => button.addEventListener("click", event => { event.preventDefault(); openModal(); }));
document.querySelectorAll("[data-action='public-home']").forEach(button => button.addEventListener("click", event => { event.preventDefault(); showPublic(); }));
document.querySelectorAll("[data-action='admin-view']").forEach(button => button.addEventListener("click", requestAdminAccess));
document.querySelectorAll("[data-action='track']").forEach(button => button.addEventListener("click", () => document.querySelector("#lookupSection").scrollIntoView({ behavior: "smooth" })));
document.querySelectorAll("[data-action='solutions']").forEach(button => button.addEventListener("click", () => { showPublic(); setTimeout(() => document.querySelector(".service-section").scrollIntoView({ behavior: "smooth" }), 20); }));
document.querySelectorAll("[data-action='contact']").forEach(button => button.addEventListener("click", () => showToast("Contacto de TI", supportContact())));
document.querySelector('.service-grid').addEventListener('click',event=>{const button=event.target.closest('.service-card');if(!button)return;openModal();modal.querySelector("select[name='category']").value=button.dataset.category;});
document.querySelectorAll("[data-action='close-modal']").forEach(button => button.addEventListener("click", closeModal));
document.querySelectorAll("[data-action='close-receipt']").forEach(button => button.addEventListener("click", closeReceipt));
document.querySelectorAll("[data-action='close-login']").forEach(button => button.addEventListener("click", closeLogin));
document.querySelectorAll("[data-action='close-detail']").forEach(button => button.addEventListener("click", closeDetail));
modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
loginModal.addEventListener("click", event => { if (event.target === loginModal) closeLogin(); });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.hidden) closeModal(); });

document.querySelector("#togglePassword").addEventListener("click", () => { const input = loginModal.querySelector("input[name='password']"); input.type = input.type === "password" ? "text" : "password"; });
document.querySelector("#loginForm").addEventListener("submit", async event => { event.preventDefault(); const data = new FormData(event.currentTarget); try { const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({username:data.get("username"),password:data.get("password")})}); sessionStorage.setItem("mesaTiToken",result.token); closeLogin(); await showAdmin(); showToast("Acceso autorizado", "Bienvenido al panel de TI."); } catch(error) { document.querySelector("#loginError").textContent=error.message; document.querySelector("#loginError").hidden=false; loginModal.querySelector("input[name='password']").value=""; loginModal.querySelector("input[name='password']").focus(); } });

document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-filter]").forEach(item => item.classList.remove("active"));
  button.classList.add("active"); state.filter = button.dataset.filter; reloadTickets();
}));
document.querySelector("#categoryFilter").addEventListener("change", event => { state.category = event.target.value; reloadTickets(); });
let searchTimer;
document.querySelector('#globalSearch').addEventListener('input',event=>{state.search=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(reloadTickets,250);});
document.querySelector("#menuButton").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.querySelector(".notification").addEventListener("click", () => showToast("Notificaciones", "No tienes notificaciones nuevas."));
document.querySelectorAll("[data-panel]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active")); link.classList.add("active"); showToast(link.dataset.panel, "Esta sección se conectará con la base de datos en la siguiente etapa."); }));
document.querySelectorAll("[data-view]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); setAdminView('tickets'); window.scrollTo({ top: 0, behavior: "smooth" }); renderTickets(); }));
list.addEventListener("click", event => { const row = event.target.closest(".ticket-row"); if (!row) return; const folio = row.querySelector(".ticket-title span").textContent.split(" · ")[0]; openDetail(folio); });

document.querySelector("#detailForm").addEventListener("submit",async event=>{ event.preventDefault(); if(!activeTicket)return; const code=activeTicket.id,form=event.currentTarget,button=form.querySelector('.primary-button');const data={status:form.querySelector('[name="status"]').value,priority:form.querySelector('[name="priority"]').value,assignee:form.querySelector('[name="assignee"]').value};const deviceSelect=form.querySelector("[name=device_id]"); if(deviceSelect && !deviceSelect.disabled)data.device_id=deviceSelect.value ? Number(deviceSelect.value) : null;button.disabled=true;button.textContent="Guardando...";try{await api(`/api/admin/tickets/${encodeURIComponent(code)}`,{method:"PATCH",body:JSON.stringify(data)});await loadTickets();await openDetail(code);showToast("Cambios guardados",`${code} fue actualizado correctamente.`)}catch(error){showToast("No se pudo guardar",error.message)}finally{button.disabled=false;button.textContent="Guardar cambios"} });
document.querySelector('#commentForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!activeTicket)return;const form=event.currentTarget,button=form.querySelector('button'),code=activeTicket.id;
  if(button.disabled)return;const body=new FormData(form).get('body');button.disabled=true;
  try{await api(`/api/admin/tickets/${code}/comments`,{method:'POST',body:JSON.stringify({body})});form.reset();await openDetail(code);showToast('Comentario agregado','El seguimiento quedó registrado.');}
  catch(error){showToast('Error',error.message);}finally{button.disabled=false;}
});
document.querySelector("#deleteTicket").addEventListener("click",async()=>{ if(!activeTicket||!confirm(`¿Archivar ${activeTicket.id}? Se quitará del panel de tickets y se conservará en Reportes.`))return; try{ await api(`/api/admin/tickets/${activeTicket.id}`,{method:"DELETE"}); closeDetail(); await loadTickets(); showToast("Ticket archivado","El ticket y su historial se conservan en Reportes."); }catch(error){showToast("Error",error.message)} });
document.querySelector("#attachmentList").addEventListener("click",async event=>{ const button=event.target.closest("[data-attachment]");if(!button)return;try{const response=await fetch(`/api/admin/attachments/${button.dataset.attachment}`,{headers:{Authorization:`Bearer ${sessionStorage.getItem("mesaTiToken")}`}});if(!response.ok)throw new Error("No se pudo descargar");const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=url;link.download=button.dataset.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){showToast("Error",error.message)}});

const lookupMode=document.querySelector('#lookupMode');
lookupMode.addEventListener('change',()=>{
  const folio=lookupMode.value==='folio';const label=folio?'Folio':lookupMode.value==='payroll'?'Número de nómina':'Nombre completo';
  document.querySelector('#lookupLabel').textContent=label;
  const input=document.querySelector('#lookupInput');input.value='';input.setAttribute('aria-label',label);input.placeholder=folio?'Ej. TK-1048':lookupMode.value==='payroll'?'Ej. 001234':'Escribe tu nombre completo';
  document.querySelector('#lookupResult').hidden=true;
});
function publicTicketCard(t){
  const fields=[['Solicitante',t.requester],['Número de nómina',t.payroll],['Área',t.area],['Categoría',t.category],['Prioridad',t.priority],['Equipo',t.device_name],['Asignado a',t.assignee],['Creado',mobileSafeDate(t.created_at)],['Actualizado',mobileSafeDate(t.updated_at)]];
  if(t.closed_at)fields.push(['Cerrado',mobileSafeDate(t.closed_at)]);
  return `<article class="public-ticket-card"><header><div><span class="eyebrow">DETALLE DEL TICKET · SOLO LECTURA</span><h3>${safe(t.code)}</h3></div><strong class="public-ticket-status">${safe(t.status)}</strong></header><h4>${safe(t.subject)}</h4><dl>${fields.map(([k,v])=>`<div><dt>${safe(k)}</dt><dd>${safe(v||'No registrado')}</dd></div>`).join('')}</dl><h4>Descripción</h4><p class="public-description">${safe(t.description)}</p><h4>Evidencia adjunta</h4><ul>${(t.attachments||[]).map(a=>`<li>${safe(a.name)} (${Math.ceil(a.size/1024)} KB)</li>`).join('')||'<li>Sin archivos adjuntos</li>'}</ul></article>`;
}
document.querySelector('#lookupForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');if(button.disabled)return;
  const result=document.querySelector('#lookupResult');result.hidden=false;result.textContent='Consultando tickets...';button.disabled=true;
  try{
    const value=document.querySelector('#lookupInput').value.trim();
    if(lookupMode.value==='folio'){
      const t=await api(`/api/tickets/${encodeURIComponent(value.toUpperCase())}`);result.innerHTML=publicTicketCard(t);
    }else{
      const data=await api(`/api/public/tickets?field=${lookupMode.value}&q=${encodeURIComponent(value)}`);
      result.innerHTML=data.tickets.length?`<p>${data.tickets.length} ticket(s) encontrados. Selecciona uno para ver su información.</p>${data.has_more?'<p>Se muestran los 200 tickets más recientes.</p>':''}<div class="public-ticket-results">${data.tickets.map((t,i)=>`<button type="button" class="public-ticket-result" data-result="${i}" aria-expanded="false"><strong>${safe(t.code)} · ${safe(t.subject)}</strong><span>${safe(t.status)} · ${safe(mobileSafeDate(t.created_at))}</span></button>`).join('')}</div><div id="publicTicketDetail"></div>`:'<p>No encontramos tickets. Verifica el nombre completo o número de nómina que registraste al crear la solicitud.</p>';
      result.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>{
        result.querySelectorAll('[data-result]').forEach(item=>item.setAttribute('aria-expanded',String(item===b)));
        const detail=document.querySelector('#publicTicketDetail');detail.innerHTML=publicTicketCard(data.tickets[Number(b.dataset.result)]);detail.tabIndex=-1;detail.focus();
      }));
    }
  }catch(error){result.textContent=error.message||'No fue posible consultar los tickets.';}finally{button.disabled=false;}
});

document.querySelector("#copyCode").addEventListener("click", async () => { const code=receiptTicket.id;let copied=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(code);copied=true}}catch{}if(!copied){const input=document.createElement("input");input.value=code;input.style.position="fixed";input.style.opacity="0";document.body.appendChild(input);input.focus();input.select();input.setSelectionRange(0,999);copied=document.execCommand("copy");input.remove()}if(!copied&&navigator.share){await navigator.share({title:"Folio Mesa TI",text:code});copied=true}showToast(copied?"Folio copiado":"Folio del ticket",copied?`${code} está listo para pegar.`:`Mantén presionado para copiar: ${code}`); });
function receiptCanvas(){
  const ticket=receiptTicket,support=window.mesaConfig?.support;
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f3f9fd';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0879d9';ctx.fillRect(0,0,24,canvas.height);
  function line(text,y,size=24,color='#718096',weight=400){ctx.fillStyle=color;let font=size;do{ctx.font=`${weight} ${font}px Arial`;if(ctx.measureText(text).width<=1020)break;font--;}while(font>14);if(ctx.measureText(text).width>1020){while(ctx.measureText(text+'…').width>1020)text=text.slice(0,-1);text+='…';}ctx.fillText(text,90,y);}
  line(`MESA TI · ${support?.site_name||'Soporte interno'}`,85,34,'#172235',700);
  line('COMPROBANTE DE SOLICITUD',145);line(ticket.id,260,86,'#0879d9',700);
  line(ticket.title,330,32,'#172235');line(`${ticket.category} · ${ticket.priority} · ${document.querySelector('#receiptDate').textContent}`,390);
  line('Conserva este folio para consultar el seguimiento.',460);
  if(support){line(`Soporte: ${support.technician_name}`,515);line(support.extension?'Ext. '+support.extension:'',560);line(support.email||'',605);line(`Horario: ${support.hours}`,660);}
  return canvas;
}
document.querySelector("#downloadImage").addEventListener("click",()=>{if(!receiptTicket)return;try{const link=document.createElement("a");link.download=`${receiptTicket.id}.jpg`;link.href=receiptCanvas().toDataURL("image/jpeg",.94);document.body.appendChild(link);link.click();link.remove();showToast("Imagen preparada",`Se descargó ${receiptTicket.id}.jpg`)}catch(error){showToast("No se pudo guardar",error.message)}});
document.querySelector('#downloadPdf').addEventListener('click',async()=>{if(!receiptTicket)return;try{await downloadFile(`/api/tickets/${encodeURIComponent(receiptTicket.id)}/receipt.pdf`,`${receiptTicket.id}.pdf`);}catch(error){showToast('No se pudo descargar',error.message);}});

document.querySelector("#ticketForm").addEventListener("submit", async event => {
  event.preventDefault(); const element=event.currentTarget;const form = new FormData(element); const submit=element.querySelector("button[type='submit']");if(submit.disabled)return; submit.disabled=true; submit.textContent="Guardando...";
  let created=null;
  try { const files=document.querySelector("#attachments").files;if(files.length>5)throw new Error("Puedes adjuntar máximo 5 archivos");if([...files].reduce((n,f)=>n+f.size,0)>50*1024*1024)throw new Error("Máximo 50 MB de archivos en total");const payload=Object.fromEntries(form.entries());if(!payload.requester.trim()&&!payload.payroll.trim())throw new Error('Ingresa tu nombre o número de nómina');payload.attachments=await encodeFiles(files);created=normalize(await api("/api/tickets",{method:"POST",body:JSON.stringify(payload)}));
  } catch(error){ showToast("No se pudo enviar",error.message); submit.disabled=false; submit.textContent="Crear ticket"; return; }
  openReceipt(created);
  try {
  state.filter = "Todos"; state.category = "Todas"; state.search = "";
  document.querySelectorAll("[data-filter]").forEach((item, index) => item.classList.toggle("active", index === 0));
  document.querySelector("#categoryFilter").value = "Todas"; document.querySelector("#globalSearch").value = "";
  if(!document.querySelector('#adminShell').hidden)await reloadTickets(); closeModal(); element.reset(); document.querySelector("#fileLabel").textContent="Haz clic para seleccionar hasta 5 archivos (máx. 10 MB cada uno)";
  } catch(error){ closeModal(); showToast(`Ticket creado: ${created.id}`,"Guarda este folio para consultar el seguimiento."); console.error(error); } finally { submit.disabled=false; submit.textContent="Crear ticket"; }
});
document.querySelector("#attachments").addEventListener("change",event=>{const names=[...event.target.files].map(f=>f.name);document.querySelector("#fileLabel").textContent=names.length?`${names.length} archivo(s): ${names.join(', ')}`:"Haz clic para seleccionar hasta 5 archivos (máx. 10 MB cada uno)";});

renderTickets();

document.addEventListener("keydown",event=>{if(detailModal.hidden)return;if(event.key==="Escape"){event.preventDefault();closeDetail();return}if(event.key!=="Tab")return;const nodes=[...detailModal.querySelectorAll("button,input,select,textarea,a[href]")].filter(el=>!el.disabled&&el.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}});
