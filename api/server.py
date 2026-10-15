import base64, hmac, json, os, secrets, sqlite3, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import psycopg
from psycopg.rows import dict_row
from inventory import SCHEMA, handle as inventory_handle
from reports import SCHEMA as REPORT_SCHEMA, seed_history, event as ticket_event, update as update_ticket, archive as archive_ticket, handle as reports_handle
from maintenance import SCHEMA as MAINTENANCE_SCHEMA, handle as maintenance_handle, name_link

DATABASE_URL=os.getenv("DATABASE_URL")
LEGACY_DB=os.getenv("LEGACY_DB","/legacy/tickets.db")
ADMIN_USER=os.getenv("ADMIN_USER","administrator")
ADMIN_PASSWORD=os.getenv("ADMIN_PASSWORD","")
TOKENS={}; MAX_FILE=10*1024*1024

def db(): return psycopg.connect(DATABASE_URL,row_factory=dict_row)
def init_db():
  for _ in range(30):
    try:
      with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS tickets(id SERIAL PRIMARY KEY,code TEXT UNIQUE,requester TEXT NOT NULL,area TEXT NOT NULL,subject TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Abierto',assignee TEXT DEFAULT 'Sin asignar',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE IF NOT EXISTS comments(id SERIAL PRIMARY KEY,ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,author TEXT NOT NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE IF NOT EXISTS attachments(id SERIAL PRIMARY KEY,ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,data BYTEA NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());""")
        c.execute(SCHEMA)
        c.execute(REPORT_SCHEMA)
        c.execute(MAINTENANCE_SCHEMA)
      migrate_legacy(); sync_sequence(); seed_history(db); return
    except Exception as e: print("Esperando PostgreSQL:",e); time.sleep(2)
  raise RuntimeError("PostgreSQL no disponible")

def migrate_legacy():
  if not os.path.exists(LEGACY_DB): return
  with db() as pg:
    if pg.execute("SELECT COUNT(*) n FROM tickets").fetchone()["n"]: return
    old=sqlite3.connect(f"file:{LEGACY_DB}?mode=ro",uri=True); old.row_factory=sqlite3.Row
    for t in old.execute("SELECT * FROM tickets ORDER BY id"):
      row=dict(t); new=pg.execute("INSERT INTO tickets(code,requester,area,subject,category,priority,description,status,assignee,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",(row['code'],row['requester'],row['area'],row['subject'],row['category'],row['priority'],row['description'],row['status'],row['assignee'],row['created_at'],row['updated_at'])).fetchone()
      for x in old.execute("SELECT * FROM comments WHERE ticket_id=?",(row['id'],)): pg.execute("INSERT INTO comments(ticket_id,author,body,created_at) VALUES(%s,%s,%s,%s)",(new['id'],x['author'],x['body'],x['created_at']))
    pg.execute("SELECT setval('tickets_id_seq',COALESCE((SELECT MAX(id) FROM tickets),1))")
    old.close(); print("Migración SQLite completada")

def sync_sequence():
  with db() as c:
    c.execute("SELECT setval('tickets_id_seq',GREATEST(COALESCE((SELECT MAX(id) FROM tickets),1),COALESCE((SELECT MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)) FROM tickets WHERE code ~ '^TK-[0-9]+$'),1)))")

def serialize(v):
  if hasattr(v,"isoformat"): return v.isoformat()
  return v
def ticket_dict(row,c=None):
  data={k:serialize(v) for k,v in row.items()}
  if c:
    data['comments']=[{k:serialize(v) for k,v in x.items()} for x in c.execute("SELECT id,author,body,created_at FROM comments WHERE ticket_id=%s ORDER BY id",(row['id'],)).fetchall()]
    data['attachments']=[{k:serialize(v) for k,v in x.items()} for x in c.execute("SELECT id,name,mime,octet_length(data) size,created_at FROM attachments WHERE ticket_id=%s ORDER BY id",(row['id'],)).fetchall()]
  return data

def make_pdf(ticket):
  def esc(text): return str(text).replace('\\','\\\\').replace('(','\\(').replace(')','\\)').encode('latin-1','replace').decode('latin-1')
  lines=["MESA TI - PLANTA MEXICO","COMPROBANTE DE SOLICITUD",ticket['code'],ticket['subject'],f"Categoria: {ticket['category']}   Prioridad: {ticket['priority']}",f"Solicitante: {ticket['requester']}","Conserva este folio para consultar el seguimiento. Extension 2401."]
  sizes=[18,12,34,16,12,12,11]; y=[750,715,650,600,560,525,450]
  stream=''.join(f"BT /F1 {size} Tf 70 {pos} Td ({esc(line)}) Tj ET\n" for line,size,pos in zip(lines,sizes,y)).encode('latin-1')
  objs=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  out=b'%PDF-1.4\n'; offsets=[0]
  for i,obj in enumerate(objs,1): offsets.append(len(out)); out+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
  xref=len(out); out+=f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'.encode(); out+=b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets[1:]); out+=f'trailer << /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode(); return out

class Handler(BaseHTTPRequestHandler):
  def log_message(self,fmt,*args): print(fmt%args)
  def json(self,status,data):
    body=json.dumps(data,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
  def body(self):
    try:return json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}')
    except:return None
  def admin(self):
    token=self.headers.get('Authorization','').replace('Bearer ','')
    if token in TOKENS and TOKENS[token]>time.time():return True
    self.json(401,{'error':'Sesión no válida o expirada'});return False
  def do_GET(self):
    path=urlparse(self.path).path
    if maintenance_handle(self,path,'GET',db):return
    if inventory_handle(self,path,'GET',db):return
    if reports_handle(self,path,db,serialize):return
    if path=='/api/health':return self.json(200,{'status':'ok','database':'postgresql'})
    if path=='/api/tickets':
      if not self.admin():return
      with db() as c:return self.json(200,[ticket_dict(x) for x in c.execute('SELECT * FROM tickets WHERE deleted_at IS NULL ORDER BY id DESC').fetchall()])
    if path.startswith('/api/tickets/') and path.endswith('/receipt.pdf'):
      code=path.split('/')[-2].upper()
      with db() as c: row=c.execute('SELECT * FROM tickets WHERE code=%s AND deleted_at IS NULL',(code,)).fetchone()
      if not row:return self.json(404,{'error':'Ticket no encontrado'})
      body=make_pdf(row);self.send_response(200);self.send_header('Content-Type','application/pdf');self.send_header('Content-Disposition',f'attachment; filename={code}.pdf');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
    if '/attachments/' in path:
      parts=path.split('/'); aid=parts[-1]
      if not self.admin():return
      with db() as c: row=c.execute('SELECT name,mime,data FROM attachments WHERE id=%s',(aid,)).fetchone()
      if not row:return self.json(404,{'error':'Archivo no encontrado'})
      self.send_response(200);self.send_header('Content-Type',row['mime']);self.send_header('Content-Disposition',f"attachment; filename*=UTF-8''{row['name']}");self.send_header('Content-Length',str(len(row['data'])));self.end_headers();self.wfile.write(row['data']);return
    if path.startswith('/api/tickets/'):
      code=path.rsplit('/',1)[-1].upper()
      with db() as c:
        row=c.execute('SELECT * FROM tickets WHERE code=%s AND deleted_at IS NULL',(code,)).fetchone()
        return self.json(200,ticket_dict(row,c)) if row else self.json(404,{'error':'Ticket no encontrado'})
    self.json(404,{'error':'Ruta no encontrada'})
  def do_POST(self):
    path,data=urlparse(self.path).path,self.body()
    if data is None:return self.json(400,{'error':'JSON inválido'})
    if maintenance_handle(self,path,'POST',db,data,ADMIN_USER):return
    if inventory_handle(self,path,'POST',db,data):return
    if path=='/api/auth/login':
      valid=hmac.compare_digest(str(data.get('username','')),ADMIN_USER) and hmac.compare_digest(str(data.get('password','')),ADMIN_PASSWORD)
      if not valid:return self.json(401,{'error':'Usuario o contraseña incorrectos'})
      token=secrets.token_urlsafe(32);TOKENS[token]=time.time()+8*3600;return self.json(200,{'token':token,'expiresIn':28800})
    if path=='/api/tickets':
      required=['requester','area','subject','category','priority','description']
      if any(not str(data.get(k,'')).strip() for k in required):return self.json(400,{'error':'Completa todos los campos'})
      files=data.get('attachments',[])
      if not isinstance(files,list):return self.json(400,{'error':'Archivos inválidos'})
      if len(files)>5:return self.json(400,{'error':'Máximo 5 archivos'})
      validated=[]
      for f in files:
        try:
          raw=base64.b64decode(f.get('data',''),validate=True)
          name=str(f.get('name','archivo'))[:200];mime=str(f.get('type','application/octet-stream'))[:100]
        except:return self.json(400,{'error':'Archivo inválido'})
        if len(raw)>MAX_FILE:return self.json(400,{'error':'Cada archivo debe pesar menos de 10 MB'})
        validated.append((name,mime,raw))
      with db() as c:
        try: linked=name_link(c,data.get('device_name',''))
        except ValueError as e:return self.json(400,{'error':str(e)})
        row=c.execute("INSERT INTO tickets(code,requester,area,subject,category,priority,description) VALUES('',%s,%s,%s,%s,%s,%s) RETURNING *",tuple(str(data[k]).strip() for k in required)).fetchone();code=f"TK-{row['id']:05d}";row=c.execute('UPDATE tickets SET code=%s WHERE id=%s RETURNING *',(code,row['id'])).fetchone()
        row=c.execute('UPDATE tickets SET device_id=%s,device_name=%s WHERE id=%s RETURNING *',(linked['device_id'],linked['device_name'],row['id'])).fetchone()
        for name,mime,raw in validated:
          c.execute('INSERT INTO attachments(ticket_id,name,mime,data) VALUES(%s,%s,%s,%s)',(row['id'],name,mime,raw))
        ticket_event(c,row['id'],'Apertura',str(data['requester']).strip(),{'status':{'antes':None,'despues':'Abierto'}})
        c.commit()
        return self.json(201,ticket_dict(row,c))
    if path.endswith('/comments') and path.startswith('/api/admin/tickets/'):
      if not self.admin():return
      code=path.split('/')[-2].upper();body=str(data.get('body','')).strip()
      if not body:return self.json(400,{'error':'Escribe un comentario'})
      with db() as c:
        row=c.execute('SELECT id FROM tickets WHERE code=%s AND deleted_at IS NULL FOR UPDATE',(code,)).fetchone()
        if not row:return self.json(404,{'error':'Ticket no encontrado'})
        c.execute('INSERT INTO comments(ticket_id,author,body) VALUES(%s,%s,%s)',(row['id'],ADMIN_USER,body));c.execute('UPDATE tickets SET updated_at=NOW() WHERE id=%s',(row['id'],));ticket_event(c,row['id'],'Comentario',ADMIN_USER,{'comentario':body});c.commit();return self.json(201,{'ok':True})
    self.json(404,{'error':'Ruta no encontrada'})
  def do_PATCH(self):
    path=urlparse(self.path).path
    if path == '/api/devices' or path.startswith('/api/devices/'):
      inventory_handle(self,path,'PATCH',db,self.body());return
    if not self.admin():return
    path,data=urlparse(self.path).path,self.body()
    if not path.startswith('/api/admin/tickets/') or data is None:return self.json(404,{'error':'Ruta no encontrada'})
    code=path.rsplit('/',1)[-1].upper();allowed={'status','priority','assignee','category'};fields={k:str(v).strip() for k,v in data.items() if k in allowed}
    if 'device_id' in data:fields['device_id']=data['device_id']
    if not fields:return self.json(400,{'error':'Sin cambios válidos'})
    if 'status' in fields and fields['status'] not in ('Abierto','En progreso','Cerrado'):return self.json(400,{'error':'Estado inválido'})
    if 'priority' in fields and fields['priority'] not in ('Baja','Media','Alta','Crítica'):return self.json(400,{'error':'Prioridad inválida'})
    with db() as c:
      try:row=update_ticket(c,code,fields,ADMIN_USER)
      except ValueError as e:return self.json(400,{'error':str(e)})
      c.commit()
      return self.json(200,ticket_dict(row,c)) if row else self.json(404,{'error':'Ticket no encontrado'})
  def do_DELETE(self):
    path=urlparse(self.path).path
    if inventory_handle(self,path,'DELETE',db):return
    if not self.admin():return
    if not path.startswith('/api/admin/tickets/'):return self.json(404,{'error':'Ruta no encontrada'})
    code=urlparse(self.path).path.rsplit('/',1)[-1].upper()
    with db() as c: row=archive_ticket(c,code,ADMIN_USER);c.commit();return self.json(200,{'ok':True}) if row else self.json(404,{'error':'Ticket no encontrado'})

init_db();ThreadingHTTPServer(('0.0.0.0',8081),Handler).serve_forever()
