"""Per-installation plans and non-overlapping, percentage-based floor zones."""
import base64
import json
import math
import re
import struct
import xml.etree.ElementTree as ET

DEFAULT_ZONES=[{'id':f'office-{i+1}','name':f'Oficina {i+1}',
    'x':left/7.92,'y':388/6.12,'width':(right-left)/7.92,'height':58/6.12,
    'floors':[{'id':'ground','name':'Planta baja'},{'id':'upper','name':'Planta alta'}]}
    for i,(left,right) in enumerate([(145,229),(379,468),(609,695)])]
SCHEMA="""
CREATE TABLE IF NOT EXISTS plant_plan (
 id INTEGER PRIMARY KEY CHECK(id=1), zones JSONB NOT NULL, image BYTEA,
 mime TEXT, filename TEXT NOT NULL DEFAULT 'Bodegas Ramos · Plano V.06', revision INTEGER NOT NULL DEFAULT 1
);
INSERT INTO plant_plan(id,zones) VALUES(1,'%s'::jsonb) ON CONFLICT DO NOTHING;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_floor_check;
""" % json.dumps(DEFAULT_ZONES,ensure_ascii=True)

def read(c,lock=False):
    row=c.execute('SELECT zones,filename,revision,image IS NOT NULL AS custom FROM plant_plan WHERE id=1'+(' FOR UPDATE' if lock else ' FOR SHARE')).fetchone()
    return {**row,'image_url':f"/api/plan/image?v={row['revision']}" if row['custom'] else 'Bodegas_Ramos_V06.svg'}

def zone_at(zones,x,y):
    if x is None or y is None:return None
    return next((z for z in zones if z['x']<=x<=z['x']+z['width'] and z['y']<=y<=z['y']+z['height']),None)

