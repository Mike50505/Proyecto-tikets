let tickets = [];
let activeTicket = null;
let receiptTicket = null;

const state = { filter: "Todos", category: "Todas", search: "", limit: 5 };
const list = document.querySelector("#ticketList");
const empty = document.querySelector("#emptyState");
const modal = document.querySelector("#ticketModal");
const receiptModal = document.querySelector("#receiptModal");
const loginModal = document.querySelector("#loginModal");
const detailModal = document.querySelector("#detailModal");

async function api(path, options = {}) { const token=sessionStorage.getItem("mesaTiToken"); const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}}); const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||"No fue posible completar la operación"); return data; }
async function encodeFiles(files){ return Promise.all([...files].map(file=>new Promise((resolve,reject)=>{ if(file.size>10*1024*1024)return reject(new Error(`${file.name} supera 10 MB`)); const reader=new FileReader();reader.onload=()=>resolve({name:file.name,type:file.type||"application/octet-stream",data:String(reader.result).split(',')[1]});reader.onerror=()=>reject(new Error(`No se pudo leer ${file.name}`));reader.readAsDataURL(file); }))); }
function normalize(ticket){ return {...ticket,id:ticket.code||ticket.id,title:ticket.subject||ticket.title,date:ticket.created_at?new Date(ticket.created_at).toLocaleString("es-MX"):ticket.date}; }
async function loadTickets(){ try{ tickets=(await api("/api/tickets")).map(normalize); updateCounters(); renderTickets(); }catch(error){ if(error.message.includes("Sesión")){ sessionStorage.clear(); showPublic(); showToast("Sesión finalizada","Vuelve a ingresar al panel de TI."); }else showToast("Error",error.message); } }
function updateCounters(){ const opened=tickets.filter(t=>t.status==="Abierto").length,progress=tickets.filter(t=>t.status==="En progreso").length; document.querySelector("#openCount").textContent=opened; document.querySelector("#progressCount").textContent=progress; document.querySelector("#openNavCount").textContent=opened; }

function statusClass(status) { return status === "Abierto" ? "open" : status === "En progreso" ? "progress" : "closed"; }
function categorySymbol(category) { return ({ Hardware: "□", Software: "◇", Red: "⌁", Accesos: "♙" })[category] || "?"; }
function renderTickets() {
  const filtered = tickets.filter(ticket =>
    (state.filter === "Todos" || ticket.status === state.filter) &&
    (state.category === "Todas" || ticket.category === state.category) &&
    (`${ticket.id} ${ticket.title} ${ticket.requester}`.toLowerCase().includes(state.search.toLowerCase()))
  ).slice(0, state.limit);
  list.innerHTML = filtered.map(ticket => `
    <article class="ticket-row" tabindex="0">
      <div class="ticket-main"><span class="category-icon">${categorySymbol(ticket.category)}</span><div class="ticket-title"><strong>${safe(ticket.title)}</strong><span>${safe(ticket.id)} · ${safe(ticket.requester)}</span></div></div>
      <div class="ticket-meta category"><strong>${safe(ticket.category)}</strong><span>Categoría</span></div>
      <div><span class="badge ${statusClass(ticket.status)}">${safe(ticket.status)}</span></div>
      <div class="ticket-meta priority"><strong class="priority ${ticket.priority.toLowerCase()}">${safe(ticket.priority)}</strong><span>${safe(ticket.date)}</span></div>
      <span class="chevron">›</span>
    </article>`).join("");
  empty.hidden = filtered.length > 0;
  list.hidden = filtered.length === 0;
}

