(() => {
  const $=s=>document.querySelector(s);
  const esc=value=>safe(String(value??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const dateLabel=value=>value?new Date(value+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}):'Sin registrar';
  const dateTime=value=>new Date(value).toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
  const labels={overdue:'Vencido',today:'Hoy',soon:'Próximo (30 días)',scheduled:'Programado',unscheduled:'Sin programar'};
  const page=document.createElement('section');page.id='maintenancePage';page.className='page';page.hidden=true;
  page.innerHTML=`<div class="page-heading"><div><span class="eyebrow">CUIDADO DE EQUIPOS</span><h1>Mantenimiento</h1><p>Organiza las revisiones y conserva el trabajo realizado en cada equipo.</p></div><div class="report-actions"><button id="maintRefresh" class="secondary-button">Actualizar</button><button id="maintAdd" class="primary-button" disabled>Registrar mantenimiento</button></div></div><div class="maint-stats" id="maintStats"></div><p id="maintLoad" class="maint-loading" role="status" hidden></p><p id="maintError" class="maint-error" role="alert" hidden></p><section class="panel" id="maintContent" hidden><div class="maint-filters"><input id="maintSearch" type="search" aria-label="Buscar equipos en la agenda" placeholder="Nombre, área o responsable…"><select id="maintStatus" data-glide-skip aria-label="Estado del mantenimiento"><option value="">Todos los estados</option>${Object.entries(labels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><span id="maintCount" class="maint-note"></span></div><div id="maintTable" class="maint-table-wrap"></div></section><p class="maint-note">Próximos: revisiones dentro de 30 días. La frecuencia inicial es de 6 meses; puedes ajustarla por equipo o fijar una fecha. Registrar una revisión no cierra sus tickets. Las fechas usan el horario de Ciudad de México.</p>`;
  $('#adminShell .main-content').append(page);
  const dialog=document.createElement('dialog');dialog.id='maintenanceDialog';dialog.className='maint-dialog';dialog.setAttribute('aria-labelledby','maintTitle');
  dialog.innerHTML='<header><div><span class="eyebrow">AGENDA DE SISTEMAS</span><h2 id="maintTitle"></h2></div><button id="maintClose" class="close-button" aria-label="Cerrar mantenimiento">×</button></header><form id="maintForm"><div id="maintFields" class="maint-form-grid"></div><p id="maintFormHint" class="maint-note"></p><p id="maintFormError" class="maint-error" role="alert" hidden></p><footer><button type="button" id="maintCancel" class="secondary-button">Cancelar</button><button type="submit" id="maintSave" class="primary-button">Guardar</button></footer></form>';
  document.body.append(dialog);
  const history=document.createElement('dialog');history.id='deviceHistoryDialog';history.className='maint-dialog history';history.setAttribute('aria-labelledby','deviceHistoryTitle');
  history.innerHTML='<header><div><span class="eyebrow">VIDA DEL EQUIPO</span><h2 id="deviceHistoryTitle">Historial del equipo</h2></div><button id="deviceHistoryClose" class="close-button" aria-label="Cerrar historial del equipo">×</button></header><div id="deviceHistoryBody"></div><footer><button id="deviceHistoryRegister" class="secondary-button" disabled>Registrar mantenimiento</button><button id="deviceHistoryDone" class="primary-button">Cerrar</button></footer>';
  document.body.append(history);
  let devices=[],today='',version=0,historyVersion=0,historyDevice=null,mode='record',opener=null,historyOpener=null,saving=false,formVersion=0;
  function render() {
    $('#maintStats').innerHTML=[['overdue','Vencidos'],['today','Para hoy'],['soon','Próximos 30 días'],['unscheduled','Sin programar']].map(([status,label])=>`<article class="maint-stat"><span>${label}</span><strong>${devices.filter(d=>d.maintenance_status===status).length}</strong></article>`).join('');
    const search=$('#maintSearch').value.trim().toLocaleLowerCase(),status=$('#maintStatus').value;
    const order={overdue:0,today:1,soon:2,unscheduled:3,scheduled:4};
    const rows=devices.filter(d=>(!status || d.maintenance_status===status) && [d.name,d.area,d.owner].join(' ').toLocaleLowerCase().includes(search)).sort((a,b)=>order[a.maintenance_status]-order[b.maintenance_status] || (a.next_maintenance||'').localeCompare(b.next_maintenance||'') || a.name.localeCompare(b.name));
    $('#maintCount').textContent=`${rows.length} equipos`;
    $('#maintAdd').disabled=!devices.length;
    $('#maintTable').innerHTML=rows.length?`<table class="maint-table"><thead><tr>${['Equipo','Área / responsable','Último mantenimiento','Próxima revisión','Estado','Acciones'].map(s=>`<th scope="col">${s}</th>`).join('')}</tr></thead><tbody>${rows.map(d=>`<tr><td><button type="button" class="report-link" data-maint-history="${d.id}">${esc(d.name)}</button><small>${d.kind==='laptop'?'Laptop':'PC de escritorio'}</small></td><td>${esc(d.area)}<small>${esc(d.owner)}</small></td><td>${dateLabel(d.last_maintenance)}</td><td>${d.next_maintenance?dateLabel(d.next_maintenance):'Sin programar'}<small>Cada ${d.maintenance_interval_months} meses</small></td><td><span class="maint-status ${d.maintenance_status}">${labels[d.maintenance_status]}</span></td><td><div class="maint-row-actions"><button class="secondary-button" data-maint-record="${d.id}">Registrar</button><button class="secondary-button" data-maint-plan="${d.id}">Programar</button></div></td></tr>`).join('')}</tbody></table>`:`<div class="maint-empty">${devices.length?'No hay equipos que coincidan con los filtros.':'Agrega dispositivos al inventario para comenzar tu agenda.'}</div>`;
  }
  async function load() {
    const current=++version;$('#maintLoad').hidden=false;$('#maintLoad').textContent='Cargando agenda…';$('#maintError').hidden=true;$('#maintContent').hidden=true;$('#maintAdd').disabled=true;
    try {const data=await api('/api/maintenance');if(current!==version)return;devices=data.devices;today=data.today;render();$('#maintContent').hidden=false;}
    catch(error) {if(current!==version)return;$('#maintError').textContent=error.message;$('#maintError').hidden=false;if(error.message.includes('Sesión'))showPublic();}
    finally {if(current===version)$('#maintLoad').hidden=true;}
  }
  $('#maintenanceNav').addEventListener('click',e=>{e.preventDefault();setAdminView('maintenance');window.scrollTo(0,0);load();});
  $('#maintRefresh').addEventListener('click',load);
  $('#maintSearch').addEventListener('input',render);$('#maintStatus').addEventListener('change',render);
  function formField(name){return $('#maintForm').elements.namedItem(name);}
  function formHint() {const selected=devices.find(d=>d.id===Number(formField('device_id').value));$('#maintFormHint').textContent=selected?mode==='record'?`Si dejas la próxima revisión vacía se calculará ${selected.maintenance_interval_months} meses después del mantenimiento. Un registro anterior al último se conserva sin cambiar la agenda.`:'Sin fecha manual, se calcula desde el último mantenimiento según la frecuencia. Si aún no hay mantenimiento, selecciona una fecha para programarlo.':'';}
  async function openForm(nextMode,id=null) {
    if(saving)return;
    const current=++formVersion,session=sessionStorage.getItem('mesaTiToken');
    opener=document.activeElement;mode=nextMode;
    // Refresh before opening so an inventory edit is reflected in the selected device.
    try {const data=await api('/api/maintenance');if(current!==formVersion || session!==sessionStorage.getItem('mesaTiToken'))return;devices=data.devices;today=data.today;}catch(error){if(current===formVersion)showToast('No se pudo abrir',error.message);return;}
    if(!devices.length){showToast('Sin dispositivos','Agrega un equipo al inventario.');return;}
    const selected=devices.find(d=>d.id===Number(id));
    $('#maintTitle').textContent=mode==='record'?'Registrar mantenimiento':'Programar revisión';
    $('#maintFormError').hidden=true;
    $('#maintFields').innerHTML=`<label class="wide">Dispositivo<select name="device_id" data-glide-skip required><option value="">Selecciona un equipo</option>${devices.map(d=>`<option value="${d.id}">${esc(d.name)} · ${esc(d.area)}</option>`).join('')}</select></label>`+(mode==='record'?`<label>Fecha del trabajo realizado<input name="performed_on" type="date" max="${today}" value="${today}" required></label><label>Tipo de mantenimiento<select name="kind" data-glide-skip><option>Preventivo</option><option>Correctivo</option></select></label><label class="wide">Trabajo realizado<textarea name="work" rows="4" maxlength="4000" placeholder="Limpieza, actualizaciones, piezas cambiadas, pruebas…" required></textarea></label><label>Realizado por<input name="technician" maxlength="200" required></label><label>Próxima revisión (opcional)<input name="next_maintenance" type="date"></label>`:`<label>Frecuencia en meses<input name="interval_months" type="number" min="1" max="24" step="1" value="${selected?.maintenance_interval_months||6}" required></label><label>Próxima revisión (opcional)<input name="next_maintenance" type="date" value="${selected?.next_maintenance||''}"></label>`);
    formField('device_id').value=selected?.id||'';
    if(mode==='record')formField('technician').value=$('.sidebar-user > div > strong')?.textContent||'Sistemas';
    formField('device_id').addEventListener('change',()=>{if(mode==='plan'){const d=devices.find(d=>d.id===Number(formField('device_id').value));formField('interval_months').value=d?.maintenance_interval_months||6;formField('next_maintenance').value=d?.next_maintenance||'';}formHint();});
    formHint();dialog.showModal();formField(selected?(mode==='record'?'work':'interval_months'):'device_id').focus();
  }
  function closeForm() {if(saving)return;dialog.close();opener?.focus();}
  $('#maintClose').addEventListener('click',closeForm);$('#maintCancel').addEventListener('click',closeForm);dialog.addEventListener('cancel',e=>{e.preventDefault();closeForm();});
  $('#maintAdd').addEventListener('click',()=>openForm('record'));
  page.addEventListener('click',e=>{const b=e.target.closest('[data-maint-record],[data-maint-plan],[data-maint-history]');if(!b)return;if(b.dataset.maintHistory)openHistory(Number(b.dataset.maintHistory));else openForm(b.dataset.maintPlan?'plan':'record',Number(b.dataset.maintPlan||b.dataset.maintRecord));});
  $('#maintForm').addEventListener('submit',async e=>{
    e.preventDefault();if(saving)return;saving=true;$('#maintSave').disabled=true;$('#maintFormError').hidden=true;
    const payload=Object.fromEntries(new FormData(e.currentTarget));payload.device_id=Number(payload.device_id);
    try {await api(`/api/maintenance/${mode==='record'?'records':'plan'}`,{method:'POST',body:JSON.stringify(payload)});dialog.close();showToast(mode==='record'?'Mantenimiento registrado':'Revisión programada','La agenda y el historial del equipo están actualizados.');document.dispatchEvent(new CustomEvent('mesa:devices-changed',{detail:payload.device_id}));if(!page.hidden)await load();if(history.open && historyDevice===payload.device_id)await loadHistory(payload.device_id);opener?.focus();}
    catch(error){$('#maintFormError').textContent=error.message;$('#maintFormError').hidden=false;}
    finally{saving=false;$('#maintSave').disabled=false;}
  });
  async function loadHistory(id) {
    const current=++historyVersion;historyDevice=id;$('#deviceHistoryBody').textContent='Cargando historial…';$('#deviceHistoryRegister').disabled=true;
    try {
      const data=await api(`/api/devices/${id}/history`);if(current!==historyVersion || !history.open)return;const d=data.device;
      $('#deviceHistoryTitle').textContent=d.name;
      $('#deviceHistoryBody').innerHTML=`<p class="maint-note">${esc(d.area)} · ${esc(d.owner)}</p><div class="maint-history-summary"><span>Último mantenimiento: ${dateLabel(d.last_maintenance)}</span><span>Próxima revisión: ${d.next_maintenance?dateLabel(d.next_maintenance):'Sin programar'}</span><span class="maint-status ${d.maintenance_status}">${labels[d.maintenance_status]}</span></div><section class="maint-history-section"><h3>Tickets del equipo (${data.tickets.length})</h3><ul class="maint-history-list">${data.tickets.map(t=>`<li><button type="button" class="report-link" data-device-ticket="${esc(t.code)}">${esc(t.code)} · ${esc(t.subject)}</button><small>${esc(t.status)}${t.deleted_at?' · Archivado':''} · Apertura: ${dateTime(t.created_at)}${t.closed_at?' · Cierre: '+dateTime(t.closed_at):''}</small></li>`).join('')||'<li class="maint-note">No hay tickets vinculados a este equipo.</li>'}</ul></section><section class="maint-history-section"><h3>Mantenimientos realizados (${data.maintenance.length})</h3><ul class="maint-history-list">${data.maintenance.map(m=>`<li><strong>${dateLabel(m.performed_on)} · ${esc(m.kind)}</strong><p>${esc(m.work)}</p><small>Realizado por: ${esc(m.technician)} · Registrado: ${dateTime(m.created_at)}</small><small>Próxima revisión prevista al registrarlo: ${dateLabel(m.next_due)}</small></li>`).join('')||`<li class="maint-note">No hay trabajos registrados.${d.last_maintenance?' La fecha de último mantenimiento procede del inventario y no tiene detalles históricos.':''}</li>`}</ul></section>`;
      $('#deviceHistoryRegister').disabled=false;
    } catch(error){if(current===historyVersion)$('#deviceHistoryBody').textContent=error.message;}
  }
  function openHistory(id) {historyOpener=document.activeElement;$('#deviceHistoryTitle').textContent='Historial del equipo';history.showModal();loadHistory(id);}
  function closeHistory(){historyVersion++;historyDevice=null;history.close();historyOpener?.focus();}
  $('#deviceHistoryClose').addEventListener('click',closeHistory);$('#deviceHistoryDone').addEventListener('click',closeHistory);history.addEventListener('cancel',e=>{e.preventDefault();closeHistory();});
  $('#deviceHistoryRegister').addEventListener('click',()=>openForm('record',historyDevice));
  history.addEventListener('click',e=>{const b=e.target.closest('[data-device-ticket]');if(b)document.dispatchEvent(new CustomEvent('mesa:report-ticket',{detail:b.dataset.deviceTicket}));});
  document.addEventListener('mesa:device-history',e=>openHistory(e.detail));

  // Public requests accept a typed name; only authenticated TI sessions receive suggestions.
  const ticketLabel=document.createElement('label');ticketLabel.innerHTML='Computadora relacionada (opcional)<input name="device_name" maxlength="200" list="ticketDeviceNames" placeholder="Ej. PC-ALMACEN-01" autocomplete="off"><datalist id="ticketDeviceNames"></datalist><small id="ticketDeviceHint">Escribe el nombre de la computadora si lo conoces. Puedes dejarlo vacío.</small>';
  $('#ticketForm [name=subject]').closest('label').after(ticketLabel);
  const detailLabel=document.createElement('label');detailLabel.innerHTML='Dispositivo relacionado<select name="device_id" data-glide-skip><option value="">Sin dispositivo relacionado</option></select><small id="ticketLinkedHint" class="maint-note"></small>';
  $('#detailForm .primary-button').before(detailLabel);
  let ticketVersion=0;
  document.addEventListener('mesa:new-ticket',async()=>{
    const current=++ticketVersion;$('#ticketDeviceNames').textContent='';if(!sessionStorage.getItem('mesaTiToken'))return;
    try {const list=await api('/api/devices');if(current!==ticketVersion)return;$('#ticketDeviceNames').innerHTML=list.map(d=>`<option value="${esc(d.name)}">${esc(d.area)}</option>`).join('');}catch{}
  });
  document.addEventListener('mesa:ticket-opened',async()=>{
    const current=++ticketVersion,ticket=activeTicket,select=detailLabel.querySelector('select');
    select.disabled=true;select.innerHTML=ticket.device_id?`<option value="${ticket.device_id}">${esc(ticket.device_name)}</option>`:'<option value="">Sin dispositivo relacionado</option>';
    $('#ticketLinkedHint').textContent=ticket.device_name && !ticket.device_id?`Nombre indicado en la solicitud: ${ticket.device_name}. Puedes vincularlo aquí.`:'';
    try {const list=await api('/api/devices');if(current!==ticketVersion || activeTicket?.id!==ticket.id)return;select.innerHTML='<option value="">Sin dispositivo relacionado</option>'+list.map(d=>`<option value="${d.id}">${esc(d.name)} · ${esc(d.area)}</option>`).join('');select.value=ticket.device_id??'';select.disabled=false;}catch(error){if(current===ticketVersion)$('#ticketLinkedHint').textContent=error.message;}
  });
  document.addEventListener('mesa:view',e=>{if(e.detail!=='maintenance'){version++;formVersion++;if(dialog.open && !saving)closeForm();if(history.open)closeHistory();}});
  new MutationObserver(()=>{if($('#adminShell').hidden){version++;historyVersion++;ticketVersion++;formVersion++;dialog.close();history.close();devices=[];historyDevice=null;page.hidden=true;$('#maintTable').textContent='';$('#deviceHistoryBody').textContent='';$('#ticketDeviceNames').textContent='';detailLabel.querySelector('select').innerHTML='<option value="">Sin dispositivo relacionado</option>';}}).observe($('#adminShell'),{attributes:true,attributeFilter:['hidden']});
})();
