import base64, io, json, os, sqlite3, time, textwrap
from urllib.parse import urlparse, quote, parse_qs
from flask import Flask, Response, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
import psycopg
from psycopg.rows import dict_row
from inventory import handle as inventory_handle
from reports import seed_history, event as ticket_event, update as update_ticket, archive as archive_ticket, handle as reports_handle
from maintenance import handle as maintenance_handle, name_link
from settings import seed as seed_settings, handle as settings_handle, active_choice, support
from auth import current as current_user, handle as auth_handle
from migrations import migrate
from pending import handle as pending_handle
from ticket_queries import PRIORITIES, listing

DATABASE_URL=os.getenv("DATABASE_URL")
LEGACY_DB=os.getenv("LEGACY_DB","/legacy/tickets.db")
ADMIN_USER=os.getenv("ADMIN_USER","administrator")
MAX_FILE=10*1024*1024
MAX_TOTAL=50*1024*1024
MAX_REQUEST=72*1024*1024

def db(): return psycopg.connect(DATABASE_URL,row_factory=dict_row,connect_timeout=5,options='-c statement_timeout=30000 -c lock_timeout=10000')
def init_db():
  for _ in range(30):
    try:
      migrate(db)
      migrate_legacy(); sync_sequence(); seed_history(db); seed_settings(db); return
    except psycopg.OperationalError: print('Esperando PostgreSQL'); time.sleep(2)
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
    c.execute('LOCK TABLE tickets IN ACCESS EXCLUSIVE MODE')
    c.execute("SELECT setval('tickets_id_seq',GREATEST((SELECT last_value FROM tickets_id_seq),COALESCE((SELECT MAX(id) FROM tickets),1),COALESCE((SELECT MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)) FROM tickets WHERE code ~ '^TK-[0-9]+$'),1)))")

def serialize(v):
  if hasattr(v,"isoformat"): return v.isoformat()
  return v
def ticket_dict(row,c=None):
  data={k:serialize(v) for k,v in row.items() if k!='tracking_hash'}
  if c:
    data['comments']=[{k:serialize(v) for k,v in x.items()} for x in c.execute("SELECT id,author,body,created_at FROM comments WHERE ticket_id=%s ORDER BY id",(row['id'],)).fetchall()]
    data['attachments']=[{k:serialize(v) for k,v in x.items()} for x in c.execute("SELECT id,name,mime,octet_length(data) size,created_at FROM attachments WHERE ticket_id=%s ORDER BY id",(row['id'],)).fetchall()]
  return data

def public_ticket(row):
  return {k:serialize(row[k]) for k in ('code','status','created_at','updated_at','requester','payroll','area','subject','category','priority','description','device_name','assignee','closed_at')}

def text(data,key,limit,required=True):
  value=data.get(key,'')
  if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 and c not in '\n\r\t' for c in value):
    raise ValueError(f'{key}: texto inválido (máximo {limit} caracteres)')
  value=value.strip()
  if required and not value:raise ValueError('Completa todos los campos')
  return value

def make_pdf(ticket):
  from receipt_pdf import render_receipt
  with db() as c:
    info=support(c)
    ticket=dict(ticket)
    ticket['attachments']=[dict(a) for a in c.execute('SELECT name FROM attachments WHERE ticket_id=%s ORDER BY id',(ticket['id'],)).fetchall()]
  return render_receipt(ticket,info)

