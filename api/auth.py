"""Individual TI accounts, revocable sessions and database-backed login limits."""
import hashlib
import os
import secrets
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash

SCHEMA = """
CREATE TABLE IF NOT EXISTS ti_users (
 id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, is_admin BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ti_users_name_idx ON ti_users(lower(username));
CREATE TABLE IF NOT EXISTS ti_sessions (
 token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES ti_users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ti_sessions_expiry_idx ON ti_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_attempts (
 key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS security_events (
 id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
 target TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""
DUMMY_HASH = generate_password_hash(secrets.token_urlsafe(24))

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def username(value):
    if not isinstance(value,str) or not 3 <= len(value.strip()) <= 80 or any(ord(c)<33 for c in value.strip()):
        raise ValueError('El usuario debe tener de 3 a 80 caracteres, sin espacios ni controles')
    return value.strip()

def password(value):
    if not isinstance(value,str) or not 12 <= len(value) <= 200:
        raise ValueError('La contraseña debe tener de 12 a 200 caracteres')
    return generate_password_hash(value)

def bootstrap(c):
    if c.execute('SELECT 1 FROM ti_users LIMIT 1').fetchone(): return
    name=username(os.getenv('ADMIN_USER','administrator'))
    secret=os.getenv('ADMIN_PASSWORD','')
    if not secret or secret.startswith('cambia_esta_'):
        raise RuntimeError('Configura una contraseña administrativa propia antes de iniciar')
    # Preserve the existing deployment's credential; new accounts require 12 characters.
    c.execute('INSERT INTO ti_users(username,password_hash,is_admin) VALUES(%s,%s,TRUE)',
              (name,generate_password_hash(secret)))

def public(row):
    return {k:row[k] for k in ('id','username','active','is_admin')}

def current(handler,db):
    header=handler.headers.get('Authorization','')
    token=header[7:] if header.startswith('Bearer ') else ''
    if not token or len(token)>200: return None
    with db() as c:
        row=c.execute('SELECT u.* FROM ti_sessions s JOIN ti_users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>NOW() AND u.active',(digest(token),)).fetchone()
    return public(row) if row else None

def login(handler,db,data):
    name=data.get('username','');secret=data.get('password','')
    if not isinstance(name,str) or not isinstance(secret,str) or len(name)>80 or len(secret)>200:
        handler.json(400,{'error':'Credenciales inválidas'});return
    account='account:'+digest(name.strip().lower())
    address='ip:'+digest(handler.client_ip)
    with db() as c:
        c.execute("DELETE FROM auth_attempts WHERE started_at < NOW()-INTERVAL '15 minutes'")
        c.execute('DELETE FROM ti_sessions WHERE expires_at<=NOW()')
        for key in sorted((account,address)):
            c.execute('INSERT INTO auth_attempts(key) VALUES(%s) ON CONFLICT DO NOTHING',(key,))
        attempts=c.execute('SELECT * FROM auth_attempts WHERE key=ANY(%s) ORDER BY key FOR UPDATE',([account,address],)).fetchall()
        limited=[r for r in attempts if r['failures'] >= (10 if r['key']==account else 60)]
        if limited:
            wait=max(1,int(max((r['started_at']-datetime.now(timezone.utc)).total_seconds()+900 for r in limited)))
            handler.send_header('Retry-After',str(wait))
            handler.json(429,{'error':'Demasiados intentos. Intenta de nuevo en 15 minutos.','retry_after':wait});return
        row=c.execute('SELECT * FROM ti_users WHERE lower(username)=lower(%s)',(name.strip(),)).fetchone()
        valid=check_password_hash(row['password_hash'] if row else DUMMY_HASH,secret)
        if not row or not row['active'] or not valid:
            c.execute('UPDATE auth_attempts SET failures=failures+1 WHERE key=ANY(%s)',([account,address],))
            c.commit();handler.json(401,{'error':'Usuario o contraseña incorrectos'});return
        c.execute('DELETE FROM auth_attempts WHERE key=%s',(account,))
        token=secrets.token_urlsafe(32)
        c.execute("INSERT INTO ti_sessions(token_hash,user_id,expires_at) VALUES(%s,%s,NOW()+INTERVAL '8 hours')",(digest(token),row['id']))
        c.execute("INSERT INTO security_events(actor,action,target) VALUES(%s,'Inicio de sesión',%s)",(row['username'],row['username']))
        c.commit();handler.json(200,{'token':token,'expiresIn':28800,'user':public(row)})

def handle(handler,path,method,db,data=None):
    if not (path.startswith('/api/auth/') or path=='/api/admin/users' or path.startswith('/api/admin/users/')):return False
    if path=='/api/auth/login' and method=='POST':login(handler,db,data);return True
    if path=='/api/auth/logout' and method=='POST':
        header=handler.headers.get('Authorization','')
        with db() as c:c.execute('DELETE FROM ti_sessions WHERE token_hash=%s',(digest(header[7:]),))
        handler.json(200,{'ok':True});return True
    if not handler.admin():return True
    if path=='/api/auth/session' and method=='GET':handler.json(200,{'user':handler.user});return True
    if path=='/api/auth/password' and method=='POST':
        with db() as c:
            row=c.execute('SELECT password_hash FROM ti_users WHERE id=%s FOR UPDATE',(handler.user['id'],)).fetchone()
            old=data.get('current_password')
            if not isinstance(old,str) or not check_password_hash(row['password_hash'],old):
                handler.json(400,{'error':'La contraseña actual no es correcta'});return True
            hashed=password(data.get('password'))
            c.execute('UPDATE ti_users SET password_hash=%s WHERE id=%s',(hashed,handler.user['id']))
            c.execute('DELETE FROM ti_sessions WHERE user_id=%s',(handler.user['id'],))
            c.execute("INSERT INTO security_events(actor,action,target) VALUES(%s,'Cambio de contraseña',%s)",(handler.user['username'],handler.user['username']))
        handler.json(200,{'ok':True,'reauthenticate':True});return True
    if not handler.user['is_admin']:handler.json(403,{'error':'Se requiere una cuenta administradora'});return True
    with db() as c:
        if path=='/api/admin/users' and method=='GET':
            handler.json(200,[public(r) for r in c.execute('SELECT * FROM ti_users ORDER BY lower(username)').fetchall()]);return True
        # Serialize last-administrator checks and concurrent account changes.
        c.execute('SELECT id FROM ti_users ORDER BY id FOR UPDATE')
        if path=='/api/admin/users' and method=='POST':
            name=username(data.get('username'));hashed=password(data.get('password'))
            role=data.get('is_admin',False)
            if not isinstance(role,bool):raise ValueError('Permiso inválido')
            row=c.execute('INSERT INTO ti_users(username,password_hash,is_admin) VALUES(%s,%s,%s) RETURNING *',(name,hashed,role)).fetchone()
            action='Alta de cuenta'
        elif method=='PATCH' and path.rsplit('/',1)[-1].isdigit():
            row=c.execute('SELECT * FROM ti_users WHERE id=%s',(int(path.rsplit('/',1)[-1]),)).fetchone()
            if not row:handler.json(404,{'error':'Usuario no encontrado'});return True
            active=data.get('active',row['active']);role=data.get('is_admin',row['is_admin'])
            if not isinstance(active,bool) or not isinstance(role,bool):raise ValueError('Permiso inválido')
            if row['id']==handler.user['id'] and (not active or role!=row['is_admin'] or 'password' in data):
                raise ValueError('Usa Cambiar mi contraseña. Otra cuenta administradora puede cambiar tus permisos.')
            if row['active'] and row['is_admin'] and not (active and role) and c.execute('SELECT COUNT(*) AS n FROM ti_users WHERE active AND is_admin').fetchone()['n']<=1:
                raise ValueError('Debe quedar al menos una cuenta administradora activa')
            hashed=password(data['password']) if 'password' in data else row['password_hash']
            row=c.execute('UPDATE ti_users SET active=%s,is_admin=%s,password_hash=%s WHERE id=%s RETURNING *',(active,role,hashed,row['id'])).fetchone()
            c.execute('DELETE FROM ti_sessions WHERE user_id=%s',(row['id'],))
            action='Actualización de cuenta'
        else:handler.json(404,{'error':'Ruta no encontrada'});return True
        c.execute('INSERT INTO security_events(actor,action,target) VALUES(%s,%s,%s)',(handler.user['username'],action,row['username']))
        c.commit();handler.json(201 if method=='POST' else 200,public(row))
    return True
