(() => {
  const $=s=>document.querySelector(s);
  const esc=value=>safe(String(value??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const page=document.createElement('section');page.id='settingsPage';page.className='page';page.hidden=true;
  page.innerHTML=`<div class="page-heading"><div><span class="eyebrow">ADMINISTRACIÓN DE LA APP</span><h1>Configuración</h1><p>Personaliza los datos de soporte y las opciones de los formularios.</p></div><button id="settingsRefresh" class="secondary-button">Actualizar</button></div><p id="settingsLoad" class="settings-note" role="status" hidden></p><p id="settingsError" class="settings-error" role="alert" hidden></p><div id="settingsContent" hidden>
    <section class="panel settings-panel"><h2>Datos de soporte</h2><p class="settings-note">Se muestran en el portal, en el panel y en los comprobantes de los tickets. El horario se publica como texto informativo.</p><form id="supportForm"><div class="settings-fields"><label>Nombre visible del encargado<input name="technician_name" maxlength="100" required></label><label>Planta / sede<input name="site_name" maxlength="80" required></label><label>Extensión (opcional)<input name="extension" maxlength="30"></label><label>Correo de soporte (opcional)<input name="email" type="email" maxlength="160"></label><label class="wide">Horario de atención<input name="hours" maxlength="160" placeholder="Ej. Lunes a viernes, 8:00 a 17:00" required></label></div><p id="supportError" class="settings-error" role="alert" hidden></p><div class="settings-footer"><button id="supportSave" class="primary-button" type="submit">Guardar datos de soporte</button></div></form></section>
    <div class="settings-catalogs"><section class="panel settings-panel"><div class="settings-catalog-head"><h2>Áreas de la empresa</h2><button class="secondary-button" data-catalog-add="area">Agregar área</button></div><p class="settings-note">Se usan en los tickets y en las fichas de dispositivos.</p><ul class="settings-catalog-list" id="settingsAreas"></ul></section><section class="panel settings-panel"><div class="settings-catalog-head"><h2>Categorías de tickets</h2><button class="secondary-button" data-catalog-add="category">Agregar categoría</button></div><p class="settings-note">También aparecen como tipos de soporte en el portal.</p><ul class="settings-catalog-list" id="settingsCategories"></ul></section></div><p class="settings-note">Desactivar retira una opción de las nuevas solicitudes. Los tickets y dispositivos existentes conservan sus datos. Renombrar actualiza las opciones futuras; los registros anteriores mantienen el nombre con el que se guardaron. Siempre debe quedar un área y una categoría activas.</p></div>`;
  $('#adminShell .main-content').append(page);
  const dialog=document.createElement('dialog');dialog.id='catalogDialog';dialog.className='settings-dialog';dialog.setAttribute('aria-labelledby','catalogTitle');
  dialog.innerHTML='<header><div><span class="eyebrow">CATÁLOGOS DE SOPORTE</span><h2 id="catalogTitle"></h2></div><button id="catalogClose" class="close-button" aria-label="Cerrar opción del catálogo">×</button></header><form id="catalogForm" class="catalog-form"><label>Nombre<input name="name" maxlength="100" required></label><label>Descripción (opcional)<input name="description" maxlength="250" placeholder="Ayuda breve para identificar esta opción"></label><label class="catalog-check" id="catalogActiveLabel"><input type="checkbox" name="active">Disponible para nuevas solicitudes</label><p id="catalogError" class="settings-error" role="alert" hidden></p><footer><button id="catalogCancel" type="button" class="secondary-button">Cancelar</button><button id="catalogSave" type="submit" class="primary-button">Guardar opción</button></footer></form>';
  document.body.append(dialog);
  let stored=null,loadVersion=0,publicVersion=0,editing=null,kind='area',opener=null,catalogSaving=false;
  const supportForm=$('#supportForm'),catalogForm=$('#catalogForm');
  const categorySelect=$('#ticketForm [name=category]'),areaSelect=$('#ticketForm [name=area]'),deviceArea=$('#invForm [name=area]');
  [categorySelect,areaSelect,$('#categoryFilter')].forEach(select=>select.setAttribute('data-glide-skip',''));
  const formStatus=document.createElement('p');formStatus.id='ticketConfigStatus';formStatus.setAttribute('role','status');$('#ticketForm').prepend(formStatus);
  function fillSelect(select,items,value,{historical=false,defaultCategory=false,placeholder='Selecciona una opción'}={}) {
    const names=items.map(item=>item.name);const old=value??select.value;
    const retained=historical && old && !names.includes(old);
    select.innerHTML=`<option value="">${placeholder}</option>`+(retained?`<option value="${esc(old)}">${esc(old)} · registro anterior</option>`:'')+names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    select.value=names.includes(old)||retained?old:defaultCategory?(names.includes('Hardware')?'Hardware':names[0]||''):'';
  }
  function ticketFilters() {
    const names=[...new Set([...(window.mesaConfig?.categories||[]).map(c=>c.name),...tickets.map(t=>t.category)])].sort((a,b)=>a.localeCompare(b));
    $('#categoryFilter').innerHTML='<option value="Todas">Todas las categorías</option>'+names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('#categoryFilter').value=state.category;
  }
  const categoryIcons={Hardware:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5M7 21h10"/>',Software:'<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 22"/>',Red:'<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>',Accesos:'<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-2-2 3-3m-6 0 3-3"/>'};
  function applyPublic(data) {
    const config={support:data.support,areas:data.areas.filter(row=>row.active),categories:data.categories.filter(row=>row.active)};
    window.mesaConfig=config;
    const s=config.support;
    document.title=`Mesa TI | ${s.site_name}`;
    $('.topbar-copy p').textContent=new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',timeZone:'America/Mexico_City'});
    $('.topbar-copy strong').textContent=s.site_name;
    $('.hero-kicker').innerHTML=`<i></i> SOPORTE INTERNO · ${esc(s.site_name)}`;
    $('.availability').innerHTML=`<span></span> ${esc(s.hours)}${s.extension?' · Ext. '+esc(s.extension):''}`;
    const contact=[s.extension?'Ext. '+s.extension:'',s.email].filter(Boolean).join(' · ');
    $('.public-footer span:first-child').textContent=`Mesa TI · ${s.site_name}`;
    $('.public-footer span:nth-child(2)').textContent=contact||s.hours;
    $('.sidebar-help p').textContent=contact||s.hours;
    $('.sidebar-user > div > strong').textContent=s.technician_name;
    $('.sidebar-user .avatar').textContent=s.technician_name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
    $('#dashboard .page-heading h1').textContent=`Hola, ${s.technician_name.split(/\s+/)[0]}`;
    $('#dashboard .page-heading p').textContent=`Aquí tienes el panorama de soporte de ${s.site_name}.`;
    fillSelect(areaSelect,config.areas,undefined,{placeholder:'Selecciona tu área'});
    fillSelect(categorySelect,config.categories,undefined,{defaultCategory:true,placeholder:'Selecciona una categoría'});
    fillSelect(deviceArea,config.areas,undefined,{historical:!$('#invDelete').hidden,placeholder:'Selecciona el área del equipo'});
    ticketFilters();
    $('.service-grid').innerHTML=config.categories.map(c=>`<button class="service-card" data-category="${esc(c.name)}"><span class="service-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${categoryIcons[c.name]||'<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7" cy="7" r="1"/>'}</svg></span><h3>${esc(c.name)}</h3><p>${esc(c.description||'Solicita apoyo al equipo de Sistemas.')}</p><b>Solicitar soporte →</b></button>`).join('');
    formStatus.textContent='';
    document.dispatchEvent(new Event('mesa:config-updated'));
  }
  async function publicConfig() {
    const current=++publicVersion;
    try {const data=await api('/api/config');if(current===publicVersion)applyPublic(data);return data;}
    catch(error){if(current===publicVersion)formStatus.textContent='No se pudieron actualizar las áreas y categorías. Intenta abrir el formulario de nuevo.';throw error;}
  }
  function renderCatalogs() {
    for(const [id,rows] of [['settingsAreas',stored.areas],['settingsCategories',stored.categories]])$('#'+id).innerHTML=rows.map(row=>`<li><div class="settings-catalog-name"><strong>${esc(row.name)}</strong>${row.description?`<p>${esc(row.description)}</p>`:''}<span class="settings-catalog-state ${row.active?'active':''}">${row.active?'Activa':'Inactiva'}</span></div><div class="settings-catalog-actions"><button class="secondary-button" data-catalog-edit="${row.id}">Editar</button><button class="secondary-button" data-catalog-toggle="${row.id}">${row.active?'Desactivar':'Reactivar'}</button></div></li>`).join('');
  }
  function accept(data,{populateSupport=false}={}) {
    stored=data;renderCatalogs();
    if(populateSupport)for(const [name,value] of Object.entries(data.support))supportForm.elements.namedItem(name).value=value;
    publicVersion++;applyPublic(data);
  }
  async function load() {
    const current=++loadVersion;$('#settingsLoad').hidden=false;$('#settingsLoad').textContent='Cargando configuración…';$('#settingsError').hidden=true;$('#settingsContent').hidden=true;
    try {const data=await api('/api/admin/config');if(current!==loadVersion)return;accept(data,{populateSupport:true});$('#settingsContent').hidden=false;}
    catch(error){if(current!==loadVersion)return;$('#settingsError').textContent=error.message;$('#settingsError').hidden=false;if(error.message.includes('Sesión'))showPublic();}
    finally{if(current===loadVersion)$('#settingsLoad').hidden=true;}
  }
  $('#settingsNav').addEventListener('click',e=>{e.preventDefault();setAdminView('settings');window.scrollTo(0,0);load();});
  $('#settingsRefresh').addEventListener('click',load);
  supportForm.addEventListener('submit',async e=>{
    e.preventDefault();$('#supportError').hidden=true;$('#supportSave').disabled=true;
    try {const data=await api('/api/admin/config/support',{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(supportForm)))});accept(data,{populateSupport:true});showToast('Datos de soporte guardados','El portal y el panel ya muestran la información actualizada.');}
    catch(error){$('#supportError').textContent=error.message;$('#supportError').hidden=false;}
    finally{$('#supportSave').disabled=false;}
  });
  function catalogById(id){return [...stored.areas,...stored.categories].find(row=>row.id===Number(id));}
  function openCatalog(nextKind,item=null) {
    kind=nextKind;editing=item;opener=document.activeElement;catalogForm.reset();$('#catalogError').hidden=true;
    $('#catalogTitle').textContent=`${item?'Editar':'Agregar'} ${kind==='area'?'área':'categoría'}`;
    catalogForm.elements.name.value=item?.name||'';catalogForm.elements.description.value=item?.description||'';catalogForm.elements.active.checked=item?.active??true;$('#catalogActiveLabel').hidden=!item;
    dialog.showModal();catalogForm.elements.name.focus();
  }
  function closeCatalog(){if(catalogSaving)return;dialog.close();opener?.focus();}
  $('#catalogClose').addEventListener('click',closeCatalog);$('#catalogCancel').addEventListener('click',closeCatalog);dialog.addEventListener('cancel',e=>{e.preventDefault();closeCatalog();});
  page.addEventListener('click',async e=>{
    const button=e.target.closest('[data-catalog-add],[data-catalog-edit],[data-catalog-toggle]');if(!button||!stored)return;
    if(button.dataset.catalogAdd){openCatalog(button.dataset.catalogAdd);return;}
    const row=catalogById(button.dataset.catalogEdit||button.dataset.catalogToggle);if(!row)return;
    if(button.dataset.catalogEdit){openCatalog(stored.areas.some(a=>a.id===row.id)?'area':'category',row);return;}
    button.disabled=true;$('#settingsError').hidden=true;
    try {const data=await api(`/api/admin/config/catalogs/${row.id}`,{method:'PATCH',body:JSON.stringify({active:!row.active})});accept(data);showToast(row.active?'Opción desactivada':'Opción reactivada','Los registros anteriores conservan su información.');}
    catch(error){$('#settingsError').textContent=error.message;$('#settingsError').hidden=false;}
    finally{button.disabled=false;}
  });
  catalogForm.addEventListener('submit',async e=>{
    e.preventDefault();if(catalogSaving)return;catalogSaving=true;$('#catalogSave').disabled=true;$('#catalogError').hidden=true;
    const data={name:catalogForm.elements.name.value,description:catalogForm.elements.description.value};if(editing)data.active=catalogForm.elements.active.checked;
    try {const response=await api(editing?`/api/admin/config/catalogs/${editing.id}`:`/api/admin/config/catalogs/${kind}`,{method:editing?'PATCH':'POST',body:JSON.stringify(data)});accept(response);dialog.close();showToast('Catálogo actualizado','Las nuevas solicitudes usarán estas opciones.');opener?.focus();}
    catch(error){$('#catalogError').textContent=error.message;$('#catalogError').hidden=false;}
    finally{catalogSaving=false;$('#catalogSave').disabled=false;}
  });
  document.addEventListener('mesa:new-ticket',()=>{publicConfig().catch(()=>{});});
  document.addEventListener('mesa:tickets-rendered',ticketFilters);
  document.addEventListener('mesa:device-opened',e=>{if(window.mesaConfig)fillSelect(deviceArea,window.mesaConfig.areas,e.detail?.area||'',{historical:!!e.detail,placeholder:'Selecciona el área del equipo'});else if(e.detail?.area)fillSelect(deviceArea,[],e.detail.area,{historical:true});publicConfig().catch(()=>{});});
  document.addEventListener('mesa:view',e=>{if(e.detail!=='settings'){loadVersion++;if(dialog.open&&!catalogSaving)closeCatalog();}});
  new MutationObserver(()=>{if($('#adminShell').hidden){loadVersion++;dialog.close();stored=null;page.hidden=true;$('#settingsContent').hidden=true;supportForm.reset();$('#settingsAreas').textContent='';$('#settingsCategories').textContent='';}}).observe($('#adminShell'),{attributes:true,attributeFilter:['hidden']});
  publicConfig().catch(()=>{});
})();
