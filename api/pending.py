"""Shared staff checklist, independent of tickets."""
from datetime import date
from urllib.parse import urlparse, parse_qs

SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_tasks (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  assignee TEXT NOT NULL DEFAULT '',
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS pending_tasks_day_idx ON pending_tasks(due_date,id) WHERE archived_at IS NULL;
"""

def day(value):
    if not isinstance(value,str): raise ValueError('Selecciona una fecha válida')
    try:
        parsed=date.fromisoformat(value)
        if parsed.isoformat()!=value: raise ValueError()
        return parsed
    except ValueError: raise ValueError('Selecciona una fecha válida')

def fields(data):
    result={}
    for key,limit in [('title',180),('notes',5000),('assignee',100)]:
        if key not in data: continue
        value=data[key]
        if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 and c not in '\n\r\t' for c in value):
            raise ValueError(f'{key}: texto inválido (máximo {limit} caracteres)')
        value=value.strip()
        if key=='title' and not value: raise ValueError('Escribe qué necesitas hacer')
        result[key]=value
    if 'due_date' in data: result['due_date']=day(data['due_date'])
    if 'status' in data:
        if data['status'] not in ('todo','doing','done'): raise ValueError('Estado inválido')
        result['status']=data['status']
    return result

def output(row):
    return {k:v.isoformat() if hasattr(v,'isoformat') else v for k,v in row.items()}

def handle(handler,path,method,db,data=None):
    root='/api/pending'
    if path!=root and not path.startswith(root+'/'): return False
    if not handler.admin(): return True
    if path==root and method=='GET':
        query=parse_qs(urlparse(handler.path).query)
        scope=query.get('scope',['day'])[0]
        if scope not in ('day','all'): raise ValueError('Vista inválida')
        selected=day(query.get('date',[''])[0]) if scope=='day' else None
        where='archived_at IS NULL'
        params=()
        if selected:
            where+=" AND due_date<=%s AND (status<>'done' OR due_date=%s OR (completed_at AT TIME ZONE 'America/Mexico_City')::date=%s)"
            params=(selected,selected,selected)
        with db() as c:
            rows=c.execute('SELECT * FROM pending_tasks WHERE '+where+' ORDER BY due_date,id',params).fetchall()
        handler.json(200,{'items':[output(row) for row in rows]});return True
    if path==root and method=='POST':
        values=fields(data)
        if not values.get('title') or 'due_date' not in values: raise ValueError('Completa el pendiente y la fecha')
        with db() as c:
            row=c.execute("INSERT INTO pending_tasks(title,notes,assignee,due_date,created_by,updated_by) VALUES(%s,%s,%s,%s,%s,%s) RETURNING *",(values['title'],values.get('notes',''),values.get('assignee',''),values['due_date'],handler.user['username'],handler.user['username'])).fetchone()
        handler.json(201,output(row));return True
    task_id=path[len(root)+1:]
    if not task_id.isascii() or not task_id.isdigit() or len(task_id)>18 or method!='PATCH':
        handler.json(404,{'error':'Ruta no encontrada'});return True
    revision=data.get('revision')
    if type(revision) is not int or revision<1: raise ValueError('Actualiza el pizarrón antes de guardar')
    values=fields(data)
    archive=data.get('archive',False)
    if type(archive) is not bool: raise ValueError('Acción inválida')
    if not values and not archive: raise ValueError('Sin cambios válidos')
    with db() as c:
        row=c.execute('SELECT * FROM pending_tasks WHERE id=%s AND archived_at IS NULL FOR UPDATE',(int(task_id),)).fetchone()
        if not row: handler.json(404,{'error':'Pendiente no encontrado'});return True
        if row['revision']!=revision:
            handler.json(409,{'error':'Otra persona cambió este pendiente. Actualiza el pizarrón y vuelve a intentarlo.'});return True
        assignments=[key+'=%s' for key in values]
        args=list(values.values())
        if 'status' in values:
            if values['status']=='done' and row['status']!='done': assignments.append('completed_at=NOW()')
            elif values['status']!='done': assignments.append('completed_at=NULL')
        if archive: assignments.append('archived_at=NOW()')
        assignments.extend(['updated_at=NOW()','updated_by=%s','revision=revision+1'])
        args.extend([handler.user['username'],int(task_id)])
        row=c.execute('UPDATE pending_tasks SET '+','.join(assignments)+' WHERE id=%s RETURNING *',tuple(args)).fetchone()
    handler.json(200,output(row));return True
