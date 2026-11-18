(() => {
 const $=selector=>document.querySelector(selector),esc=value=>safe(String(value??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const panel=document.createElement('section');panel.className='panel settings-panel plan-editor';
 panel.innerHTML=`<div class="settings-catalog-head"><div><h2>Plano, zonas y pisos</h2><p class="settings-note">Carga el plano de esta planta y dibuja las zonas que tienen varios pisos. Los cambios se aplican al guardar.</p></div><button type="button" id="planReload" class="secondary-button">Descartar cambios y recargar</button></div>
 <p id="planStatus" role="status"></p><p id="planError" class="settings-error" role="alert" hidden></p>
 <div id="planEditorContent" hidden><div class="plan-tools"><label class="secondary-button plan-upload">Cargar o reemplazar plano<input id="planUpload" type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"></label><span id="planFilename"></span><button type="button" id="planDraw" class="primary-button">Añadir zona con pisos</button></div>
 <p class="settings-note">PNG, JPG o SVG, máximo 10 MB. Para PDF, exporta primero una imagen. Arrastra para dibujar; mueve el rectángulo o sus esquinas para ajustarlo. Con el rectángulo enfocado, usa las flechas para moverlo; en una esquina, las flechas cambian el tamaño.</p>
 <div id="planReplacement" class="plan-warning" hidden><strong>Nuevo plano seleccionado</strong><p>Al guardarlo se quitarán las ubicaciones y los pisos asignados del plano anterior. Los dispositivos y su historial se conservan. Las zonas anteriores se sustituirán por las que dibujes aquí.</p><label><input id="planReset" type="checkbox">Confirmo retirar las ubicaciones del plano anterior.</label></div>
 <div class="plan-editor-layout"><div><div class="plan-stage" id="planStage"><img id="planImage" alt="Plano de la planta para configurar zonas" draggable="false"><div id="planZoneOverlay"></div></div><p id="planDrawHint" role="status">Selecciona una zona para editar su nombre y sus pisos.</p></div><div><label class="plan-zone-select">Zona a editar<select id="planZoneSelect" data-glide-skip></select></label><div id="planZoneFields"></div></div></div>
 <div class="settings-footer"><button type="button" id="planSave" class="primary-button">Guardar plano y zonas</button></div></div>`;
 $('#settingsContent').prepend(panel);
 let config=null,zones=[],selected='',drawing=false,gesture=null,upload=null,preview=null,busy=false,dirty=false,generation=0;
 const setError=message=>{$('#planError').textContent=message||'';$('#planError').hidden=!message};
 const current=()=>zones.find(z=>z.id===selected);
 function rectStyle(z){return `left:${z.x}%;top:${z.y}%;width:${z.width}%;height:${z.height}%`}
 function overlay(){
  $('#planZoneOverlay').innerHTML=zones.map(z=>`<div class="plan-zone ${z.id===selected?'selected':''}" style="${rectStyle(z)}"><button type="button" class="plan-zone-move" data-zone="${z.id}" aria-label="Mover zona ${esc(z.name)}"><span>${esc(z.name)}</span></button>${z.id===selected?['nw','ne','sw','se'].map(c=>`<button type="button" class="plan-handle ${c}" data-zone="${z.id}" data-corner="${c}" aria-label="Ajustar esquina ${c} de ${esc(z.name)}"></button>`).join(''):''}</div>`).join('');
 }
 function render(){
  $('#planFilename').textContent=upload?.name||config?.filename||'';
  $('#planZoneSelect').innerHTML=zones.length?zones.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join(''):'<option value="">Sin zonas con pisos</option>';
  if(!current())selected=zones[0]?.id||'';$('#planZoneSelect').value=selected;
  const z=current();$('#planZoneFields').innerHTML=z?`<label>Nombre de la zona<input id="planZoneName" maxlength="100" value="${esc(z.name)}" required></label><h3>Pisos de esta zona</h3><p class="settings-note">Puedes cambiar nombres y agregar pisos. Al quitar un piso utilizado, los equipos quedarán con piso sin asignar.</p><div class="plan-floors">${z.floors.map(f=>`<div><input aria-label="Nombre del piso" data-floor-name="${f.id}" maxlength="80" value="${esc(f.name)}"><button class="text-button" type="button" data-remove-floor="${f.id}" aria-label="Quitar piso ${esc(f.name)}">Quitar</button></div>`).join('')}</div><button class="secondary-button" type="button" id="planAddFloor">Agregar piso</button><button class="text-button plan-delete" type="button" id="planDeleteZone">Eliminar zona</button>`:'<p class="settings-note">El plano puede funcionar sin pisos. Usa «Añadir zona con pisos» para crear un edificio u oficinas.</p>';
  $('#planStage').classList.toggle('drawing',drawing);$('#planDraw').setAttribute('aria-pressed',String(drawing));overlay();
 }
 async function load(force=false){
  if(busy||dirty&&!force)return;
  const request=++generation;busy=true;$('#planStatus').textContent='Cargando plano…';setError('');
  try{const next=await mesaPlan.load();if(request!==generation){mesaPlan.release(next);return}mesaPlan.release(config);if(preview)URL.revokeObjectURL(preview);preview=null;config=next;zones=structuredClone(next.zones);selected=zones[0]?.id||'';upload=null;drawing=false;dirty=false;$('#planUpload').value='';$('#planReset').checked=false;$('#planReplacement').hidden=true;$('#planImage').src=next.src;$('#planEditorContent').hidden=false;render();$('#planStatus').textContent=''}
  catch(e){setError(e.message);$('#planStatus').textContent=''}finally{busy=false}
 }
 $('#planReload').onclick=()=>{if(!dirty||confirm('¿Descartar los cambios del plano sin guardar?')){dirty=false;load(true)}};
 $('#planZoneSelect').onchange=e=>{selected=e.target.value;render()};
 $('#planDraw').onclick=()=>{drawing=!drawing;$('#planDrawHint').textContent=drawing?'Arrastra sobre el plano para dibujar una zona. Escape cancela.':'Selecciona una zona para editarla.';render()};
 $('#planUpload').onchange=async e=>{
  const file=e.target.files[0];if(!file||busy)return;setError('');
  if(file.size>10*1024*1024){setError('El plano debe pesar menos de 10 MB.');return}
  busy=true;$('#planSave').disabled=true;
  const src=URL.createObjectURL(file),image=new Image();image.src=src;
  try{await image.decode();if(image.naturalWidth>20000||image.naturalHeight>20000)throw Error('El plano es demasiado grande. Máximo 20 000 píxeles por lado.');
   const encoded=(await encodeFiles([file]))[0];if(preview)URL.revokeObjectURL(preview);preview=src;upload=encoded;zones=[];selected='';dirty=true;drawing=false;$('#planImage').src=src;$('#planReplacement').hidden=false;$('#planReset').checked=false;render();
  }catch(error){URL.revokeObjectURL(src);setError(error.message||'No se pudo abrir la imagen.')}finally{busy=false;$('#planSave').disabled=false}
 };
 $('#planZoneFields').addEventListener('input',e=>{const z=current();if(!z)return;if(e.target.id==='planZoneName'){z.name=e.target.value;overlay()}else if(e.target.dataset.floorName){z.floors.find(f=>f.id===e.target.dataset.floorName).name=e.target.value}dirty=true});
 $('#planZoneFields').addEventListener('click',e=>{const z=current();if(!z)return;
  if(e.target.id==='planAddFloor'){if(z.floors.length>=20)return setError('Máximo 20 pisos por zona.');z.floors.push({id:'floor-'+crypto.randomUUID(),name:'Nuevo piso'});dirty=true;render()}
  if(e.target.dataset.removeFloor){if(z.floors.length===1)return setError('La zona necesita al menos un piso.');z.floors=z.floors.filter(f=>f.id!==e.target.dataset.removeFloor);dirty=true;render()}
  if(e.target.id==='planDeleteZone'&&confirm('¿Eliminar esta zona? Sus equipos conservarán la ubicación y quedarán sin piso asignado.')){zones=zones.filter(item=>item.id!==z.id);selected='';dirty=true;render()}
 });
 const point=e=>{const r=$('#planStage').getBoundingClientRect();return {x:Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),y:Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))}};
 const stage=$('#planStage');
 stage.addEventListener('pointerdown',e=>{
  if(e.button!==0||busy)return;const target=e.target.closest('[data-zone]');
  if(!drawing&&!target)return;e.preventDefault();const p=point(e);
  if(drawing){const z={id:'zone-'+crypto.randomUUID(),name:'Nueva zona',x:p.x,y:p.y,width:0,height:0,floors:[{id:'ground',name:'Planta baja'},{id:'upper',name:'Planta alta'}]};zones.push(z);selected=z.id;gesture={type:'draw',start:p,original:structuredClone(z),pointer:e.pointerId};}
  else{selected=target.dataset.zone;gesture={type:target.dataset.corner||'move',start:p,original:structuredClone(current()),pointer:e.pointerId}}
  stage.setPointerCapture(e.pointerId);overlay();
 });
 stage.addEventListener('pointermove',e=>{
  if(!gesture||e.pointerId!==gesture.pointer)return;const z=current(),p=point(e),o=gesture.original,dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
  if(gesture.type==='draw'){z.x=Math.min(p.x,gesture.start.x);z.y=Math.min(p.y,gesture.start.y);z.width=Math.abs(dx);z.height=Math.abs(dy)}
  else if(gesture.type==='move'){z.x=Math.max(0,Math.min(100-o.width,o.x+dx));z.y=Math.max(0,Math.min(100-o.height,o.y+dy))}
  else{let left=o.x,right=o.x+o.width,top=o.y,bottom=o.y+o.height;if(gesture.type.includes('w'))left=Math.min(right-.2,p.x);else right=Math.max(left+.2,p.x);if(gesture.type.includes('n'))top=Math.min(bottom-.2,p.y);else bottom=Math.max(top+.2,p.y);Object.assign(z,{x:left,y:top,width:right-left,height:bottom-top})}
  overlay();
 });
 const finish=e=>{if(!gesture||e.pointerId!==gesture.pointer)return;if(current().width<.2||current().height<.2)zones=zones.filter(z=>z.id!==selected);else dirty=true;gesture=null;drawing=false;render();$('#planDrawHint').textContent='Ajusta el nombre y los pisos de la zona; luego guarda los cambios.'};
 stage.addEventListener('pointerup',finish);stage.addEventListener('pointercancel',e=>{if(!gesture)return;const z=current();Object.assign(z,gesture.original);if(gesture.type==='draw')zones=zones.filter(item=>item.id!==selected);gesture=null;render()});
 stage.addEventListener('keydown',e=>{const target=e.target.closest('[data-zone]');if(!target||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();selected=target.dataset.zone;const z=current(),step=e.shiftKey?2:.25,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
  if(target.dataset.corner){const c=target.dataset.corner;if(c.includes('e'))z.width=Math.max(.2,Math.min(100-z.x,z.width+dx));else{const x=Math.max(0,Math.min(z.x+z.width-.2,z.x+dx));z.width+=z.x-x;z.x=x}if(c.includes('s'))z.height=Math.max(.2,Math.min(100-z.y,z.height+dy));else{const y=Math.max(0,Math.min(z.y+z.height-.2,z.y+dy));z.height+=z.y-y;z.y=y}}
  else{z.x=Math.max(0,Math.min(100-z.width,z.x+dx));z.y=Math.max(0,Math.min(100-z.height,z.y+dy))}dirty=true;const selector=target.dataset.corner?`[data-corner="${target.dataset.corner}"]`:'.plan-zone-move';overlay();stage.querySelector(selector)?.focus();
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawing){drawing=false;if(gesture?.type==='draw')zones=zones.filter(z=>z.id!==selected);gesture=null;render()}});
 $('#planSave').onclick=async()=>{
  if(busy||!config)return;setError('');busy=true;$('#planSave').disabled=true;
  try{if(upload&&!$('#planReset').checked)throw Error('Confirma retirar las ubicaciones anteriores antes de reemplazar el plano.');
   await api('/api/admin/config/plan',{method:'PATCH',body:JSON.stringify({revision:config.revision,zones,...(upload?{image:upload,reset_locations:true}:{})})});
   dirty=false;document.dispatchEvent(new Event('mesa:plan-updated'));showToast('Plano actualizado','Las zonas y pisos ya están disponibles en Dispositivos.');busy=false;await load(true);
  }catch(error){setError(error.message)}finally{busy=false;$('#planSave').disabled=false}
 };
 document.addEventListener('mesa:view',e=>{if(e.detail==='settings')load()});
 new MutationObserver(()=>{if($('#adminShell').hidden){generation++;mesaPlan.release(config);if(preview)URL.revokeObjectURL(preview);config=null;preview=null;upload=null;zones=[];dirty=false;$('#planImage').removeAttribute('src');$('#planEditorContent').hidden=true;}}).observe($('#adminShell'),{attributes:true,attributeFilter:['hidden']});
})();