def validate_zones(value):
    if not isinstance(value,list) or len(value)>40:raise ValueError('Máximo 40 zonas por plano.')
    zones=[];ids=set()
    for z in value:
        if not isinstance(z,dict):raise ValueError('Zona inválida.')
        ident=z.get('id');name=z.get('name')
        if not isinstance(ident,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',ident) or ident in ids:raise ValueError('Identificador de zona inválido o repetido.')
        if not isinstance(name,str) or not name.strip() or len(name)>100:raise ValueError('Indica un nombre de zona (máximo 100 caracteres).')
        ids.add(ident);rect={}
        for key in ('x','y','width','height'):
            n=z.get(key)
            if isinstance(n,bool) or not isinstance(n,(float,int)) or not math.isfinite(n):raise ValueError('Rectángulo inválido.')
            rect[key]=round(n,4)
        if rect['x']<0 or rect['y']<0 or rect['width']<.2 or rect['height']<.2 or rect['x']+rect['width']>100.0001 or rect['y']+rect['height']>100.0001:raise ValueError('La zona debe quedar dentro del plano y tener un tamaño visible.')
        floors=z.get('floors')
        if not isinstance(floors,list) or not 1<=len(floors)<=20:raise ValueError('Cada zona necesita entre 1 y 20 pisos.')
        clean=[];floor_ids=set()
        for f in floors:
            if not isinstance(f,dict) or not isinstance(f.get('id'),str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}',f['id']) or f['id'] in floor_ids:raise ValueError('Identificador de piso inválido o repetido.')
            if not isinstance(f.get('name'),str) or not f['name'].strip() or len(f['name'])>80:raise ValueError('Indica el nombre de cada piso (máximo 80 caracteres).')
            floor_ids.add(f['id']);clean.append({'id':f['id'],'name':f['name'].strip()})
        item={'id':ident,'name':name.strip(),**rect,'floors':clean}
        for other in zones:
            if item['x']<other['x']+other['width'] and item['x']+item['width']>other['x'] and item['y']<other['y']+other['height'] and item['y']+item['height']>other['y']:raise ValueError('Las zonas no pueden solaparse. Ajusta los rectángulos.')
        zones.append(item)
    return zones

def decode_image(value):
    if not isinstance(value,dict) or not isinstance(value.get('data'),str) or len(value['data'])>14*1024*1024:raise ValueError('Plano inválido. Máximo 10 MB.')
    try:raw=base64.b64decode(value['data'],validate=True)
    except Exception:raise ValueError('Archivo de plano inválido.')
    if not raw or len(raw)>10*1024*1024:raise ValueError('El plano debe pesar menos de 10 MB.')
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        if len(raw)<33 or raw[12:16]!=b'IHDR':raise ValueError('Imagen PNG incompleta.')
        width,height=struct.unpack('>II',raw[16:24]);mime='image/png'
        if not 0<width<=20000 or not 0<height<=20000:raise ValueError('Máximo 20 000 píxeles por lado.')
    elif raw.startswith(b'\xff\xd8\xff'):
        mime='image/jpeg'
        if not raw.endswith(b'\xff\xd9'):raise ValueError('Imagen JPG incompleta.')
    else:
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('SVG no permitido: contiene declaraciones externas.')
        try:root=ET.fromstring(raw)
        except ET.ParseError:raise ValueError('Usa un plano PNG, JPG o SVG.')
        allowed={'svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','clipPath','mask','linearGradient','radialGradient','stop','use','title','desc','style','pattern','symbol'}
        if root.tag.split('}')[-1]!='svg':raise ValueError('Archivo SVG inválido.')
        for element in root.iter():
            if element.tag.split('}')[-1] not in allowed:raise ValueError('El SVG contiene elementos no admitidos. Exporta una imagen PNG.')
            for k,v in element.attrib.items():
                key=k.split('}')[-1].lower()
                if key.startswith('on') or (key=='href' and not v.startswith('#')):raise ValueError('El SVG contiene enlaces o acciones no permitidos.')
            content=' '.join(element.attrib.values())+' '+(element.text or '')
            # Only internal paint references are permitted; no external resources or CSS escapes.
            if '\\' in content or re.search(r'@|url\(\s*[\'"]?(?!#)',content,re.I):raise ValueError('El SVG contiene recursos externos no permitidos.')
        raw=ET.tostring(root,encoding='utf-8');mime='image/svg+xml'
    filename=value.get('name','Plano de planta')
    if not isinstance(filename,str) or len(filename)>200:raise ValueError('Nombre de archivo inválido.')
    return raw,mime,filename

def validate_device(c,fields):
    plan=read(c);zone=zone_at(plan['zones'],fields['x'],fields['y'])
    floor=fields.get('floor','')
    if zone and floor and floor not in {f['id'] for f in zone['floors']}:raise ValueError('El piso no existe en la zona seleccionada. Actualiza el plano.')
    if not zone:fields['floor']=''

def handle(handler,path,method,db,data=None):
    if path not in ('/api/admin/config/plan','/api/plan/image'):return False
    if not handler.admin():return True
    try:
        with db() as c:
            if path=='/api/plan/image' and method=='GET':
                row=c.execute('SELECT image,mime FROM plant_plan WHERE id=1').fetchone()
                if not row['image']:handler.json(404,{'error':'No hay un plano personalizado.'});return True
                raw=bytes(row['image']);handler.send_response(200);handler.send_header('Content-Type',row['mime']);handler.send_header('Cache-Control','no-store');handler.send_header('X-Content-Type-Options','nosniff');handler.send_header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");handler.end_headers();handler.wfile.write(raw);return True
            if method=='GET':handler.json(200,read(c));return True
            if method!='PATCH' or path!='/api/admin/config/plan':handler.json(405,{'error':'Método no permitido'});return True
            if not isinstance(data,dict):raise ValueError('Datos inválidos.')
            current=read(c,True)
            if data.get('revision')!=current['revision']:handler.json(409,{'error':'El plano cambió en otra sesión. Recarga la configuración antes de guardar.'});return True
            zones=validate_zones(data.get('zones'))
            if data.get('image') is not None:
                raw,mime,name=decode_image(data['image'])
                if c.execute('SELECT 1 FROM devices WHERE x IS NOT NULL LIMIT 1').fetchone() and data.get('reset_locations') is not True:raise ValueError('Confirma que se retiren las ubicaciones anteriores al reemplazar el plano.')
                c.execute("UPDATE devices SET x=NULL,y=NULL,floor='',updated_at=NOW() WHERE x IS NOT NULL")
                c.execute('UPDATE plant_plan SET image=%s,mime=%s,filename=%s WHERE id=1',(raw,mime,name))
            else:
                # Preserve a device's zone identity; removed floors become unassigned, never another building's floor.
                for device in c.execute("SELECT id,x,y,floor FROM devices WHERE floor<>'' AND x IS NOT NULL").fetchall():
                    old=zone_at(current['zones'],device['x'],device['y']);new=zone_at(zones,device['x'],device['y'])
                    if not old or not new or old['id']!=new['id'] or device['floor'] not in {f['id'] for f in new['floors']}:
                        c.execute("UPDATE devices SET floor='',updated_at=NOW() WHERE id=%s",(device['id'],))
            c.execute('UPDATE plant_plan SET zones=%s::jsonb,revision=revision+1 WHERE id=1',(json.dumps(zones),))
            c.commit();handler.json(200,read(c))
    except ValueError as error:handler.json(400,{'error':str(error)})
    return True