function openModal() { modal.hidden = false; document.body.style.overflow = "hidden"; setTimeout(() => modal.querySelector("input[name='subject']").focus(), 50); }
function closeModal() { modal.hidden = true; document.body.style.overflow = ""; }
function showToast(title, message) {
  const toast = document.querySelector("#toast");
  toast.querySelector("strong").textContent = title; toast.querySelector("p").textContent = message;
  toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3500);
}
function mobileSafeDate(value = new Date()) { const date=value instanceof Date?value:new Date(value); if(Number.isNaN(date.getTime()))return "Ahora"; const pad=n=>n<10?`0${n}`:`${n}`; return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function showPublic() { sessionStorage.removeItem("mesaTiToken"); document.querySelector("#publicPortal").hidden = false; document.querySelector("#adminShell").hidden = true; window.scrollTo({ top: 0, behavior: "smooth" }); }
async function showAdmin() { document.querySelector("#publicPortal").hidden = true; document.querySelector("#adminShell").hidden = false; window.scrollTo(0, 0); await loadTickets(); }
function requestAdminAccess() { if (sessionStorage.getItem("mesaTiToken")) return showAdmin(); loginModal.hidden = false; document.querySelector("#loginError").hidden = true; document.body.style.overflow = "hidden"; setTimeout(() => loginModal.querySelector("input[name='username']").focus(), 50); }
function closeLogin() { loginModal.hidden = true; document.body.style.overflow = ""; document.querySelector("#loginForm").reset(); }
function openReceipt(ticket) { receiptTicket=ticket; document.querySelector("#receiptCode").textContent = ticket.id; document.querySelector("#receiptSubject").textContent = ticket.title; document.querySelector("#receiptCategory").textContent = ticket.category; document.querySelector("#receiptDate").textContent = mobileSafeDate(); receiptModal.removeAttribute("hidden"); receiptModal.style.display="grid"; document.body.style.overflow = "hidden"; }
function closeReceipt() { receiptModal.hidden = true; receiptModal.style.display=""; document.body.style.overflow = ""; }
function safe(value){ const node=document.createElement("div"); node.textContent=value??""; return node.innerHTML; }
async function openDetail(code){ try{ activeTicket=normalize(await api(`/api/tickets/${encodeURIComponent(code)}`)); document.querySelector("#detailCode").textContent=activeTicket.id; document.querySelector("#detailCreated").textContent=`Creado: ${activeTicket.date}`; document.querySelector("#detailSubject").textContent=activeTicket.title; document.querySelector("#detailDescription").textContent=activeTicket.description; document.querySelector("#detailRequester").textContent=activeTicket.requester; document.querySelector("#detailArea").textContent=activeTicket.area; const form=document.querySelector("#detailForm"); form.querySelector('[name="status"]').value=activeTicket.status; form.querySelector('[name="priority"]').value=activeTicket.priority; form.querySelector('[name="assignee"]').value=activeTicket.assignee||""; document.querySelector("#attachmentList").innerHTML=(activeTicket.attachments||[]).map(a=>`<button class="attachment-link" data-attachment="${a.id}" data-name="${safe(a.name)}">⇩ ${safe(a.name)} (${Math.ceil(a.size/1024)} KB)</button>`).join("")||'<small>Sin archivos adjuntos</small>'; document.querySelector("#commentList").innerHTML=(activeTicket.comments||[]).map(c=>`<article class="comment"><p>${safe(c.body)}</p><small>${safe(c.author)} · ${mobileSafeDate(c.created_at)}</small></article>`).join("")||'<p class="empty-comments">Aún no hay comentarios.</p>'; detailModal.hidden=false; document.body.style.overflow="hidden"; }catch(error){ showToast("Error",error.message); } }
function closeDetail(){ detailModal.hidden=true; document.body.style.overflow=""; activeTicket=null; }

document.querySelectorAll("[data-action='new-ticket']").forEach(button => button.addEventListener("click", event => { event.preventDefault(); openModal(); }));
document.querySelectorAll("[data-action='public-home']").forEach(button => button.addEventListener("click", event => { event.preventDefault(); showPublic(); }));
document.querySelectorAll("[data-action='admin-view']").forEach(button => button.addEventListener("click", requestAdminAccess));
document.querySelectorAll("[data-action='track']").forEach(button => button.addEventListener("click", () => document.querySelector("#lookupSection").scrollIntoView({ behavior: "smooth" })));
document.querySelectorAll("[data-action='solutions']").forEach(button => button.addEventListener("click", () => { showPublic(); setTimeout(() => document.querySelector(".service-section").scrollIntoView({ behavior: "smooth" }), 20); }));
document.querySelectorAll("[data-action='contact']").forEach(button => button.addEventListener("click", () => showToast("Contacto de TI", "Comunícate a la extensión 2401.")));
document.querySelectorAll(".service-card").forEach(button => button.addEventListener("click", () => { openModal(); modal.querySelector("select[name='category']").value = button.dataset.category; }));
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
  button.classList.add("active"); state.filter = button.dataset.filter; renderTickets();
}));
document.querySelector("#categoryFilter").addEventListener("change", event => { state.category = event.target.value; renderTickets(); });
document.querySelector("#globalSearch").addEventListener("input", event => { state.search = event.target.value; renderTickets(); });
document.querySelector("#showAll").addEventListener("click", () => { state.limit = tickets.length; renderTickets(); });
document.querySelector("#menuButton").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.querySelector(".notification").addEventListener("click", () => showToast("Notificaciones", "No tienes notificaciones nuevas."));
document.querySelectorAll("[data-panel]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active")); link.classList.add("active"); showToast(link.dataset.panel, "Esta sección se conectará con la base de datos en la siguiente etapa."); }));
document.querySelectorAll("[data-view]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active")); link.classList.add("active"); if (link.dataset.view === "tickets") { state.limit = tickets.length; document.querySelector(".tickets-panel").scrollIntoView({ behavior: "smooth" }); } else { window.scrollTo({ top: 0, behavior: "smooth" }); } renderTickets(); }));
list.addEventListener("click", event => { const row = event.target.closest(".ticket-row"); if (!row) return; const folio = row.querySelector(".ticket-title span").textContent.split(" · ")[0]; openDetail(folio); });

