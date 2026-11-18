/* Account management stays separate from ticket and catalog rendering. */
document.addEventListener('DOMContentLoaded',()=>{
  const $=selector=>document.querySelector(selector);
  const section=document.createElement('section');section.className='panel settings-panel';
  section.innerHTML='<h2>Mi cuenta</h2><p class="settings-note">Los cambios y comentarios se registran con tu usuario de TI.</p><button id="changeMyPassword" class="secondary-button">Cambiar mi contraseña</button><div id="accountsAdmin" hidden><div class="settings-catalog-head"><h2>Cuentas de TI</h2><button id="addAccount" class="secondary-button">Agregar cuenta</button></div><p class="settings-note">Cada técnico debe usar su propia cuenta. Cambiar permisos, contraseña o estado cierra sus sesiones.</p><ul id="accountsList" class="settings-catalog-list"></ul></div><p id="accountError" role="alert" class="settings-error" hidden></p>';
  $('#settingsContent').append(section);
  const dialog=document.createElement('dialog');dialog.className='report-dialog';dialog.id='accountDialog';dialog.setAttribute('aria-labelledby','accountTitle');
  dialog.innerHTML='<form id="accountForm"><header><h2 id="accountTitle">Cuenta de TI</h2><button type="button" class="close-button" id="closeAccount" aria-label="Cerrar cuenta">×</button></header><div class="settings-fields"><label id="accountNameLabel">Usuario<input name="username" autocomplete="off" minlength="3" maxlength="80"></label><label id="accountCurrentLabel" hidden>Contraseña actual<input name="current_password" type="password" autocomplete="current-password"></label><label>Nueva contraseña<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><label id="accountRoleLabel"><span><input name="is_admin" type="checkbox"> Administrador de cuentas</span></label></div><p class="settings-note">Usa al menos 12 caracteres.</p><p id="accountFormError" class="settings-error" role="alert" hidden></p><footer><button type="submit" class="primary-button" id="saveAccount">Guardar</button><button type="button" class="secondary-button" id="cancelAccount">Cancelar</button></footer></form>';
  document.body.append(dialog);
  let accounts=[],mode='create',editing=null,busy=false,loadVersion=0,opener=null;
  async function load(){
    const version=++loadVersion;$('#accountsAdmin').hidden=!sessionUser?.is_admin;
    if(!sessionUser?.is_admin)return;
    try{const rows=await api('/api/admin/users');if(version!==loadVersion||!sessionUser)return;accounts=rows;
      $('#accountsList').innerHTML=rows.map(user=>`<li><div class="settings-catalog-name"><strong>${safe(user.username)}</strong><p>${user.is_admin?'Administrador':'Técnico'} · ${user.active?'Activa':'Inactiva'}</p></div><div class="settings-catalog-actions">${user.id===sessionUser.id?'<small>Tu cuenta</small>':`<button class="secondary-button" data-account-password="${user.id}">Restablecer contraseña</button><button class="secondary-button" data-account-role="${user.id}">${user.is_admin?'Hacer técnico':'Hacer administrador'}</button><button class="secondary-button" data-account-toggle="${user.id}">${user.active?'Desactivar':'Reactivar'}</button>`}</div></li>`).join('');
    }catch(error){$('#accountError').textContent=error.message;$('#accountError').hidden=false;}
  }
  function open(next,user=null){
    mode=next;editing=user;opener=document.activeElement;$('#accountForm').reset();$('#accountFormError').hidden=true;
    $('#accountTitle').textContent=mode==='self'?'Cambiar mi contraseña':mode==='reset'?`Restablecer: ${user.username}`:'Agregar cuenta de TI';
    $('#accountNameLabel').hidden=mode!=='create';$('#accountForm').elements.username.required=mode==='create';
    $('#accountCurrentLabel').hidden=mode!=='self';$('#accountForm').elements.current_password.required=mode==='self';$('#accountRoleLabel').hidden=mode!=='create';dialog.showModal();
    $('#accountForm').elements[mode==='create'?'username':mode==='self'?'current_password':'password'].focus();
  }
  function close(){if(busy)return;dialog.close();$('#accountForm').reset();opener?.focus();}
  $('#changeMyPassword').addEventListener('click',()=>open('self'));
  $('#addAccount').addEventListener('click',()=>open('create'));
  $('#closeAccount').addEventListener('click',close);$('#cancelAccount').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('#accountForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;$('#saveAccount').disabled=true;$('#accountFormError').hidden=true;
    const form=event.currentTarget,data={password:form.elements.password.value};
    if(mode==='create'){data.username=form.elements.username.value;data.is_admin=form.elements.is_admin.checked;}
    if(mode==='self')data.current_password=form.elements.current_password.value;
    try{await api(mode==='self'?'/api/auth/password':mode==='reset'?`/api/admin/users/${editing.id}`:'/api/admin/users',{method:mode==='reset'?'PATCH':'POST',body:JSON.stringify(data)});
      dialog.close();form.reset();if(mode==='self'){showPublic();showToast('Contraseña actualizada','Inicia sesión con tu nueva contraseña.');}else{await load();showToast('Cuenta guardada','Los cambios de acceso ya están aplicados.');}
    }catch(error){$('#accountFormError').textContent=error.message;$('#accountFormError').hidden=false;}finally{busy=false;$('#saveAccount').disabled=false;}
  });
  section.addEventListener('click',async event=>{
    const button=event.target.closest('[data-account-toggle],[data-account-role],[data-account-password]');if(!button)return;
    const user=accounts.find(item=>item.id===Number(button.dataset.accountToggle||button.dataset.accountRole||button.dataset.accountPassword));if(!user)return;
    if(button.dataset.accountPassword){open('reset',user);return;}
    button.disabled=true;$('#accountError').hidden=true;
    try{await api(`/api/admin/users/${user.id}`,{method:'PATCH',body:JSON.stringify(button.dataset.accountToggle?{active:!user.active}:{is_admin:!user.is_admin})});await load();}
    catch(error){$('#accountError').textContent=error.message;$('#accountError').hidden=false;}finally{button.disabled=false;}
  });
  $('#settingsNav').addEventListener('click',load);
  document.addEventListener('mesa:session-changed',()=>{if(!sessionUser){loadVersion++;accounts=[];$('#accountsList').replaceChildren();$('#accountsAdmin').hidden=true;dialog.close();$('#accountForm').reset();}});

});
