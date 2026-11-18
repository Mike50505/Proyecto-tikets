(() => {
  const $=selector=>document.querySelector(selector);
  const esc=value=>safe(String(value??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dateLabel=value=>new Date(value+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  let items=[],version=0,editing=null,busy=false,opener=null,loaded=false;
  const page=document.createElement('section');page.id='pendingPage';page.className='page pending-page';page.hidden=true;
  page.innerHTML=`<div class="pending-heading"><h1>Pendientes</h1><span id="pendingSummary" role="status"></span></div>
    <div class="pending-toolbar"><div class="pending-date-controls"><input type="date" id="pendingDate" aria-label="Fecha" required><button id="pendingToday" class="secondary-button">Hoy</button><select id="pendingScope" data-glide-skip aria-label="Vista de pendientes"><option value="day">Fecha y anteriores</option><option value="all">Todos</option></select></div><div class="pending-tools"><input id="pendingSearch" type="search" aria-label="Buscar pendientes" placeholder="Buscar pendientes"><button id="pendingRefresh" class="secondary-button" aria-label="Actualizar pendientes">Actualizar</button></div></div>
    <form id="pendingQuick" class="pending-quick"><input id="pendingQuickTitle" aria-label="Nuevo pendiente" maxlength="180" placeholder="Escribe un pendiente..." required autocomplete="off"><button type="submit" class="primary-button">Agregar</button><button type="button" id="pendingAdd" class="secondary-button" title="Agregar con fecha, responsable y notas">Con detalles</button></form>
    <p id="pendingError" class="pending-error" role="alert" hidden></p><p id="pendingLoading" role="status" hidden>Cargando pendientes...</p>
    <div class="pending-board" id="pendingBoard" aria-label="Lista de pendientes" hidden></div>`;
  $('#adminShell .main-content').append(page);$('#pendingDate').value=today();
  const dialog=document.createElement('dialog');dialog.id='pendingDialog';dialog.className='pending-dialog';dialog.setAttribute('aria-labelledby','pendingDialogTitle');
  dialog.innerHTML=`<form id="pendingForm"><header><div><span class="eyebrow">PIZARRÓN DEL EQUIPO</span><h2 id="pendingDialogTitle">Nuevo pendiente</h2></div><button type="button" id="pendingClose" class="close-button" aria-label="Cerrar pendiente">×</button></header><label>¿Qué hay que hacer? (obligatorio)<input name="title" maxlength="180" required autocomplete="off"></label><div class="pending-form-row"><label>Fecha (obligatoria)<input name="due_date" type="date" required></label><label>Responsable<input name="assignee" maxlength="100" placeholder="Sin asignar" autocomplete="off"></label></div><label>Estado<select name="status" data-glide-skip><option value="todo">Por hacer</option><option value="doing">En curso</option><option value="done">Hecho</option></select></label><label>Notas y seguimiento<textarea name="notes" rows="5" maxlength="5000" placeholder="Anota el avance, lo que falta o el siguiente paso."></textarea></label><p class="pending-note" id="pendingUpdated"></p><p class="pending-error" id="pendingFormError" role="alert" hidden></p><footer><button type="button" id="pendingArchive" class="secondary-button pending-archive">Archivar</button><button type="button" id="pendingCancel" class="secondary-button">Cancelar</button><button type="submit" id="pendingSave" class="primary-button">Guardar pendiente</button></footer></form>`;
  document.body.append(dialog);
  function error(message){$('#pendingError').textContent=message;$('#pendingError').hidden=!message;}
  function render(){
    const done=items.filter(t=>t.status==='done').length;
    $('#pendingSummary').textContent=`${done} de ${items.length} completados`;
    const search=$('#pendingSearch').value.trim().toLocaleLowerCase('es');
    const filtered=items.filter(t=>[t.title,t.notes,t.assignee].join(' ').toLocaleLowerCase('es').includes(search));
    $('#pendingBoard').innerHTML=`<section class="pending-checklist" aria-label="Pendientes"><div class="pending-rows">${filtered.map(t=>`<article class="pending-card pending-${t.status}" data-task="${t.id}"><div class="pending-row-content"><label class="pending-card-top"><input type="checkbox" data-check="${t.id}" aria-label="${t.status==='done'?'Reabrir':'Completar'}: ${esc(t.title)}" ${t.status==='done'?'checked':''}><span class="pending-task-title">${esc(t.title)}</span></label>${t.notes?`<p class="pending-card-notes">${esc(t.notes)}</p>`:''}<div class="pending-card-meta"><span class="${t.due_date<today()&&t.status!=='done'?'pending-overdue':''}">${t.due_date<today()&&t.status!=='done'?'Pendiente desde ':''}${dateLabel(t.due_date)}</span><span>${esc(t.assignee||'Sin asignar')}</span>${t.status==='doing'?'<span>En curso</span>':''}${t.status==='done'?'<span>Completado</span>':''}</div></div><button class="secondary-button" data-edit="${t.id}" aria-label="Editar pendiente: ${esc(t.title)}">Ver / editar</button></article>`).join('')||`<p class="pending-list-empty">${search?'Sin coincidencias':'Agrega tu primer pendiente y marca lo que vayas terminando.'}</p>`}</div></section>`;
  }
  async function load(){
    if(!sessionUser)return false;
    const current=++version;loaded=false;error('');$('#pendingLoading').hidden=false;$('#pendingBoard').hidden=true;
    try{
      const query=new URLSearchParams({scope:$('#pendingScope').value,date:$('#pendingDate').value});
      const data=await api('/api/pending?'+query);
      if(current!==version||!sessionUser)return false;
      items=data.items;loaded=true;render();$('#pendingBoard').hidden=false;return true;
    }catch(e){if(current===version)error(e.message);return false;}
    finally{if(current===version)$('#pendingLoading').hidden=true;}
  }
  function open(task=null){
    if(busy)return;editing=task;opener=document.activeElement;const form=$('#pendingForm');form.reset();
    for(const key of ['title','notes','assignee'])form.elements[key].value=task?.[key]||'';
    form.elements.due_date.value=task?.due_date||($('#pendingScope').value==='day'?$('#pendingDate').value:today());
    form.elements.status.value=task?.status||'todo';form.elements.status.disabled=!task;
    $('#pendingDialogTitle').textContent=task?'Seguimiento del pendiente':'Nuevo pendiente';
    $('#pendingArchive').hidden=!task;$('#pendingFormError').hidden=true;
    $('#pendingUpdated').textContent=task?`Último cambio: ${task.updated_by} · ${new Date(task.updated_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}`:'Se guardará en el pizarrón compartido del equipo.';
    dialog.showModal();form.elements.title.focus();
  }
  function close(){if(busy)return;dialog.close();editing=null;if(opener?.isConnected)opener.focus();}
  function lock(value){busy=value;$('#pendingForm').querySelectorAll('button').forEach(b=>b.disabled=value);$('#pendingBoard').querySelectorAll('button,input').forEach(b=>b.disabled=value);$('#pendingQuick button').disabled=value;$('#pendingAdd').disabled=value;$('#pendingSave').textContent=value?'Guardando…':'Guardar pendiente';}
  async function change(task,values){
    return api('/api/pending/'+task.id,{method:'PATCH',body:JSON.stringify({...values,revision:task.revision})});
  }
  $('#pendingNav').addEventListener('click',event=>{event.preventDefault();setAdminView('pending');$('#sidebar').classList.remove('open');window.scrollTo(0,0);load();});
  $('#pendingAdd').addEventListener('click',()=>open());
  $('#pendingClose').addEventListener('click',close);$('#pendingCancel').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#pendingRefresh').addEventListener('click',load);
  $('#pendingDate').addEventListener('change',()=>{if($('#pendingDate').value)load();});
  $('#pendingScope').addEventListener('change',()=>{$('#pendingDate').disabled=$('#pendingScope').value==='all';load();});
  $('#pendingToday').addEventListener('click',()=>{$('#pendingDate').value=today();$('#pendingDate').disabled=false;$('#pendingScope').value='day';load();});
  $('#pendingSearch').addEventListener('input',()=>{if(loaded)render();});
  $('#pendingQuick').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;lock(true);error('');const field=$('#pendingQuickTitle');
    try{await api('/api/pending',{method:'POST',body:JSON.stringify({title:field.value,due_date:$('#pendingScope').value==='day'?$('#pendingDate').value:today()})});field.value='';$('#pendingSearch').value='';await load();if(sessionUser)showToast('Pendiente agregado','Ya está en el pizarrón del equipo.');}
    catch(e){error(e.message);}finally{lock(false);}
  });
  $('#pendingForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const data=Object.fromEntries(new FormData(event.currentTarget));lock(true);$('#pendingFormError').hidden=true;
    try{if(editing)await change(editing,data);else await api('/api/pending',{method:'POST',body:JSON.stringify(data)});
      lock(false);close();await load();if(sessionUser)showToast('Pendiente guardado','El pizarrón está actualizado.');
    }catch(e){$('#pendingFormError').textContent=e.message;$('#pendingFormError').hidden=false;}finally{lock(false);}
  });
  $('#pendingBoard').addEventListener('click',async event=>{
    const control=event.target.closest('[data-check],[data-start],[data-edit]');if(!control||busy)return;
    const id=control.dataset.check||control.dataset.start||control.dataset.edit,task=items.find(t=>String(t.id)===id);if(!task)return;
    if(control.dataset.edit){open(task);return;}
    control.disabled=true;lock(true);
    try{await change(task,{status:control.dataset.start?'doing':control.checked?'done':'todo'});await load();
      const next=$(`#pendingBoard [data-check="${id}"]`);if(next&&!page.hidden)next.focus();
    }catch(e){error(e.message);if(control.type==='checkbox')control.checked=task.status==='done';}
    finally{control.disabled=false;lock(false);}
  });
  $('#pendingArchive').addEventListener('click',async()=>{
    if(busy||!editing||!confirm('¿Archivar este pendiente? Dejará de aparecer en el pizarrón.'))return;
    lock(true);
    try{await change(editing,{archive:true});lock(false);close();await load();if(sessionUser)showToast('Pendiente archivado','Se retiró del pizarrón.');}
    catch(e){$('#pendingFormError').textContent=e.message;$('#pendingFormError').hidden=false;}finally{lock(false);}
  });
  document.addEventListener('mesa:session-changed',()=>{if(!sessionUser){version++;items=[];loaded=false;$('#pendingBoard').replaceChildren();$('#pendingSearch').value='';$('#pendingQuick').reset();$('#pendingForm').reset();dialog.close();editing=null;error('');}});
})();