document.querySelector("#detailForm").addEventListener("submit",async event=>{ event.preventDefault(); if(!activeTicket)return; const code=activeTicket.id,form=event.currentTarget,button=form.querySelector('.primary-button');const data={status:form.querySelector('[name="status"]').value,priority:form.querySelector('[name="priority"]').value,assignee:form.querySelector('[name="assignee"]').value};button.disabled=true;button.textContent="Guardando...";try{await api(`/api/admin/tickets/${encodeURIComponent(code)}`,{method:"PATCH",body:JSON.stringify(data)});await loadTickets();await openDetail(code);showToast("Cambios guardados",`${code} fue actualizado correctamente.`)}catch(error){showToast("No se pudo guardar",error.message)}finally{button.disabled=false;button.textContent="Guardar cambios"} });
document.querySelector("#commentForm").addEventListener("submit",async event=>{ event.preventDefault(); if(!activeTicket)return; const body=new FormData(event.currentTarget).get("body"); try{ await api(`/api/admin/tickets/${activeTicket.id}/comments`,{method:"POST",body:JSON.stringify({body})}); event.currentTarget.reset(); await openDetail(activeTicket.id); showToast("Comentario agregado","El seguimiento quedó registrado."); }catch(error){showToast("Error",error.message)} });
document.querySelector("#deleteTicket").addEventListener("click",async()=>{ if(!activeTicket||!confirm(`¿Eliminar definitivamente ${activeTicket.id}?`))return; try{ await api(`/api/admin/tickets/${activeTicket.id}`,{method:"DELETE"}); closeDetail(); await loadTickets(); showToast("Ticket eliminado","La orden fue eliminada de la base de datos."); }catch(error){showToast("Error",error.message)} });
document.querySelector("#attachmentList").addEventListener("click",async event=>{ const button=event.target.closest("[data-attachment]");if(!button)return;try{const response=await fetch(`/api/admin/attachments/${button.dataset.attachment}`,{headers:{Authorization:`Bearer ${sessionStorage.getItem("mesaTiToken")}`}});if(!response.ok)throw new Error("No se pudo descargar");const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=url;link.download=button.dataset.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){showToast("Error",error.message)}});

document.querySelector("#lookupForm").addEventListener("submit", async event => {
  event.preventDefault(); const folio = document.querySelector("#lookupInput").value.trim().toUpperCase(); const result = document.querySelector("#lookupResult"); result.hidden = false;
  try { const ticket=normalize(await api(`/api/tickets/${encodeURIComponent(folio)}`)); result.innerHTML=`<strong>${ticket.id} · ${ticket.status}</strong>${ticket.title}<br><small>Asignado a: ${ticket.assignee}</small>`; } catch { result.innerHTML=`<strong>Folio no encontrado</strong>Verifica el número o comunícate a la extensión 2401.`; }
});

