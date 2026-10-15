"""Authenticated inventory storage. Coordinates are percentages of the supplied plan."""
import os
import math
from datetime import date
from cryptography.fernet import Fernet, InvalidToken

SCHEMA = """CREATE TABLE IF NOT EXISTS devices (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 area TEXT NOT NULL, owner TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
 password_encrypted TEXT NOT NULL DEFAULT '', serial TEXT NOT NULL DEFAULT '',
 model TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 last_maintenance DATE, x DOUBLE PRECISION, y DOUBLE PRECISION,
 created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
 CHECK (kind IN ('desktop','laptop')),
 CHECK ((x IS NULL AND y IS NULL) OR (x BETWEEN 0 AND 100 AND y BETWEEN 0 AND 100))
);"""
FIELDS = ('name','kind','area','owner','username','serial','model','notes','last_maintenance','x','y')

def cipher():
    key = os.getenv('DEVICE_ENCRYPTION_KEY', '')
    if not key:
        raise ValueError('Configura DEVICE_ENCRYPTION_KEY para guardar contraseñas')
    return Fernet(key.encode())

def validate(data):
    if not isinstance(data, dict):
        raise ValueError('Datos de dispositivo inválidos')
    result = {}
    for field in FIELDS:
        if field in ('last_maintenance', 'x', 'y'): continue
        value = data.get(field, '')
        if not isinstance(value, str): raise ValueError('Campos de texto inválidos')
        result[field] = value.strip()
        if len(result[field]) > (4000 if field == 'notes' else 200):
            raise ValueError('El texto excede la longitud permitida')
    if any(not result[k] for k in ('name','area','owner')):
        raise ValueError('Completa nombre, área y responsable')
    if result['kind'] not in ('desktop','laptop'): raise ValueError('Tipo de dispositivo inválido')
    maintenance = data.get('last_maintenance') or None
    if maintenance:
        try: maintenance = date.fromisoformat(maintenance)
        except (TypeError, ValueError): raise ValueError('Fecha de mantenimiento inválida')
        if maintenance > date.today(): raise ValueError('El último mantenimiento no puede estar en el futuro')
    result['last_maintenance'] = maintenance
    for k in ('x','y'):
        value = data.get(k)
        if value is not None:
            if isinstance(value, bool): raise ValueError('Ubicación inválida')
            try: value = float(value)
            except (TypeError, ValueError): raise ValueError('Ubicación inválida')
            if not math.isfinite(value) or not 0 <= value <= 100: raise ValueError('Ubicación fuera del plano')
        result[k] = value
    if (result['x'] is None) != (result['y'] is None): raise ValueError('Ubicación incompleta')
    password = data.get('password')
    if password is not None:
        if not isinstance(password, str) or len(password) > 1000: raise ValueError('Contraseña inválida')
        result['password_encrypted'] = cipher().encrypt(password.encode()).decode() if password else ''
    return result

def public(row,c=None):
    if c and 'has_maintenance' not in row:
        row={**row,'has_maintenance':bool(c.execute('SELECT 1 FROM device_maintenance WHERE device_id=%s LIMIT 1',(row['id'],)).fetchone())}
    return {**{k: v.isoformat() if hasattr(v, 'isoformat') else v for k,v in row.items() if k != 'password_encrypted'},
            'has_password': bool(row['password_encrypted'])}

def handle(handler, path, method, db, data=None):
    if not (path == '/api/devices' or path.startswith('/api/devices/')): return False
    if not handler.admin(): return True
    parts = path.strip('/').split('/')
    ident = None
    if len(parts) > 2:
        if not parts[2].isdigit(): handler.json(404, {'error':'Dispositivo no encontrado'}); return True
        ident = int(parts[2])
    try:
        with db() as c:
            if method == 'GET' and path == '/api/devices':
                handler.json(200, [public(r) for r in c.execute('SELECT d.*,EXISTS(SELECT 1 FROM device_maintenance m WHERE m.device_id=d.id) AS has_maintenance FROM devices d ORDER BY lower(name)').fetchall()])
            elif method == 'GET' and len(parts) == 4 and parts[3] == 'password':
                row = c.execute('SELECT password_encrypted FROM devices WHERE id=%s', (ident,)).fetchone()
                if not row: handler.json(404, {'error':'Dispositivo no encontrado'})
                else:
                    value = cipher().decrypt(row['password_encrypted'].encode()).decode() if row['password_encrypted'] else ''
                    handler.json(200, {'password':value})
            elif method in ('POST','PATCH') and ((method == 'POST' and len(parts) == 2) or (method == 'PATCH' and len(parts) == 3)):
                fields = validate(data)
                if method == 'POST':
                    columns = ','.join(fields); slots = ','.join(['%s']*len(fields))
                    row = c.execute(f'INSERT INTO devices ({columns}) VALUES ({slots}) RETURNING *', list(fields.values())).fetchone()
                else:
                    previous=c.execute('SELECT last_maintenance FROM devices WHERE id=%s FOR UPDATE',(ident,)).fetchone()
                    if previous and previous['last_maintenance'] != fields['last_maintenance'] and c.execute('SELECT 1 FROM device_maintenance WHERE device_id=%s LIMIT 1',(ident,)).fetchone():
                        raise ValueError('El equipo tiene mantenimientos registrados. Usa la agenda para registrar otro mantenimiento.')
                    sets = ','.join(f'{k}=%s' for k in fields)
                    row = c.execute(f'UPDATE devices SET {sets}, updated_at=NOW() WHERE id=%s RETURNING *', list(fields.values())+[ident]).fetchone()
                # Commit before reporting success so constraint failures are handled here.
                c.commit()
                handler.json(201 if method == 'POST' else 200, public(row,c)) if row else handler.json(404, {'error':'Dispositivo no encontrado'})
            elif method == 'DELETE' and len(parts) == 3:
                row = c.execute('DELETE FROM devices WHERE id=%s RETURNING id', (ident,)).fetchone()
                c.commit()
                handler.json(200, {'ok':True}) if row else handler.json(404, {'error':'Dispositivo no encontrado'})
            else: handler.json(404, {'error':'Ruta no encontrada'})
    except ValueError as e: handler.json(400, {'error':str(e)})
    except InvalidToken: handler.json(409, {'error':'No se pudo descifrar. Revisa la clave de cifrado del servidor.'})
    except Exception as e:
        if getattr(e, 'sqlstate', None) == '23505': handler.json(409, {'error':'Ya existe un dispositivo con ese nombre'})
        elif getattr(e, 'sqlstate', None) == '23503': handler.json(409, {'error':'Este equipo tiene tickets o mantenimientos asociados. Se conserva para no perder su historial.'})
        else:
            print('Error de inventario:', type(e).__name__)
            handler.json(500, {'error':'No fue posible guardar o consultar el inventario'})
    return True
