(() => {
  const esc = value => safe(String(value ?? '')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const zone = 'America/Mexico_City';
  const day = value => value ? new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : '';
  const stamp = value => value ? new Intl.DateTimeFormat('es-MX',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'No registrada';
  const hours = t => t.status==='Cerrado' && t.closed_at ? Math.max(0,(new Date(t.closed_at)-new Date(t.created_at))/3600000) : null;
  const duration = value => value===null ? '—' : value<1 ? `${Math.max(1,Math.round(value*60))} min` : value<48 ? `${value.toFixed(1)} h` : `${(value/24).toFixed(1)} días`;
  const page = document.createElement('section'); page.id='reportsPage';page.className='page';page.hidden=true;
  page.innerHTML=`<div class="page-heading"><div><span class="eyebrow">HISTORIAL DE SOPORTE</span><h1>Reportes</h1><p>Consulta los tickets, sus cierres y todo el seguimiento.</p></div><div class="report-actions"><button id="reportExport" class="secondary-button" disabled>Exportar CSV</button><button id="reportPrint" class="secondary-button" disabled>Imprimir / PDF</button><button id="reportRefresh" class="primary-button">Actualizar</button></div></div>
    <section class="panel"><div class="report-filters">
      <label>Filtrar fechas por<select id="reportBasis" data-glide-skip><option value="created_at">Fecha de apertura</option><option value="closed_at">Fecha del último cierre</option></select></label>
      <label>Desde<input id="reportFrom" type="date"></label><label>Hasta<input id="reportTo" type="date"></label>
      <label>Estado<select id="reportStatus" data-glide-skip><option value="">Todos los estados</option><option>Abierto</option><option>En progreso</option><option>Cerrado</option></select></label>
      <label>Área<select id="reportArea" data-glide-skip><option value="">Todas las áreas</option></select></label>
      <label>Categoría<select id="reportCategory" data-glide-skip><option value="">Todas las categorías</option></select></label>
      <label>Prioridad<select id="reportPriority" data-glide-skip><option value="">Todas las prioridades</option><option>Baja</option><option>Media</option><option>Alta</option><option>Crítica</option></select></label>
      <label>Archivo<select id="reportArchive" data-glide-skip><option value="">Incluir todos</option><option value="active">Sin archivar</option><option value="archived">Sólo archivados</option></select></label>
      <label class="report-search">Buscar<input id="reportSearch" type="search" placeholder="Folio, asunto, solicitante o responsable"></label>
    </div><div class="report-filter-footer"><p id="reportScope">Todo el historial · fechas en hora de Ciudad de México</p><button id="reportReset" class="text-button">Limpiar filtros</button></div></section>
    <p id="reportLoadStatus" role="status" class="report-note" hidden></p><p id="reportError" role="alert" class="report-error" hidden></p>
    <div id="reportContent" hidden><div class="report-stats" id="reportStats"></div><div class="report-breakdowns"><section class="panel report-breakdown"><h2>Tickets por área</h2><div id="reportByArea"></div></section><section class="panel report-breakdown"><h2>Tickets por categoría</h2><div id="reportByCategory"></div></section></div>
      <p class="report-note">Los indicadores usan los tickets que coinciden con los filtros y su estado actual. El tiempo promedio va desde la apertura hasta el último cierre registrado; excluye los cierres sin fecha. Al reabrir, el cierre anterior permanece en la ficha del historial. Los tickets anteriores a este registro pueden tener fechas de cierre desconocidas.</p>
      <p class="report-print-meta" id="reportPrintMeta"></p>
      <section class="panel"><div class="report-table-caption"><h2>Historial de tickets</h2><span id="reportCount"></span></div><div class="report-table-wrap" id="reportTable"></div><div class="report-pagination"><button id="reportPrev" class="secondary-button">Anterior</button><span id="reportPageLabel"></span><button id="reportNext" class="secondary-button">Siguiente</button></div></section>
    </div>`;
  document.querySelector('#adminShell .main-content').append(page);
  const dialog=document.createElement('dialog');dialog.id='reportDialog';dialog.className='report-dialog';dialog.setAttribute('aria-labelledby','reportDetailTitle');
  dialog.innerHTML='<header><div><span class="eyebrow">HISTORIAL DEL TICKET</span><h2 id="reportDetailTitle"></h2></div><button id="reportClose" class="close-button" aria-label="Cerrar historial">×</button></header><div id="reportDetailBody"></div><footer><button id="reportHistoryExport" class="secondary-button" disabled>Exportar historial CSV</button><button id="reportDetailPrint" class="secondary-button" disabled>Imprimir / PDF</button><button id="reportDone" class="primary-button">Cerrar</button></footer>';
  document.body.append(dialog);
  const $=s=>document.querySelector(s);
  let records=[],filtered=[],number=1,detail=null,requestVersion=0,detailVersion=0,opener=null;
  const size=25;
  const ids=['reportBasis','reportFrom','reportTo','reportStatus','reportArea','reportCategory','reportPriority','reportArchive','reportSearch'];
  function buildOptions(id, field) {const value=$('#'+id).value;const label=field==='area'?'Todas las áreas':'Todas las categorías';$('#'+id).innerHTML=`<option value="">${label}</option>`+[...new Set(records.map(t=>t[field]))].sort((a,b)=>a.localeCompare(b)).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');$('#'+id).value=value;}
  function scope() {return `${$('#reportBasis').value==='closed_at'?'Último cierre':'Apertura'}: ${$('#reportFrom').value||'inicio'} a ${$('#reportTo').value||'hoy'} · ${$('#reportStatus').value||'todos los estados'} · ${$('#reportArea').value||'todas las áreas'} · ${$('#reportCategory').value||'todas las categorías'} · ${$('#reportPriority').value||'todas las prioridades'} · ${$('#reportArchive').selectedOptions[0].textContent}${$('#reportSearch').value ? ' · búsqueda: '+$('#reportSearch').value : ''} · hora de Ciudad de México`;}
  function applyFilters() {
    const from=$('#reportFrom').value,to=$('#reportTo').value,basis=$('#reportBasis').value,search=$('#reportSearch').value.trim().toLocaleLowerCase();
    $('#reportError').hidden=true;
    if(from && to && from>to) {$('#reportError').textContent='La fecha Desde debe ser anterior o igual a Hasta.';$('#reportError').hidden=false;filtered=[];}
    else filtered=records.filter(t=>{
      const date=day(t[basis]);
      return (basis!=='closed_at' || !!t.closed_at) && (!from || date>=from) && (!to || date<=to) &&
        (!$('#reportStatus').value || t.status===$('#reportStatus').value) && (!$('#reportArea').value || t.area===$('#reportArea').value) &&
        (!$('#reportCategory').value || t.category===$('#reportCategory').value) && (!$('#reportPriority').value || t.priority===$('#reportPriority').value) &&
        (!$('#reportArchive').value || ($('#reportArchive').value==='archived' ? !!t.deleted_at : !t.deleted_at)) &&
        [t.code,t.subject,t.requester,t.assignee,t.description,t.device_name].join(' ').toLocaleLowerCase().includes(search);
    });
    $('#reportScope').textContent=scope();number=1;render();
  }
  function breakdown(field,id) {
    const counts=new Map();filtered.forEach(t=>counts.set(t[field],(counts.get(t[field])||0)+1));
    const groups=[...counts].sort((a,b)=>b[1]-a[1]);const max=groups[0]?.[1]||1;
    $('#'+id).innerHTML=groups.map(([label,count])=>`<div class="report-bar-row"><div class="report-bar-label"><span>${esc(label)}</span><strong>${count}</strong></div><div class="report-bar-track" aria-hidden="true"><i style="width:${count/max*100}%"></i></div></div>`).join('')||'<p class="report-note">Sin datos para estos filtros.</p>';
  }
  function render() {
    const measured=filtered.map(hours).filter(h=>h!==null);
    const stats=[[filtered.length,'Tickets en la selección',`${filtered.filter(t=>t.deleted_at).length} archivados incluidos`],...['Abierto','En progreso','Cerrado'].map(status=>[filtered.filter(t=>t.status===status).length,{'Abierto':'Abiertos','En progreso':'En progreso','Cerrado':'Cerrados'}[status],'Estado actual']),[duration(measured.length?measured.reduce((a,b)=>a+b,0)/measured.length:null),'Tiempo promedio al cierre',`${measured.length} cierres con fecha registrada`]];
    $('#reportStats').innerHTML=stats.map(([value,label,note])=>`<article class="report-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    breakdown('area','reportByArea');breakdown('category','reportByCategory');
    $('#reportCount').textContent=`${filtered.length} tickets · selecciona un folio para ver su historial`;
    $('#reportExport').disabled=filtered.length===0;$('#reportPrint').disabled=filtered.length===0;
    renderTable();
  }
  function renderTable(all=false) {
    const rows=all?filtered:filtered.slice((number-1)*size,number*size);
    $('#reportTable').innerHTML=rows.length?`<table class="report-table"><thead><tr>${['Folio / asunto','Solicitante / área','Categoría / prioridad','Estado / responsable','Apertura','Último cierre','Tiempo al cierre'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(t=>`<tr><td class="report-subject"><button class="report-link" data-report-code="${esc(t.code)}">${esc(t.code)}</button><small>${esc(t.subject)}</small>${t.device_name?`<small>Equipo: ${esc(t.device_name)}</small>`:""}${t.deleted_at?'<small>Archivado · '+stamp(t.deleted_at)+'</small>':''}</td><td>${esc(t.requester)}<small>${esc(t.area)}</small></td><td>${esc(t.category)}<small>${esc(t.priority)}</small></td><td><span class="badge ${statusClass(t.status)}">${esc(t.status)}</span><small>${esc(t.assignee||'Sin asignar')}</small></td><td class="report-date">${stamp(t.created_at)}</td><td class="report-date">${t.closed_at?stamp(t.closed_at):t.status==='Cerrado'?'Fecha no registrada':'—'}</td><td>${duration(hours(t))}</td></tr>`).join('')}</tbody></table>`:'<div class="report-empty">No hay tickets que coincidan con estos filtros.</div>';
    $('#reportPrev').disabled=number<=1;$('#reportNext').disabled=number*size>=filtered.length;$('#reportPageLabel').textContent=`Página ${number} de ${Math.max(1,Math.ceil(filtered.length/size))}`;
  }
  async function load() {
    const version=++requestVersion;$('#reportLoadStatus').hidden=false;$('#reportLoadStatus').textContent='Cargando historial…';$('#reportError').hidden=true;$('#reportContent').hidden=true;$('#reportExport').disabled=true;$('#reportPrint').disabled=true;
    try {const data=await api('/api/reports/tickets');if(version!==requestVersion)return;records=data;buildOptions('reportArea','area');buildOptions('reportCategory','category');applyFilters();$('#reportContent').hidden=false;}
    catch(error) {if(version!==requestVersion)return;records=[];$('#reportError').textContent=error.message;$('#reportError').hidden=false;if(error.message.includes('Sesión'))showPublic();}
    finally {if(version===requestVersion)$('#reportLoadStatus').hidden=true;}
  }
  $('#reportsNav').addEventListener('click',e=>{e.preventDefault();setAdminView('reports');window.scrollTo(0,0);load();});
  $('#reportRefresh').addEventListener('click',load);
  ids.forEach(id=>$('#'+id).addEventListener(id==='reportSearch'?'input':'change',applyFilters));
  $('#reportReset').addEventListener('click',()=>{ids.forEach(id=>$('#'+id).value=id==='reportBasis'?'created_at':'');applyFilters();});
  $('#reportPrev').addEventListener('click',()=>{number--;renderTable();});$('#reportNext').addEventListener('click',()=>{number++;renderTable();});
  function changeText(changes) {
    const labels={status:'Estado',priority:'Prioridad',category:'Categoría',assignee:'Responsable',device_name:'Equipo'};
    return Object.entries(changes).filter(([field])=>field!=='device_id').map(([field,value])=>value && typeof value==='object'?`${labels[field]||field}: ${value.antes??'—'} → ${value.despues??'—'}`:field==='comentario'?'Comentario registrado':String(value)).join('\n');
  }
  async function openHistory(code) {
    const version=++detailVersion;opener=document.activeElement;detail=null;$('#reportDetailTitle').textContent=code;$('#reportDetailBody').textContent='Cargando historial…';$('#reportHistoryExport').disabled=true;$('#reportDetailPrint').disabled=true;dialog.showModal();
    try {
      const data=await api(`/api/reports/tickets/${encodeURIComponent(code)}`);if(version!==detailVersion || !dialog.open)return;detail=data;
      const fields=[['Equipo relacionado',data.device_name||'Sin equipo relacionado'],['Estado',data.status],['Solicitante',data.requester],['Área',data.area],['Responsable',data.assignee||'Sin asignar'],['Categoría',data.category],['Prioridad',data.priority],['Apertura',stamp(data.created_at)],['Último cierre',data.closed_at?stamp(data.closed_at):data.status==='Cerrado'?'Fecha no registrada':'—'],['Tiempo hasta el cierre',duration(hours(data))],['Última actualización',stamp(data.updated_at)]];
      if(data.deleted_at)fields.push(['Archivado',stamp(data.deleted_at)]);
      $('#reportDetailBody').innerHTML=`<h3>${esc(data.subject)}</h3><dl class="report-detail-fields">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><h3>Descripción</h3><p class="report-description">${esc(data.description)}</p><h3>Movimientos</h3><ol class="report-timeline">${data.events.map(e=>`<li><strong>${esc(e.action)}</strong><small>${stamp(e.created_at)} · ${esc(e.actor)}</small><p>${esc(changeText(e.changes))}</p></li>`).join('')||'<li>Sin movimientos registrados.</li>'}</ol><h3>Comentarios</h3>${data.comments.map(c=>`<article class="comment"><p class="report-description">${esc(c.body)}</p><small>${stamp(c.created_at)} · ${esc(c.author)}</small></article>`).join('')||'<p class="report-note">Sin comentarios.</p>'}<h3>Archivos adjuntos</h3><p class="report-note">${data.attachments.map(a=>`<button type="button" class="report-link" data-report-attachment="${a.id}">${esc(a.name)} (${Math.ceil(a.size/1024)} KB)</button>`).join('<br>')||'Sin archivos adjuntos.'}</p><p class="report-note">Fechas en hora de Ciudad de México. Los movimientos anteriores a la activación del historial no pueden reconstruirse.</p>`;
      $('#reportHistoryExport').disabled=false;$('#reportDetailPrint').disabled=false;
    } catch(error) {if(version===detailVersion)$('#reportDetailBody').textContent=error.message;}
  }
  page.addEventListener('click',e=>{const button=e.target.closest('[data-report-code]');if(button)openHistory(button.dataset.reportCode);});
  document.addEventListener('mesa:report-ticket',e=>openHistory(e.detail));
  dialog.addEventListener('click',async e=>{
    const button=e.target.closest('[data-report-attachment]');if(!button || !detail)return;
    const attachment=detail.attachments.find(a=>a.id===Number(button.dataset.reportAttachment));if(!attachment)return;
    button.disabled=true;
    try {const response=await fetch(`/api/attachments/${attachment.id}`,{headers:{Authorization:`Bearer ${sessionStorage.getItem('mesaTiToken')}`}});if(!response.ok)throw new Error('No se pudo descargar el archivo. Revisa tu sesión.');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=attachment.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(error){showToast('Error',error.message);}finally{button.disabled=false;}
  });
  function closeHistory() {detailVersion++;detail=null;dialog.close();$('#reportDetailBody').textContent='';opener?.focus();}
  $('#reportClose').addEventListener('click',closeHistory);$('#reportDone').addEventListener('click',closeHistory);dialog.addEventListener('cancel',e=>{e.preventDefault();closeHistory();});
  function csvCell(value) {let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function downloadCSV(name,rows) {const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('#reportExport').addEventListener('click',()=>downloadCSV(`mesa-ti-tickets-${day(new Date())}.csv`,[['Folio','Equipo relacionado','Asunto','Descripción','Solicitante','Área','Categoría','Prioridad','Estado actual','Responsable','Apertura (CDMX)','Último cierre (CDMX)','Tiempo al cierre (horas)','Última actualización (CDMX)','Archivado (CDMX)'],...filtered.map(t=>[t.code,t.device_name,t.subject,t.description,t.requester,t.area,t.category,t.priority,t.status,t.assignee,stamp(t.created_at),t.closed_at?stamp(t.closed_at):t.status==='Cerrado'?'Fecha no registrada':'',hours(t)===null?'':hours(t).toFixed(2),stamp(t.updated_at),t.deleted_at?stamp(t.deleted_at):''])]));
  $('#reportHistoryExport').addEventListener('click',()=>{if(!detail)return;const movements=[...detail.events.filter(e=>e.action!=='Comentario').map(e=>({date:e.created_at,action:e.action,actor:e.actor,text:changeText(e.changes)})),...detail.comments.map(c=>({date:c.created_at,action:'Comentario',actor:c.author,text:c.body}))].sort((a,b)=>new Date(a.date)-new Date(b.date));downloadCSV(`${detail.code}-historial.csv`,[['Folio','Fecha (CDMX)','Movimiento','Autor','Detalle'],...movements.map(e=>[detail.code,stamp(e.date),e.action,e.actor,e.text])]);});
  function print(detailOnly=false) {if(!detailOnly){renderTable(true);$('#reportPrintMeta').textContent=`Generado: ${stamp(new Date())}\n${scope()}\n${filtered.length} tickets`;}document.body.classList.add('report-print');document.body.classList.toggle('report-print-detail',detailOnly);window.print();}
  window.addEventListener('afterprint',()=>{document.body.classList.remove('report-print','report-print-detail');renderTable();});
  $('#reportPrint').addEventListener('click',()=>print());$('#reportDetailPrint').addEventListener('click',()=>print(true));
  document.addEventListener('mesa:view',e=>{if(e.detail!=='reports'){requestVersion++;if(dialog.open)closeHistory();}});
  new MutationObserver(()=>{if($('#adminShell').hidden){requestVersion++;detailVersion++;dialog.close();detail=null;records=[];filtered=[];page.hidden=true;$('#reportContent').hidden=true;$('#reportDetailBody').textContent='';$('#reportTable').textContent='';}}).observe($('#adminShell'),{attributes:true,attributeFilter:['hidden']});
})();