document.querySelector("#copyCode").addEventListener("click", async () => { const code=document.querySelector("#receiptCode").textContent;let copied=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(code);copied=true}}catch{}if(!copied){const input=document.createElement("input");input.value=code;input.style.position="fixed";input.style.opacity="0";document.body.appendChild(input);input.focus();input.select();input.setSelectionRange(0,999);copied=document.execCommand("copy");input.remove()}if(!copied&&navigator.share){await navigator.share({title:"Folio Mesa TI",text:code});copied=true}showToast(copied?"Código copiado":"Código del ticket",copied?`${code} está listo para pegar.`:`Mantén presionado para copiar: ${code}`); });
function receiptCanvas(){const ticket=receiptTicket;const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=675;const ctx=canvas.getContext("2d");ctx.fillStyle="#f3f9fd";ctx.fillRect(0,0,1200,675);ctx.fillStyle="#0879d9";ctx.fillRect(0,0,24,675);ctx.fillStyle="#172235";ctx.font="700 34px Arial";ctx.fillText("MESA TI · PLANTA MÉXICO",90,100);ctx.fillStyle="#718096";ctx.font="24px Arial";ctx.fillText("COMPROBANTE DE SOLICITUD",90,165);ctx.fillStyle="#0879d9";ctx.font="700 86px Arial";ctx.fillText(ticket.id,90,290);ctx.fillStyle="#172235";ctx.font="32px Arial";ctx.fillText(ticket.title.slice(0,58),90,365);ctx.fillStyle="#718096";ctx.font="24px Arial";ctx.fillText(`${ticket.category} · ${ticket.priority} · ${document.querySelector("#receiptDate").textContent}`,90,435);ctx.fillText("Consulta el seguimiento con este folio · Extensión 2401",90,555);return canvas}
document.querySelector("#downloadImage").addEventListener("click",()=>{if(!receiptTicket)return;try{const link=document.createElement("a");link.download=`${receiptTicket.id}.jpg`;link.href=receiptCanvas().toDataURL("image/jpeg",.94);document.body.appendChild(link);link.click();link.remove();showToast("Imagen preparada",`Se descargó ${receiptTicket.id}.jpg`)}catch(error){showToast("No se pudo guardar",error.message)}});
document.querySelector("#downloadPdf").addEventListener("click",()=>{if(!receiptTicket)return;const url=`/api/tickets/${encodeURIComponent(receiptTicket.id)}/receipt.pdf`;const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener";document.body.appendChild(link);link.click();link.remove()});

document.querySelector("#ticketForm").addEventListener("submit", async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const submit=event.currentTarget.querySelector("button[type='submit']"); submit.disabled=true; submit.textContent="Guardando...";
  let created=null;
  try { const files=document.querySelector("#attachments").files;if(files.length>5)throw new Error("Puedes adjuntar máximo 5 archivos");const payload=Object.fromEntries(form.entries());payload.attachments=await encodeFiles(files);created=normalize(await api("/api/tickets",{method:"POST",body:JSON.stringify(payload)}));
  } catch(error){ showToast("No se pudo enviar",error.message); submit.disabled=false; submit.textContent="Crear ticket"; return; }
  openReceipt(created);
  try { tickets.unshift(created);
  state.filter = "Todos"; state.category = "Todas"; state.search = "";
  document.querySelectorAll("[data-filter]").forEach((item, index) => item.classList.toggle("active", index === 0));
  document.querySelector("#categoryFilter").value = "Todas"; document.querySelector("#globalSearch").value = "";
  updateCounters(); renderTickets(); closeModal(); event.currentTarget.reset(); document.querySelector("#fileLabel").textContent="Haz clic para seleccionar hasta 5 archivos (máx. 10 MB cada uno)";
  } catch(error){ closeModal(); showToast(`Ticket creado: ${created.id}`,"Guarda este folio para consultar el seguimiento."); console.error(error); } finally { submit.disabled=false; submit.textContent="Crear ticket"; }
});
document.querySelector("#attachments").addEventListener("change",event=>{const names=[...event.target.files].map(f=>f.name);document.querySelector("#fileLabel").textContent=names.length?`${names.length} archivo(s): ${names.join(', ')}`:"Haz clic para seleccionar hasta 5 archivos (máx. 10 MB cada uno)";});

renderTickets();
