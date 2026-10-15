"""Ticket lifecycle history. Historical close dates are never inferred from updates."""
import json
from maintenance import device_link
from settings import active_choice

SCHEMA = """
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS ticket_events (
 id BIGSERIAL PRIMARY KEY,
 ticket_id INTEGER NOT NULL REFERENCES tickets(id),
 action TEXT NOT NULL, actor TEXT NOT NULL,
 changes JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events(ticket_id, id);
"""

def seed_history(db):
    with db() as c:
        c.execute("""INSERT INTO ticket_events(ticket_id,action,actor,changes)
          SELECT id,'Registro previo','Sistema',%s::jsonb FROM tickets t
          WHERE NOT EXISTS (SELECT 1 FROM ticket_events e WHERE e.ticket_id=t.id)""",
          (json.dumps({'nota':'Ticket anterior al historial. No se conocen los cambios ni las fechas de cierre previas.'}),))

def event(c, ident, action, actor, changes=None):
    c.execute('INSERT INTO ticket_events(ticket_id,action,actor,changes) VALUES(%s,%s,%s,%s::jsonb)',
              (ident,action,actor,json.dumps(changes or {},ensure_ascii=False)))

def update(c, code, fields, actor):
    previous = c.execute('SELECT * FROM tickets WHERE code=%s AND deleted_at IS NULL FOR UPDATE',(code,)).fetchone()
    if not previous: return None
    if 'category' in fields:fields['category']=active_choice(c,'category',fields['category'],previous['category'])
    if 'device_id' in fields:
        if fields['device_id'] != previous['device_id']:
            fields={**fields,**device_link(c,fields['device_id'])}
        else: fields={k:v for k,v in fields.items() if k!='device_id'}
    changes = {k:{'antes':previous[k], 'despues':v} for k,v in fields.items() if previous[k] != v}
    if not changes: return previous
    sets = ','.join(f'{k}=%s' for k in fields)
    close = ''
    if 'status' in changes:
        close = ',closed_at=NOW()' if fields['status'] == 'Cerrado' else ',closed_at=NULL'
    row = c.execute(f'UPDATE tickets SET {sets},updated_at=NOW(){close} WHERE id=%s RETURNING *',list(fields.values())+[previous['id']]).fetchone()
    event(c, row['id'], 'Cambio de estado' if 'status' in changes else 'Actualización',actor,changes)
    return row

def archive(c, code, actor):
    row=c.execute('UPDATE tickets SET deleted_at=NOW(),updated_at=NOW() WHERE code=%s AND deleted_at IS NULL RETURNING id',(code,)).fetchone()
    if row: event(c,row['id'],'Archivado',actor)
    return row

def handle(handler, path, db, serialize):
    if path != '/api/reports/tickets' and not path.startswith('/api/reports/tickets/'): return False
    if not handler.admin(): return True
    with db() as c:
        if path == '/api/reports/tickets':
            rows=c.execute('SELECT * FROM tickets ORDER BY created_at DESC,id DESC').fetchall()
            handler.json(200,[{k:serialize(v) for k,v in row.items()} for row in rows])
        else:
            code=path.rsplit('/',1)[-1].upper()
            row=c.execute('SELECT * FROM tickets WHERE code=%s',(code,)).fetchone()
            if not row: handler.json(404,{'error':'Ticket no encontrado'})
            else:
                result={k:serialize(v) for k,v in row.items()}
                result['events']=[{k:serialize(v) for k,v in e.items()} for e in c.execute('SELECT id,action,actor,changes,created_at FROM ticket_events WHERE ticket_id=%s ORDER BY id',(row['id'],)).fetchall()]
                result['comments']=[{k:serialize(v) for k,v in e.items()} for e in c.execute('SELECT author,body,created_at FROM comments WHERE ticket_id=%s ORDER BY id',(row['id'],)).fetchall()]
                result['attachments']=[{k:serialize(v) for k,v in e.items()} for e in c.execute('SELECT id,name,mime,octet_length(data) size FROM attachments WHERE ticket_id=%s ORDER BY id',(row['id'],)).fetchall()]
                handler.json(200,result)
    return True
