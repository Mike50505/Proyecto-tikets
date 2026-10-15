"""Device relationships and maintenance schedule, with dates in Mexico City."""
import calendar
from datetime import date, timedelta

SCHEMA = """
ALTER TABLE devices ADD COLUMN IF NOT EXISTS maintenance_interval_months INTEGER NOT NULL DEFAULT 6 CHECK (maintenance_interval_months BETWEEN 1 AND 24);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS maintenance_due DATE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS device_id INTEGER REFERENCES devices(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS tickets_device_idx ON tickets(device_id);
CREATE TABLE IF NOT EXISTS device_maintenance (
 id BIGSERIAL PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES devices(id),
 performed_on DATE NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('Preventivo','Correctivo')),
 work TEXT NOT NULL, technician TEXT NOT NULL, next_due DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS device_maintenance_device_idx ON device_maintenance(device_id, performed_on DESC, id DESC);
"""

DEVICE_COLUMNS = 'id,name,kind,area,owner,last_maintenance,maintenance_interval_months,maintenance_due'

def add_months(value, months):
    count=value.year*12+value.month-1+months
    year,month=divmod(count,12);month+=1
    return date(year,month,min(value.day,calendar.monthrange(year,month)[1]))

def today(c):
    return c.execute("SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS today").fetchone()['today']

def serialize(row):
    return {k:v.isoformat() if hasattr(v,'isoformat') else v for k,v in row.items()}

def schedule(row, now):
    due=row['maintenance_due'] or (add_months(row['last_maintenance'],row['maintenance_interval_months']) if row['last_maintenance'] else None)
    status='unscheduled' if not due else 'overdue' if due<now else 'today' if due==now else 'soon' if due<=now+timedelta(days=30) else 'scheduled'
    return {**serialize(row),'next_maintenance':due.isoformat() if due else None,'maintenance_status':status}

def device_link(c, value):
    if value in (None,''): return {'device_id':None,'device_name':''}
    if isinstance(value,bool) or not str(value).isdigit() or int(value)<1:
        raise ValueError('Dispositivo inválido')
    row=c.execute('SELECT id,name FROM devices WHERE id=%s FOR KEY SHARE',(int(value),)).fetchone()
    if not row: raise ValueError('El dispositivo ya no está disponible')
    return {'device_id':row['id'],'device_name':row['name']}

def name_link(c, name):
    if not isinstance(name,str) or len(name)>200: raise ValueError('Nombre de computadora inválido')
    name=name.strip()
    rows=c.execute('SELECT id,name FROM devices WHERE lower(name)=lower(%s) FOR KEY SHARE',(name,)).fetchall() if name else []
    return {'device_id':rows[0]['id'],'device_name':rows[0]['name']} if len(rows)==1 else {'device_id':None,'device_name':name}

def parse_date(value, label):
    try: return date.fromisoformat(value)
    except (TypeError,ValueError): raise ValueError(f'{label}: fecha inválida')

def interval(value):
    if isinstance(value,bool) or not str(value).isdigit() or not 1<=int(value)<=24:
        raise ValueError('La frecuencia debe ser de 1 a 24 meses')
    return int(value)

def handle(handler,path,method,db,data=None,actor='Sistemas'):
    parts=path.strip('/').split('/')
    history=len(parts)==4 and parts[:2]==['api','devices'] and parts[2].isdigit() and parts[3]=='history'
    if not (path=='/api/maintenance' or path.startswith('/api/maintenance/') or history): return False
    if not handler.admin(): return True
    try:
        with db() as c:
            now=today(c)
            if method=='GET' and path=='/api/maintenance':
                rows=c.execute(f'SELECT {DEVICE_COLUMNS} FROM devices ORDER BY lower(name)').fetchall()
                handler.json(200,{'today':now.isoformat(),'devices':[schedule(r,now) for r in rows]})
            elif method=='GET' and history:
                row=c.execute(f'SELECT {DEVICE_COLUMNS} FROM devices WHERE id=%s',(int(parts[2]),)).fetchone()
                if not row: handler.json(404,{'error':'Dispositivo no encontrado'})
                else:
                    tickets=c.execute('SELECT code,subject,status,priority,created_at,closed_at,deleted_at,device_name FROM tickets WHERE device_id=%s ORDER BY created_at DESC,id DESC',(row['id'],)).fetchall()
                    entries=c.execute('SELECT * FROM device_maintenance WHERE device_id=%s ORDER BY performed_on DESC,id DESC',(row['id'],)).fetchall()
                    handler.json(200,{'device':schedule(row,now),'tickets':[serialize(t) for t in tickets],'maintenance':[serialize(t) for t in entries]})
            elif method=='POST' and path in ('/api/maintenance/plan','/api/maintenance/records'):
                if not isinstance(data,dict): raise ValueError('Datos inválidos')
                linked=device_link(c,data.get('device_id'))
                if linked['device_id'] is None: raise ValueError('Selecciona un dispositivo')
                row=c.execute('SELECT * FROM devices WHERE id=%s FOR NO KEY UPDATE',(linked['device_id'],)).fetchone()
                if path.endswith('/plan'):
                    months=interval(data.get('interval_months',row['maintenance_interval_months']))
                    due=parse_date(data['next_maintenance'],'Próxima revisión') if data.get('next_maintenance') else None
                    if due and row['last_maintenance'] and due<=row['last_maintenance']:
                        raise ValueError('La próxima revisión debe ser posterior al último mantenimiento')
                    c.execute('UPDATE devices SET maintenance_interval_months=%s,maintenance_due=%s,updated_at=NOW() WHERE id=%s',(months,due,row['id']))
                    c.commit();handler.json(200,{'ok':True})
                else:
                    performed=parse_date(data.get('performed_on'),'Fecha de mantenimiento')
                    if performed>now: raise ValueError('No puedes registrar un mantenimiento futuro como realizado')
                    kind=data.get('kind')
                    if kind not in ('Preventivo','Correctivo'): raise ValueError('Tipo de mantenimiento inválido')
                    work=data.get('work','');technician=data.get('technician',actor)
                    if not isinstance(work,str) or not work.strip() or len(work)>4000:
                        raise ValueError('Describe el trabajo realizado (máximo 4000 caracteres)')
                    if not isinstance(technician,str) or not technician.strip() or len(technician)>200:
                        raise ValueError('Escribe quién realizó el mantenimiento (máximo 200 caracteres)')
                    explicit=parse_date(data['next_maintenance'],'Próxima revisión') if data.get('next_maintenance') else None
                    if explicit and explicit<=performed: raise ValueError('La próxima revisión debe ser posterior al mantenimiento realizado')
                    latest=not row['last_maintenance'] or performed>=row['last_maintenance']
                    if not latest and explicit: raise ValueError('Un mantenimiento anterior no puede cambiar la próxima revisión. Usa Programar.')
                    due=explicit or add_months(performed,row['maintenance_interval_months'])
                    record=c.execute('INSERT INTO device_maintenance(device_id,performed_on,kind,work,technician,next_due) VALUES(%s,%s,%s,%s,%s,%s) RETURNING *',
                        (row['id'],performed,kind,work.strip(),technician.strip(),due)).fetchone()
                    if latest: c.execute('UPDATE devices SET last_maintenance=%s,maintenance_due=%s,updated_at=NOW() WHERE id=%s',(performed,due,row['id']))
                    c.commit();handler.json(201,serialize(record))
            else: handler.json(404,{'error':'Ruta no encontrada'})
    except ValueError as e: handler.json(400,{'error':str(e)})
    return True
