/* Shared authenticated plan loader. Uploaded drawings stay private to TI. */
window.mesaPlan={
 async load(){
  const config=await api('/api/admin/config/plan');
  if(config.custom){
   const response=await fetch(config.image_url,{headers:{Authorization:`Bearer ${sessionStorage.getItem('mesaTiToken')}`}});
   if(!response.ok)throw new Error('No se pudo cargar la imagen del plano.');
   config.src=URL.createObjectURL(await response.blob());
  }else config.src=config.image_url;
  return config;
 },
 release(config){if(config?.src?.startsWith('blob:'))URL.revokeObjectURL(config.src)},
 zoneAt(zones,device){return device.x!=null&&device.y!=null?zones.find(z=>device.x>=z.x&&device.x<=z.x+z.width&&device.y>=z.y&&device.y<=z.y+z.height):null}
};