class Handler:
  """Business handlers shared by the API modules; HTTP is handled by Flask/Gunicorn."""
  def __init__(self,req):
    self.path=req.full_path.rstrip('?');self.headers=req.headers
    self.client_ip=req.headers.get('X-Real-IP',req.remote_addr or 'unknown') if os.getenv('TRUST_PROXY')=='1' else (req.remote_addr or 'unknown')
    self.status=200;self.response_headers={};self.wfile=io.BytesIO();self.stream=None;self.user=None
  def send_response(self,status):self.status=status
  def send_header(self,name,value):self.response_headers[name]=str(value)
  def end_headers(self):pass
  def log_message(self,fmt,*args): print(fmt%args)
  def json(self,status,data):
    body=json.dumps(data,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
  def body(self):
    if request.content_length is not None and request.content_length>MAX_REQUEST:raise RequestEntityTooLarge()
    return request.get_json(silent=True)
  def admin(self):
    if self.user:return True
    self.user=current_user(self,db)
    if self.user:return True
    self.json(401,{'error':'Sesión no válida o expirada'});return False
  def do_GET(self):
    path=urlparse(self.path).path
    if path=='/api/test-info' and os.getenv('TEST_MODE')=='1':
      with db() as c:name=c.execute('SELECT current_database() AS name').fetchone()['name']
      return self.json(200,{'isolated':name.endswith('_test')})
    if pending_handle(self,path,'GET',db):return
    if auth_handle(self,path,'GET',db):return
    if settings_handle(self,path,'GET',db):return
    if maintenance_handle(self,path,'GET',db):return
    if inventory_handle(self,path,'GET',db):return
    if reports_handle(self,path,db,serialize):return
    if path=='/api/health':
      try:
        with db() as c:c.execute('SELECT 1').fetchone()
      except psycopg.Error:return self.json(503,{'status':'unavailable','database':'unavailable'})
      return self.json(200,{'status':'ok','database':'postgresql'})
    if path=='/api/public/tickets':
      query=parse_qs(urlparse(self.path).query)
      field=query.get('field',[''])[0]
      value=query.get('q',[''])[0].strip()
      if field not in ('requester','payroll') or not value or len(value)>200:
        return self.json(400,{'error':'Ingresa un nombre completo o número de nómina válido'})
      # Exact identity matching: do not interpret wildcards or expose the staff-only record.
      with db() as c:
        rows=c.execute(f'SELECT * FROM tickets WHERE lower({field})=lower(%s) AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 201',(value,)).fetchall()
        items=[]
        for row in rows[:200]:
          item=public_ticket(row)
          item['attachments']=[dict(a) for a in c.execute('SELECT name,mime,octet_length(data) size FROM attachments WHERE ticket_id=%s ORDER BY id',(row['id'],)).fetchall()]
          items.append(item)
      return self.json(200,{'tickets':items,'has_more':len(rows)>200})
    if path=='/api/tickets':
      if not self.admin():return
      with db() as c:
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return self.json(200,listing(c,self.path,serialize,active=True))
    if path.startswith('/api/tickets/') and path.endswith('/receipt.pdf'):
      code=path.split('/')[-2].upper()
      with db() as c: row=c.execute('SELECT * FROM tickets WHERE code=%s AND deleted_at IS NULL',(code,)).fetchone()
      if not row:return self.json(404,{'error':'Ticket no encontrado'})
      body=make_pdf(row);self.send_response(200);self.send_header('Content-Type','application/pdf');self.send_header('Content-Disposition',f'attachment; filename={code}.pdf');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
    if '/attachments/' in path:
      parts=path.split('/'); aid=parts[-1]
      if not aid.isdigit():return self.json(404,{'error':'Archivo no encontrado'})
      if not self.admin():return
      with db() as c: row=c.execute('SELECT name,mime,data FROM attachments WHERE id=%s',(aid,)).fetchone()
      if not row:return self.json(404,{'error':'Archivo no encontrado'})
      self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Content-Disposition',f"attachment; filename*=UTF-8''{quote(row['name'],safe='')}");self.send_header('Content-Length',str(len(row['data'])));self.end_headers();self.wfile.write(row['data']);return
    if path.startswith('/api/tickets/'):
      code=path.rsplit('/',1)[-1].upper()
      with db() as c:
        row=c.execute('SELECT * FROM tickets WHERE code=%s AND deleted_at IS NULL',(code,)).fetchone()
        # Public output is an allowlist; staff details require a session.
        if self.headers.get('Authorization',''):
          if not self.admin():return
          return self.json(200,ticket_dict(row,c)) if row else self.json(404,{'error':'Ticket no encontrado'})
        return self.json(200,{**public_ticket(row),'attachments':[dict(a) for a in c.execute('SELECT name,mime,octet_length(data) size FROM attachments WHERE ticket_id=%s ORDER BY id',(row['id'],)).fetchall()]}) if row else self.json(404,{'error':'Folio no encontrado'})
    self.json(404,{'error':'Ruta no encontrada'})
  def do_POST(self):
    path,data=urlparse(self.path).path,self.body()
    if not isinstance(data,dict):return self.json(400,{'error':'JSON inválido'})
    if pending_handle(self,path,'POST',db,data):return
    if auth_handle(self,path,'POST',db,data):return
    if settings_handle(self,path,'POST',db,data):return
    if path.startswith('/api/maintenance/') and not self.admin():return
    if maintenance_handle(self,path,'POST',db,data,self.user['username'] if self.user else ADMIN_USER):return
    if inventory_handle(self,path,'POST',db,data):return
    if path=='/api/tickets':
      data['requester']=text(data,'requester',200,False)
      data['payroll']=text(data,'payroll',50,False)
      if not data['requester'] and not data['payroll']:raise ValueError('Ingresa tu nombre o número de nómina')
      required=['requester','area','subject','category','priority','description']
      for key,limit in [('requester',200),('area',100),('subject',90),('category',100),('priority',20),('description',10000)]:data[key]=text(data,key,limit,required=key!='requester')
      if data['priority'] not in PRIORITIES:raise ValueError('Prioridad inválida')
      files=data.get('attachments',[])
      if not isinstance(files,list):return self.json(400,{'error':'Archivos inválidos'})
      if len(files)>5:return self.json(400,{'error':'Máximo 5 archivos'})
      validated=[]
      for f in files:
        try:
          if not isinstance(f,dict) or not isinstance(f.get('data'),str) or len(f['data'])>((MAX_FILE+2)//3)*4:raise ValueError()
          raw=base64.b64decode(f['data'],validate=True)
          name=text(f,'name',200);mime=text(f,'type',100,False) or 'application/octet-stream'
          if any(ord(char)<32 for char in name+mime):raise ValueError()
        except:return self.json(400,{'error':'Archivo inválido'})
        if len(raw)>MAX_FILE:return self.json(400,{'error':'Cada archivo debe pesar menos de 10 MB'})
        validated.append((name,mime,raw))
      if sum(len(raw) for _,_,raw in validated)>MAX_TOTAL:raise ValueError('Los archivos exceden 50 MB en total')
      with db() as c:
        try:
          data['area']=active_choice(c,'area',data['area'])
          data['category']=active_choice(c,'category',data['category'])
          linked=name_link(c,data.get('device_name',''))
        except ValueError as e:return self.json(400,{'error':str(e)})
        row=c.execute("INSERT INTO tickets(code,requester,area,subject,category,priority,description) VALUES('',%s,%s,%s,%s,%s,%s) RETURNING *",tuple(str(data[k]).strip() for k in required)).fetchone();code=f"TK-{row['id']:05d}";row=c.execute('UPDATE tickets SET code=%s WHERE id=%s RETURNING *',(code,row['id'])).fetchone()
        row=c.execute('UPDATE tickets SET device_id=%s,device_name=%s,payroll=%s WHERE id=%s RETURNING *',(linked['device_id'],linked['device_name'],data['payroll'],row['id'])).fetchone()
        for name,mime,raw in validated:
          c.execute('INSERT INTO attachments(ticket_id,name,mime,data) VALUES(%s,%s,%s,%s)',(row['id'],name,mime,raw))
        ticket_event(c,row['id'],'Apertura',str(data['requester']).strip(),{'status':{'antes':None,'despues':'Abierto'}})
        c.commit()
        return self.json(201,{k:serialize(row[k]) for k in ('id','code','subject','category','priority','created_at')})
    if path.endswith('/comments') and path.startswith('/api/admin/tickets/'):
      if not self.admin():return
      code=path.split('/')[-2].upper();body=text(data,'body',4000)
      with db() as c:
        row=c.execute('SELECT id FROM tickets WHERE code=%s AND deleted_at IS NULL FOR UPDATE',(code,)).fetchone()
        if not row:return self.json(404,{'error':'Ticket no encontrado'})
        actor=self.user['username']
        c.execute('INSERT INTO comments(ticket_id,author,body) VALUES(%s,%s,%s)',(row['id'],actor,body));c.execute('UPDATE tickets SET updated_at=NOW() WHERE id=%s',(row['id'],));ticket_event(c,row['id'],'Comentario',actor,{'comentario':body});c.commit();return self.json(201,{'ok':True})
    self.json(404,{'error':'Ruta no encontrada'})
  def do_PATCH(self):
    path=urlparse(self.path).path
    data=self.body()
    if not isinstance(data,dict):return self.json(400,{'error':'JSON inválido'})
    if pending_handle(self,path,'PATCH',db,data):return
    if auth_handle(self,path,'PATCH',db,data):return
    if path.startswith('/api/admin/config/'):
      settings_handle(self,path,'PATCH',db,data);return
    if path == '/api/devices' or path.startswith('/api/devices/'):
      inventory_handle(self,path,'PATCH',db,data);return
    if not self.admin():return
    if not path.startswith('/api/admin/tickets/') or not isinstance(data,dict):return self.json(404,{'error':'Ruta no encontrada'})
    code=path.rsplit('/',1)[-1].upper();allowed={'status','priority','assignee','category'};fields={k:text(data,k,200,required=k!='assignee') for k in data if k in allowed}
    if 'device_id' in data:fields['device_id']=data['device_id']
    if not fields:return self.json(400,{'error':'Sin cambios válidos'})
    if 'status' in fields and fields['status'] not in ('Abierto','En progreso','Cerrado'):return self.json(400,{'error':'Estado inválido'})
    if 'priority' in fields and fields['priority'] not in ('Baja','Media','Alta','Crítica'):return self.json(400,{'error':'Prioridad inválida'})
    with db() as c:
      try:row=update_ticket(c,code,fields,self.user['username'])
      except ValueError as e:return self.json(400,{'error':str(e)})
      c.commit()
      return self.json(200,ticket_dict(row,c)) if row else self.json(404,{'error':'Ticket no encontrado'})
  def do_DELETE(self):
    path=urlparse(self.path).path
    if inventory_handle(self,path,'DELETE',db):return
    if not self.admin():return
    if not path.startswith('/api/admin/tickets/'):return self.json(404,{'error':'Ruta no encontrada'})
    code=urlparse(self.path).path.rsplit('/',1)[-1].upper()
    with db() as c: row=archive_ticket(c,code,self.user['username']);c.commit();return self.json(200,{'ok':True}) if row else self.json(404,{'error':'Ticket no encontrado'})

app=Flask(__name__)
app.config['MAX_CONTENT_LENGTH']=MAX_REQUEST

@app.route('/api/<path:route>',methods=['GET','POST','PATCH','DELETE'])
def dispatch(route):
  handler=Handler(request)
  getattr(handler,'do_'+('GET' if request.method=='HEAD' else request.method))()
  return Response(handler.stream if handler.stream is not None else handler.wfile.getvalue(),status=handler.status,headers=handler.response_headers)

@app.after_request
def response_headers(response):
  response.headers['Cache-Control']='no-store'
  response.headers['X-Content-Type-Options']='nosniff'
  return response

@app.errorhandler(Exception)
def failure(error):
  if isinstance(error,RequestEntityTooLarge):status,message=413,'La solicitud excede el tamaño permitido (50 MB de archivos en total)'
  elif isinstance(error,ValueError):status,message=400,str(error)
  elif isinstance(error,psycopg.errors.UniqueViolation):status,message=409,'Ya existe un registro con ese nombre'
  elif isinstance(error,psycopg.DataError):status,message=400,'Datos inválidos'
  elif isinstance(error,HTTPException):status,message=error.code,error.description
  else:
    app.logger.error('Error de API: %s',type(error).__name__)
    status,message=500,'No fue posible completar la operación'
  return Response(json.dumps({'error':message},ensure_ascii=False),status=status,content_type='application/json; charset=utf-8')
