"""Shared support information and active catalogs, with historical text preserved."""
import json
import re

SCHEMA = """
CREATE TABLE IF NOT EXISTS app_configuration (
 id INTEGER PRIMARY KEY CHECK (id=1), support JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS config_catalog (
 id SERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('area','category')),
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS config_catalog_name_idx ON config_catalog(kind,lower(name));
"""
DEFAULT_SUPPORT = {'technician_name':'Miguel Arroyo','site_name':'Planta México','extension':'2401','email':'','hours':'Consulta disponibilidad con Sistemas'}
DEFAULT_AREAS = ['Sistemas','Producción','Calidad','Recursos Humanos','Finanzas','Almacén','Mantenimiento']
DEFAULT_CATEGORIES = {
 'Hardware':'Computadora, monitor, impresora o periféricos.',
 'Software':'Programas, instalaciones, errores o actualizaciones.',
 'Red':'Internet, Wi-Fi, carpetas compartidas o VPN.',
 'Accesos':'Usuarios, contraseñas, permisos o correo.',
 'Otro':'Otras solicitudes de soporte de Sistemas.'
}
LIMITS = {'technician_name':100,'site_name':80,'extension':30,'email':160,'hours':160}
SUPPORT_LABELS = {'technician_name':'Nombre visible','site_name':'Planta / sede','extension':'Extensión','email':'Correo','hours':'Horario de atención'}

def seed(db):
    with db() as c:
        fresh=c.execute('INSERT INTO app_configuration(id,support) VALUES(1,%s::jsonb) ON CONFLICT DO NOTHING RETURNING id',(json.dumps(DEFAULT_SUPPORT),)).fetchone()
        if not fresh: return
        areas=set(DEFAULT_AREAS)
        areas.update(r['area'] for r in c.execute("SELECT area FROM tickets UNION SELECT area FROM devices").fetchall() if r['area'])
        categories=set(DEFAULT_CATEGORIES)
        categories.update(r['category'] for r in c.execute('SELECT DISTINCT category FROM tickets').fetchall() if r['category'])
        for kind,names in [('area',areas),('category',categories)]:
            for name in sorted(names):
                c.execute('INSERT INTO config_catalog(kind,name,description) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',(kind,name,DEFAULT_CATEGORIES.get(name,'') if kind=='category' else ''))

def support(c):
    row=c.execute('SELECT support FROM app_configuration WHERE id=1').fetchone()
    return {k:row['support'].get(k,default) if row else default for k,default in DEFAULT_SUPPORT.items()}

def configuration(c, private=False):
    rows=c.execute('SELECT id,kind,name,description,active FROM config_catalog'+('' if private else ' WHERE active')+' ORDER BY lower(name),id').fetchall()
    return {'support':support(c),'areas':[{k:v for k,v in r.items() if k!='kind'} for r in rows if r['kind']=='area'],
            'categories':[{k:v for k,v in r.items() if k!='kind'} for r in rows if r['kind']=='category']}

def active_choice(c, kind, value, previous=None):
    if not isinstance(value,str) or not value.strip(): raise ValueError('Selecciona un área o categoría válida')
    value=value.strip()
    if previous is not None and value==previous: return previous
    row=c.execute('SELECT name FROM config_catalog WHERE kind=%s AND lower(name)=lower(%s) AND active FOR SHARE',(kind,value)).fetchone()
    if not row:
        label='El área' if kind=='area' else 'La categoría'
        raise ValueError(f'{label} ya no está disponible. Actualiza las opciones y selecciona otra.')
    return row['name']

def text(value, label, limit, required=True):
    if not isinstance(value,str) or len(value)>limit or any(ord(char)<32 for char in value): raise ValueError(f'{label}: texto inválido (máximo {limit} caracteres)')
    value=value.strip()
    if required and not value: raise ValueError(f'Completa {label.lower()}')
    return value

def handle(handler,path,method,db,data=None):
    if path!='/api/config' and not (path=='/api/admin/config' or path.startswith('/api/admin/config/')):return False
    if path=='/api/config':
        if method!='GET':handler.json(405,{'error':'Método no permitido'});return True
        with db() as c:handler.json(200,configuration(c))
        return True
    if not handler.admin():return True
    try:
        with db() as c:
            if method=='GET' and path=='/api/admin/config':
                handler.json(200,configuration(c,True));return True
            if not isinstance(data,dict):raise ValueError('Datos inválidos')
            c.execute('SELECT id FROM app_configuration WHERE id=1 FOR UPDATE')
            if method=='PATCH' and path=='/api/admin/config/support':
                fields={k:v for k,v in data.items() if k in LIMITS}
                if not fields:raise ValueError('Sin cambios válidos')
                updated={**support(c),**fields}
                updated={k:text(v,SUPPORT_LABELS[k],LIMITS[k],k not in ('email','extension')) for k,v in updated.items()}
                if updated['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',updated['email']):raise ValueError('Escribe un correo válido o deja el campo vacío')
                c.execute('UPDATE app_configuration SET support=%s::jsonb,updated_at=NOW() WHERE id=1',(json.dumps(updated),))
            elif method=='POST' and path in ('/api/admin/config/catalogs/area','/api/admin/config/catalogs/category'):
                kind=path.rsplit('/',1)[-1]
                name=text(data.get('name'),'Nombre',100)
                description=text(data.get('description',''),'Descripción',250,False)
                c.execute('INSERT INTO config_catalog(kind,name,description) VALUES(%s,%s,%s)',(kind,name,description))
            elif method=='PATCH' and path.startswith('/api/admin/config/catalogs/') and path.rsplit('/',1)[-1].isdigit():
                ident=int(path.rsplit('/',1)[-1])
                row=c.execute('SELECT * FROM config_catalog WHERE id=%s FOR UPDATE',(ident,)).fetchone()
                if not row:handler.json(404,{'error':'Opción no encontrada'});return True
                name=text(data.get('name',row['name']),'Nombre',100)
                description=text(data.get('description',row['description']),'Descripción',250,False)
                active=data.get('active',row['active'])
                if not isinstance(active,bool):raise ValueError('Estado inválido')
                if row['active'] and not active and c.execute('SELECT COUNT(*) AS n FROM config_catalog WHERE kind=%s AND active',(row['kind'],)).fetchone()['n']<=1:
                    raise ValueError('Debe quedar al menos una opción activa en cada catálogo')
                c.execute('UPDATE config_catalog SET name=%s,description=%s,active=%s,updated_at=NOW() WHERE id=%s',(name,description,active,ident))
            else:handler.json(404,{'error':'Ruta no encontrada'});return True
            c.commit()
            handler.json(201 if method=='POST' else 200,configuration(c,True))
    except ValueError as error:handler.json(400,{'error':str(error)})
    except Exception as error:
        if getattr(error,'sqlstate',None)=='23505':handler.json(409,{'error':'Ya existe una opción con ese nombre en el catálogo. Puedes reactivar la existente.'})
        else:
            print('Error de configuración:',type(error).__name__)
            handler.json(500,{'error':'No se pudo guardar la configuración'})
    return True
