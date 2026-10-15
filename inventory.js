(() => {
  const icons = {
    desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5M7 21h10"/></svg>',
    laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="13" rx="2"/><path d="M5 16l-3 4h20l-3-4M9 20h6"/></svg>'
  };
  const kinds = {desktop:'PC de escritorio', laptop:'Laptop'};
  const esc = value => safe(String(value ?? '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const page = document.createElement('section');
  page.id = 'inventoryPage'; page.className = 'page'; page.hidden = true;
  page.innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">GESTIÓN DE ACTIVOS</span><h1>Dispositivos</h1><p>Tu inventario de TI, conectado con su ubicación en la planta.</p></div><button id="invAdd" class="primary-button">＋ Agregar dispositivo</button></div>
    <div class="inv-stats" id="invStats"></div>
    <section class="panel">
      <div class="inv-toolbar"><div class="inv-filters"><input id="invSearch" type="search" placeholder="Buscar nombre, responsable o serie…" aria-label="Buscar dispositivos"><select id="invKind" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option><option value="desktop">PC de escritorio</option><option value="laptop">Laptop</option></select><select id="invArea" aria-label="Filtrar por área"><option value="">Todas las áreas</option></select></div><div class="inv-tabs" role="group" aria-label="Vista del inventario"><button data-inv-view="list" aria-pressed="true">Listado</button><button data-inv-view="map" aria-pressed="false">Plano</button></div></div>
      <div id="invPlaceMessage" class="inv-place-message" hidden><span></span><button id="invPlaceCancel" class="secondary-button">Cancelar ubicación</button></div>
      <p id="invLoadStatus" class="inv-empty" role="status" hidden></p>
      <div id="invList" class="inv-table-wrap"></div>
      <div id="invMap" class="inv-map-layout" hidden><div class="inv-map-main"><div class="inv-map-controls"><span class="inv-muted">Bodegas Ramos · Plano V.06</span><button id="invZoomOut" class="secondary-button" aria-label="Alejar plano">−</button><output id="invZoomLabel">100%</output><button id="invZoomIn" class="secondary-button" aria-label="Acercar plano">＋</button><button id="invZoomReset" class="secondary-button">Restablecer</button></div><div class="inv-plan-viewport"><div class="inv-plan" id="invPlan"><img src="Bodegas_Ramos_V06.svg" alt="Plano de la empresa Bodegas Ramos" draggable="false"><div id="invMarkers"></div></div></div><div class="inv-legend"><span class="desktop">${icons.desktop} PC de escritorio</span><span class="laptop">${icons.laptop} Laptop</span></div><p class="inv-muted">Selecciona un marcador para abrir la ficha. Usa el zoom y desplázate por el plano para ver más detalle.</p></div><aside class="inv-map-side"><h3>Sin ubicación en el plano</h3><p class="inv-muted">Selecciona un dispositivo y haz clic en su ubicación.</p><div id="invUnplaced"></div></aside></div>
    </section>`;
  document.querySelector('#adminShell .main-content').append(page);
  const dialog = document.createElement('dialog');
  dialog.id = 'deviceDialog'; dialog.className = 'inv-dialog';
  dialog.setAttribute('aria-labelledby','invDialogTitle');
  dialog.innerHTML = `<header><div><span class="eyebrow">FICHA DEL DISPOSITIVO</span><h2 id="invDialogTitle">Agregar dispositivo</h2><p>Información y acceso para el equipo de Sistemas.</p></div><button class="close-button" id="invClose" type="button" aria-label="Cerrar ficha">×</button></header>
    <form id="invForm"><div class="inv-form-grid">
      <label>Nombre de la computadora<input name="name" maxlength="200" placeholder="Ej. PC-ALMACEN-01" required></label>
      <label>Tipo de dispositivo<select name="kind" data-glide-skip><option value="desktop">PC de escritorio</option><option value="laptop">Laptop</option></select></label>
      <label>Área<input name="area" maxlength="200" list="invAreas" placeholder="Ej. Almacén" required><datalist id="invAreas"></datalist></label>
      <label>Responsable / asignado a<input name="owner" maxlength="200" placeholder="Nombre de la persona" required></label>
      <label>Usuario del equipo<input name="username" maxlength="200" autocomplete="off" placeholder="Ej. empresa\\usuario"></label>
      <label>Contraseña<div class="inv-password"><input name="password" type="password" maxlength="1000" autocomplete="new-password" placeholder="Opcional"><button type="button" id="invReveal" class="secondary-button" aria-label="Mostrar contraseña">Mostrar</button></div><small id="invPasswordHint" class="inv-muted"></small></label>
      <label>Marca / modelo<input name="model" maxlength="200" placeholder="Ej. Dell OptiPlex 7010"></label>
      <label>Número de serie<input name="serial" maxlength="200" placeholder="Serie del fabricante"></label>
      <label>Último mantenimiento<input name="last_maintenance" type="date"></label>
      <label class="inv-wide">Notas<textarea name="notes" rows="3" maxlength="4000" placeholder="Especificaciones, observaciones o detalles del mantenimiento"></textarea></label>
      <div class="inv-wide"><strong>Ubicación en el plano</strong><div class="inv-position-grid"><label>Horizontal (%)<input name="x" type="number" min="0" max="100" step="0.01" placeholder="Sin ubicación"></label><label>Vertical (%)<input name="y" type="number" min="0" max="100" step="0.01" placeholder="Sin ubicación"></label></div><div class="inv-position"><span id="invPositionLabel"></span><button type="button" id="invChoosePosition" class="secondary-button">Colocar en el plano</button><button type="button" id="invClearPosition" class="text-button">Quitar ubicación</button></div></div>
    </div><p id="invFormError" class="inv-error" role="alert" hidden></p><footer><button type="button" id="invDelete" class="danger-button" hidden>Eliminar dispositivo</button><button type="button" id="invCancel" class="secondary-button">Cancelar</button><button type="submit" class="primary-button" id="invSave">Guardar dispositivo</button></footer></form>`;
  document.body.append(dialog);
  const $ = selector => document.querySelector(selector);
  const form = $('#invForm');
  const historyButton=document.createElement('button');historyButton.type='button';historyButton.id='invHistory';historyButton.className='secondary-button';historyButton.textContent='Historial del equipo';historyButton.hidden=true;
  form.querySelector('footer').prepend(historyButton);
  historyButton.addEventListener('click',()=>{if(selected)document.dispatchEvent(new CustomEvent('mesa:device-history',{detail:selected.id}));});
  const field = name => form.elements.namedItem(name);
  let devices = [], selected = null, view = 'list', zoom = 1, placing = false, loaded = false, dirtyPassword = false, revealRequest = 0, opener = null;
  const localToday = () => {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  field('last_maintenance').max = localToday();
  const dateLabel = value => value ? new Date(value+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : 'Sin registrar';
  const filtered = () => {const search = $('#invSearch').value.trim().toLocaleLowerCase(); return devices.filter(d => (!$('#invKind').value || d.kind === $('#invKind').value) && (!$('#invArea').value || d.area === $('#invArea').value) && [d.name,d.owner,d.area,d.serial,d.model,d.username].join(' ').toLocaleLowerCase().includes(search));};
  function render() {
    const areas = [...new Set(devices.map(d => d.area))].sort((a,b)=>a.localeCompare(b));
    const area = $('#invArea').value;
    $('#invArea').innerHTML = '<option value="">Todas las áreas</option>'+areas.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
    $('#invArea').value = areas.includes(area) ? area : '';
    $('#invAreas').innerHTML = areas.map(a=>`<option value="${esc(a)}"></option>`).join('');
    $('#invStats').innerHTML = [[devices.length,'Dispositivos'],[devices.filter(d=>d.kind==='desktop').length,'PC de escritorio'],[devices.filter(d=>d.kind==='laptop').length,'Laptops'],[devices.filter(d=>d.x===null).length,'Sin ubicación']].map(([count,label])=>`<article class="inv-stat"><span>${label}</span><strong>${count}</strong></article>`).join('');
    const rows = filtered();
    $('#invList').innerHTML = rows.length ? `<table class="inv-table"><thead><tr><th scope="col">Dispositivo</th><th scope="col">Tipo</th><th scope="col">Área</th><th scope="col">Responsable</th><th scope="col">Último mantenimiento</th><th scope="col">Ubicación</th></tr></thead><tbody>${rows.map(d=>`<tr><td><button class="inv-device-link" data-device="${d.id}">${esc(d.name)}</button><small>${esc(d.model || d.serial || 'Sin modelo registrado')}</small></td><td><span class="inv-type ${d.kind}">${icons[d.kind]}${kinds[d.kind]}</span></td><td>${esc(d.area)}</td><td>${esc(d.owner)}</td><td>${dateLabel(d.last_maintenance)}</td><td>${d.x===null ? `<button class="inv-device-link" data-place="${d.id}">Colocar en plano</button>` : `<button class="inv-device-link" data-locate="${d.id}">Ver en plano</button>`}</td></tr>`).join('')}</tbody></table>` : `<div class="inv-empty"><h3>${devices.length ? 'No encontramos dispositivos' : 'Comienza tu inventario'}</h3><p class="inv-muted">${devices.length ? 'Prueba con otros filtros.' : 'Agrega tu primer equipo y colócalo en el plano de la planta.'}</p></div>`;
    renderMarkers();
    const unplaced = rows.filter(d=>d.x===null);
    $('#invUnplaced').innerHTML = unplaced.map(d=>`<button class="inv-device-link" data-place="${d.id}">${esc(d.name)}<small class="inv-muted"> · ${esc(d.area)}</small></button>`).join('') || '<p class="inv-muted">No hay dispositivos pendientes en esta selección.</p>';
    setView(view);
  }
  function renderMarkers() {
    $('#invMarkers').innerHTML = filtered().filter(d=>d.x!==null).map(d=>`<button class="inv-marker ${d.kind}" data-device="${d.id}" style="left:${d.x}%;top:${d.y}%" title="${esc(d.name)} · ${esc(d.area)}" aria-label="${esc(d.name)}, ${kinds[d.kind]}, ${esc(d.area)}, ${esc(d.owner)}">${icons[d.kind]}</button>`).join('');
    if (placing && field('x').value !== '' && field('y').value !== '') $('#invMarkers').insertAdjacentHTML('beforeend',`<span class="inv-marker preview" style="left:${Number(field('x').value)}%;top:${Number(field('y').value)}%">${icons[field('kind').value]}</span>`);
  }
  function setView(next) {view = next; $('#invList').hidden = view !== 'list' || !loaded; $('#invMap').hidden = view !== 'map'; page.querySelectorAll('[data-inv-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.invView===view)));}
  async function load() {
    loaded = false; $('#invLoadStatus').hidden = false; $('#invLoadStatus').textContent = 'Cargando inventario…'; $('#invList').hidden = true;
    try {devices = await api('/api/devices'); loaded = true; $('#invLoadStatus').hidden = true; render();}
    catch (error) {devices = []; render(); $('#invLoadStatus').hidden = false; $('#invLoadStatus').textContent = error.message; if(error.message.includes('Sesión')) {clear();showPublic();} }
  }
  function showInventory() {setAdminView('inventory'); window.scrollTo(0,0); load();}
  $('#inventoryNav').addEventListener('click',e=>{e.preventDefault();showInventory();});
  document.querySelectorAll('#tickets-nav .nav-item').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('#tickets-nav .nav-item').forEach(item=>{if(item.classList.contains('active'))item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});}));
  document.addEventListener('mesa:view',e=>{if(e.detail!=='inventory'){placing=false;selected=null;revealRequest++;form.reset();dialog.close();$('#invPlaceMessage').hidden=true;$('#invPlan').style.cursor='';}});
  function clear() {revealRequest++; dialog.close(); form.reset(); devices=[]; selected=null; placing=false; loaded=false; page.hidden=true; $('#dashboard').hidden=false; $('#globalSearch').closest('label').hidden=false; $('#invMarkers').innerHTML=''; $('#invList').innerHTML=''; $('#invUnplaced').innerHTML='';}
  new MutationObserver(()=>{if($('#adminShell').hidden) clear();}).observe($('#adminShell'),{attributes:true,attributeFilter:['hidden']});
  function positionLabel() {$('#invPositionLabel').textContent = field('x').value === '' || field('y').value === '' ? 'Aún no se ha ubicado' : `X: ${field('x').value}% · Y: ${field('y').value}%`;}
  function openDevice(device=null) {
    historyButton.hidden=!device;
    opener = document.activeElement; revealRequest++; selected=device; dirtyPassword=false; form.reset(); $('#invFormError').hidden = true;
    field('last_maintenance').readOnly=!!device?.has_maintenance;
    field('last_maintenance').title=device?.has_maintenance?'Esta fecha se actualiza desde la agenda de mantenimiento.':'';
    for(const name of ['name','kind','area','owner','username','serial','model','notes','last_maintenance','x','y']) field(name).value = device?.[name] ?? (name==='kind' ? 'desktop' : '');
    field('password').type='password'; field('password').value=''; field('password').placeholder=device?.has_password ? 'Guardada · escribe para reemplazar' : 'Opcional';
    $('#invPasswordHint').textContent=device?.has_password ? 'Deja este campo vacío para conservarla. Mostrar permite consultar la contraseña guardada.' : 'La contraseña se guarda cifrada y no aparece en el listado.';
    $('#invReveal').textContent='Mostrar'; $('#invReveal').setAttribute('aria-label','Mostrar contraseña'); $('#invDelete').hidden=!device; $('#invDialogTitle').textContent=device ? device.name : 'Agregar dispositivo'; positionLabel(); dialog.showModal(); field('name').focus();
  }
  function closeDevice() {revealRequest++;field('password').value='';field('password').type='password';dialog.close();selected=null;opener?.focus();}
  $('#invAdd').addEventListener('click',()=>openDevice());
  document.addEventListener('mesa:devices-changed',async()=>{if(page.hidden)return;await load();if(selected){const current=devices.find(d=>d.id===selected.id);if(current){selected=current;field('last_maintenance').value=current.last_maintenance||'';field('last_maintenance').readOnly=!!current.has_maintenance;}}});
  $('#invClose').addEventListener('click',closeDevice);$('#invCancel').addEventListener('click',closeDevice);
  dialog.addEventListener('cancel',e=>{e.preventDefault();closeDevice();});
  field('password').addEventListener('input',()=>{dirtyPassword=true;});
  $('#invReveal').addEventListener('click',async()=>{
    const password=field('password');
    if(password.type==='text') {password.type='password';$('#invReveal').textContent='Mostrar';$('#invReveal').setAttribute('aria-label','Mostrar contraseña');return;}
    const request=++revealRequest;
    try {
      if(selected?.has_password && !dirtyPassword && !password.value) {
        $('#invReveal').disabled=true;
        const response=await api(`/api/devices/${selected.id}/password`);
        if(request!==revealRequest || !dialog.open || dirtyPassword)return;
        password.value=response.password;
      }
      password.type='text';$('#invReveal').textContent='Ocultar';$('#invReveal').setAttribute('aria-label','Ocultar contraseña');
    } catch(error) {showToast('No se pudo consultar',error.message);} finally {$('#invReveal').disabled=false;}
  });
  ['x','y'].forEach(name=>field(name).addEventListener('input',positionLabel));
  $('#invClearPosition').addEventListener('click',()=>{field('x').value='';field('y').value='';positionLabel();});
  function startPlacement() {placing=true;revealRequest++;field('password').type='password';dialog.close();setView('map');$('#invPlaceMessage').hidden=false;$('#invPlaceMessage span').textContent=`Haz clic en el plano para ubicar ${field('name').value || 'el nuevo dispositivo'}. Se guardará al confirmar la ficha.`;renderMarkers();$('#invPlan').style.cursor='crosshair';$('#invPlaceCancel').focus();}
  function stopPlacement() {placing=false;$('#invPlaceMessage').hidden=true;$('#invPlan').style.cursor='';renderMarkers();dialog.showModal();positionLabel();$('#invChoosePosition').focus();}
  $('#invChoosePosition').addEventListener('click',startPlacement);
  $('#invPlaceCancel').addEventListener('click',stopPlacement);
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && placing)stopPlacement();});
  $('#invPlan').addEventListener('click',e=>{
    if(!placing)return;
    e.preventDefault();e.stopPropagation();const rect=$('#invPlan').getBoundingClientRect();
    field('x').value=(Math.min(100,Math.max(0,(e.clientX-rect.left)/rect.width*100))).toFixed(2);
    field('y').value=(Math.min(100,Math.max(0,(e.clientY-rect.top)/rect.height*100))).toFixed(2);stopPlacement();
  });
  page.addEventListener('click',e=>{
    if(placing && e.target.closest('#invPlan'))return;
    const target=e.target.closest('[data-device],[data-place],[data-locate]');if(!target || placing)return;
    const device=devices.find(d=>d.id===Number(target.dataset.device || target.dataset.place || target.dataset.locate));if(!device)return;
    if(target.dataset.place) {openDevice(device);startPlacement();}
    else if(target.dataset.locate) {setView('map');const marker=page.querySelector(`.inv-marker[data-device="${device.id}"]`);marker?.scrollIntoView({block:'center',inline:'center'});marker?.focus();}
    else openDevice(device);
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();$('#invFormError').hidden=true;
    const payload=Object.fromEntries(new FormData(form));
    payload.x=payload.x==='' ? null : Number(payload.x);payload.y=payload.y==='' ? null : Number(payload.y);
    if((payload.x===null)!==(payload.y===null)) {$('#invFormError').textContent='Completa ambas coordenadas o quita la ubicación.';$('#invFormError').hidden=false;return;}
    if(selected && !dirtyPassword)delete payload.password;
    if(selected && dirtyPassword && payload.password==='')payload.password='';
    $('#invSave').disabled=true;$('#invSave').textContent='Guardando…';
    try {const saved=await api(selected ? `/api/devices/${selected.id}` : '/api/devices',{method:selected?'PATCH':'POST',body:JSON.stringify(payload)}); devices=devices.filter(d=>d.id!==saved.id);devices.push(saved);devices.sort((a,b)=>a.name.localeCompare(b.name));closeDevice();render();showToast('Dispositivo guardado',`${saved.name} se guardó en el inventario.`);}
    catch(error) {$('#invFormError').textContent=error.message;$('#invFormError').hidden=false;}
    finally {$('#invSave').disabled=false;$('#invSave').textContent='Guardar dispositivo';}
  });
  $('#invDelete').addEventListener('click',async()=>{
    if(!selected || !confirm(`¿Eliminar ${selected.name} del inventario?`))return;
    $('#invDelete').disabled=true;
    try {await api(`/api/devices/${selected.id}`,{method:'DELETE'});devices=devices.filter(d=>d.id!==selected.id);closeDevice();render();showToast('Dispositivo eliminado','El registro fue eliminado del inventario.');}
    catch(error) {$('#invFormError').textContent=error.message;$('#invFormError').hidden=false;}
    finally {$('#invDelete').disabled=false;}
  });
  page.querySelectorAll('[data-inv-view]').forEach(b=>b.addEventListener('click',()=>{if(!placing)setView(b.dataset.invView);}));
  ['invSearch','invKind','invArea'].forEach(id=>$('#'+id).addEventListener(id==='invSearch'?'input':'change',render));
  function changeZoom(value) {zoom=Math.max(1,Math.min(6,value));$('#invPlan').style.width=`${zoom*100}%`;$('#invZoomLabel').value=`${Math.round(zoom*100)}%`;$('#invZoomOut').disabled=zoom===1;$('#invZoomIn').disabled=zoom===6;}
  $('#invZoomIn').addEventListener('click',()=>changeZoom(zoom+.5));$('#invZoomOut').addEventListener('click',()=>changeZoom(zoom-.5));$('#invZoomReset').addEventListener('click',()=>changeZoom(1));changeZoom(1);
})();
