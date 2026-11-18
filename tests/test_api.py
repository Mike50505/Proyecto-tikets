"""Regression tests. Abort before mutation unless using the isolated test DB."""
import base64
import io
import os
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,'/app')
import server
from auth import bootstrap, digest

def require_isolation():
    if os.getenv('TEST_MODE')!='1':raise RuntimeError('Tests require TEST_MODE=1')
    with server.db() as c:
        if not c.execute('SELECT current_database() AS name').fetchone()['name'].endswith('_test'):
            raise RuntimeError('Tests require a dedicated _test database')

class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):require_isolation()
    def setUp(self):
        require_isolation()
        with server.db() as c:
            c.execute('TRUNCATE pending_tasks,ti_users,ti_sessions,auth_attempts,security_events,tickets,comments,attachments,ticket_events,devices,device_maintenance RESTART IDENTITY CASCADE')
            bootstrap(c)
        self.client=server.app.test_client()
        self.credentials={'username':os.environ['ADMIN_USER'],'password':os.environ['ADMIN_PASSWORD']}
        result=self.client.post('/api/auth/login',json=self.credentials).get_json()
        self.headers={'Authorization':'Bearer '+result['token']}
        self.payload=dict(requester='Persona de prueba',area='Sistemas',subject='Prueba aislada',category='Hardware',priority='Media',description='Detalle interno')
    def ticket(self,**changes):
        result=self.client.post('/api/tickets',json={**self.payload,**changes})
        self.assertEqual(result.status_code,201,result.get_json());return result.get_json()
    def test_pending_permissions_validation_and_ticket_independence(self):
        url='/api/pending'
        payload={'title':'Revisar respaldo','due_date':'2026-11-18','notes':'Primer paso','assignee':'Equipo TI'}
        self.assertEqual(self.client.get(url+'?scope=all').status_code,401)
        self.assertEqual(self.client.post(url,json=payload).status_code,401)
        for changes in ({'title':''},{'title':'x'*181},{'due_date':'2026-02-30'},{'notes':[]},{'status':'invalid'}):
            self.assertEqual(self.client.post(url,headers=self.headers,json={**payload,**changes}).status_code,400)
        task=self.client.post(url,headers=self.headers,json=payload).get_json()
        self.assertEqual(task['created_by'],self.credentials['username'])
        self.assertEqual(self.client.patch(url+'/'+str(task['id']),json={'status':'done','revision':1}).status_code,401)
        items=self.client.get(url+'?scope=all',headers=self.headers).get_json()['items']
        self.assertEqual(items,[task])
        with server.db() as c:self.assertEqual(c.execute('SELECT count(*) n FROM tickets').fetchone()['n'],0)

    def test_pending_tracking_conflicts_reopen_and_archive(self):
        url='/api/pending'
        task=self.client.post(url,headers=self.headers,json={'title':'Instalar equipo','due_date':'2026-11-18'}).get_json()
        url+='/'+str(task['id'])
        def update(data):return self.client.patch(url,headers=self.headers,json=data)
        result=update({'status':'doing','notes':'Falta conectar red','revision':1})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.get_json()['notes'],'Falta conectar red')
        self.assertEqual(update({'status':'done','revision':1}).status_code,409)
        done=update({'status':'done','revision':2}).get_json()
        self.assertIsNotNone(done['completed_at'])
        self.assertEqual(done['updated_by'],self.credentials['username'])
        reopened=update({'status':'todo','revision':3}).get_json()
        self.assertIsNone(reopened['completed_at'])
        self.assertEqual(update({'archive':True,'revision':4}).status_code,200)
        self.assertEqual(self.client.get('/api/pending?scope=all',headers=self.headers).get_json()['items'],[])
        self.assertEqual(update({'status':'doing','revision':5}).status_code,404)

    def test_pending_day_includes_unfinished_earlier_tasks(self):
        for title,day_value in [('Anterior','2026-11-17'),('Hoy','2026-11-18'),('Futuro','2026-11-19')]:
            self.client.post('/api/pending',headers=self.headers,json={'title':title,'due_date':day_value})
        def names(query):return {t['title'] for t in self.client.get('/api/pending?'+query,headers=self.headers).get_json()['items']}
        self.assertEqual(names('scope=day&date=2026-11-18'),{'Anterior','Hoy'})
        self.assertEqual(names('scope=all'),{'Anterior','Hoy','Futuro'})
        self.assertEqual(self.client.get('/api/pending?date=invalid',headers=self.headers).status_code,400)
        with server.db() as c:c.execute("UPDATE pending_tasks SET status='done',completed_at='2026-11-17T12:00:00Z' WHERE title='Anterior'")
        self.assertEqual(names('scope=day&date=2026-11-18'),{'Hoy'})

    def test_invalid_priority_and_types_rejected(self):
        for changes in ({'priority':'media" onmouseover="alert(1)'},{'priority':'Desconocida'},{'requester':[]},{'description':'x'*10001}):
            self.assertEqual(self.client.post('/api/tickets',json={**self.payload,**changes}).status_code,400)
        with server.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) AS n FROM tickets').fetchone()['n'],0)
    def test_public_lookup_has_only_allowed_fields(self):
        ticket=self.ticket();url='/api/tickets/'+ticket['code']
        self.assertNotIn('tracking_key',ticket)
        self.assertEqual(self.client.get(url,headers={'X-Tracking-Key':'wrong'}).status_code,200)
        response=self.client.get(url)
        self.assertEqual(response.status_code,200)
        self.assertEqual(set(response.get_json()),{'code','status','created_at','updated_at','requester','payroll','area','subject','category','priority','description','device_name','assignee','closed_at','attachments'})
        self.assertEqual(response.get_json()['description'],self.payload['description'])
        private=self.client.get(url,headers=self.headers).get_json()
        self.assertEqual(private['description'],self.payload['description']);self.assertNotIn('tracking_hash',private)
        self.assertNotIn('tracking_hash',str(self.client.get('/api/reports/tickets/'+ticket['code'],headers=self.headers).get_json()))
    def test_identity_creation_and_public_search(self):
        a=self.ticket(requester='',payroll='001234')
        b=self.ticket(requester='Persona de prueba',payroll='001234')
        self.ticket(requester='Otra persona',payroll='009999')
        self.assertEqual(self.client.post('/api/tickets',json={**self.payload,'requester':'','payroll':''}).status_code,400)
        result=self.client.get('/api/public/tickets?field=payroll&q=001234').get_json()
        self.assertEqual({t['code'] for t in result['tickets']},{a['code'],b['code']})
        for t in result['tickets']:
            self.assertEqual(t['payroll'],'001234')
            self.assertNotIn('tracking_hash',t)
            self.assertNotIn('tracking_key',t)
            self.assertNotIn('comments',t)
        result=self.client.get('/api/public/tickets?field=requester&q=persona%20de%20prueba').get_json()
        self.assertEqual([t['code'] for t in result['tickets']],[b['code']])
        for value in ('001','%25',"%27%20OR%201=1--"):
            self.assertEqual(self.client.get('/api/public/tickets?field=payroll&q='+value).get_json()['tickets'],[])
        self.assertEqual(self.client.get('/api/public/tickets?field=description&q=test').status_code,400)
        self.assertEqual(self.client.patch('/api/admin/tickets/'+a['code'],json={'status':'Cerrado'}).status_code,401)

    def test_receipt_requires_only_folio(self):
        t=self.ticket();url='/api/tickets/'+t['code']
        pdf=self.client.get(url+'/receipt.pdf')
        self.assertEqual(pdf.status_code,200);self.assertTrue(pdf.data.startswith(b'%PDF'))
        self.assertEqual(self.client.get('/api/tickets/TK-999999/receipt.pdf').status_code,404)
        self.assertEqual(self.client.post('/api/admin/tickets/'+t['code']+'/tracking',headers=self.headers,json={}).status_code,404)
    def test_existing_tickets_accept_folio_with_or_without_old_hash(self):
        t=self.ticket();url='/api/tickets/'+t['code']
        for old_hash in (digest('old-key'),None):
            with server.db() as c:c.execute('UPDATE tickets SET tracking_hash=%s WHERE id=%s',(old_hash,t['id']))
            self.assertEqual(self.client.get(url).status_code,200)
    def test_attachment_over_one_mb_and_download_headers(self):
        raw=b'x'*(1024*1024+1)
        t=self.ticket(attachments=[dict(name='archivo" onmouseover="marker=1.txt',type='text/plain',data=base64.b64encode(raw).decode())])
        private=self.client.get('/api/tickets/'+t['code'],headers=self.headers).get_json()
        response=self.client.get('/api/attachments/'+str(private['attachments'][0]['id']),headers=self.headers)
        self.assertEqual(response.data,raw);self.assertEqual(response.content_type,'application/octet-stream')
        self.assertNotIn('" onmouseover',response.headers['Content-Disposition'])
    def test_invalid_attachments_leave_no_ticket(self):
        for files in ([{'name':'bad','data':'%%%'}],[None],[dict(name='bad\nheader',type='text/plain',data='YQ==')],[]*0+[dict(name='a',type='text/plain',data='YQ==')]*6):
            self.assertEqual(self.client.post('/api/tickets',json={**self.payload,'attachments':files}).status_code,400)
        with server.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) AS n FROM tickets').fetchone()['n'],0)
    def test_request_limit_and_json_errors(self):
        with patch.dict(server.app.config,MAX_CONTENT_LENGTH=100):
            self.assertEqual(self.client.post('/api/tickets',data='x'*101,content_type='application/json').status_code,413)
        self.assertEqual(self.client.patch('/api/admin/tickets/TK-1',headers=self.headers,data='{',content_type='application/json').status_code,400)
    def test_health_checks_database(self):
        self.assertEqual(self.client.get('/api/health').status_code,200)
        with patch('server.db',side_effect=server.psycopg.OperationalError('offline')):
            self.assertEqual(self.client.get('/api/health').status_code,503)
    def test_logout_revokes_token(self):
        self.assertEqual(self.client.post('/api/auth/logout',json={},headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/tickets',headers=self.headers).status_code,401)
    def test_rate_limit_persists_in_database(self):
        for _ in range(10):
            self.assertEqual(self.client.post('/api/auth/login',json={**self.credentials,'password':'wrong'}).status_code,401)
        response=self.client.post('/api/auth/login',json=self.credentials)
        self.assertEqual(response.status_code,429);self.assertIn('Retry-After',response.headers)
        with server.db() as c:
            c.execute("UPDATE auth_attempts SET started_at=NOW()-INTERVAL '16 minutes'")
        self.assertEqual(self.client.post('/api/auth/login',json=self.credentials).status_code,200)
    def test_expired_sessions_removed(self):
        with server.db() as c:c.execute("UPDATE ti_sessions SET expires_at=NOW()-INTERVAL '1 second'")
        self.assertEqual(self.client.get('/api/tickets',headers=self.headers).status_code,401)
        self.client.post('/api/auth/login',json=self.credentials)
        with server.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) AS n FROM ti_sessions WHERE expires_at<=NOW()').fetchone()['n'],0)
    def test_individual_accounts_and_actor(self):
        data={'username':'technician','password':'Technician-password-2026!'}
        response=self.client.post('/api/admin/users',json=data,headers=self.headers);self.assertEqual(response.status_code,201)
        user=response.get_json();auth=self.client.post('/api/auth/login',json=data).get_json();headers={'Authorization':'Bearer '+auth['token']}
        self.assertEqual(self.client.get('/api/admin/users',headers=headers).status_code,403)
        t=self.ticket()
        self.assertEqual(self.client.post('/api/admin/tickets/'+t['code']+'/comments',json={'body':'Comentario de técnico'},headers=headers).status_code,201)
        history=self.client.get('/api/reports/tickets/'+t['code'],headers=self.headers).get_json()
        self.assertEqual(history['comments'][0]['author'],'technician');self.assertEqual(history['events'][-1]['actor'],'technician')
        self.assertEqual(self.client.patch('/api/admin/users/'+str(user['id']),headers=self.headers,json={'active':False}).status_code,200)
        self.assertEqual(self.client.get('/api/tickets',headers=headers).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json=data).status_code,401)
    def test_password_change_revokes_all_sessions(self):
        response=self.client.post('/api/auth/password',headers=self.headers,json={'current_password':self.credentials['password'],'password':'Different-password-2026!'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.get('/api/tickets',headers=self.headers).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json=self.credentials).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={**self.credentials,'password':'Different-password-2026!'}).status_code,200)
    def test_last_admin_and_weak_password(self):
        self.assertEqual(self.client.post('/api/admin/users',headers=self.headers,json={'username':'weak','password':'short'}).status_code,400)
        self.assertEqual(self.client.patch('/api/admin/users/1',headers=self.headers,json={'active':False}).status_code,400)
    def test_pagination_aggregates_and_csv(self):
        created=[self.ticket(subject='=1+1' if n==0 else 'Ticket '+str(n)) for n in range(27)]
        self.client.patch('/api/admin/tickets/'+created[0]['code'],json={'status':'Cerrado'},headers=self.headers)
        response=self.client.get('/api/reports/tickets?page_size=25',headers=self.headers).get_json()
        self.assertEqual(len(response['items']),25);self.assertEqual(response['total'],27);self.assertEqual(response['summary']['closed'],1)
        self.assertNotIn('description',response['items'][0]);self.assertNotIn('tracking_hash',response['items'][0])
        page=self.client.get('/api/reports/tickets?page=2',headers=self.headers).get_json();self.assertEqual(len(page['items']),2)
        filtered=self.client.get('/api/reports/tickets?status=Cerrado',headers=self.headers).get_json();self.assertEqual(filtered['total'],1)
        export=self.client.get('/api/reports/tickets/export',headers=self.headers)
        self.assertEqual(export.status_code,200);self.assertIn("'=1+1",export.data.decode('utf-8-sig'));self.assertEqual(len(export.data.decode('utf-8-sig').splitlines()),28)
        for query in ('page_size=10000','basis=bad','from=2026-12-31&to=2026-01-01','status=invalid','page=1&page=2'):
            self.assertEqual(self.client.get('/api/reports/tickets?'+query,headers=self.headers).status_code,400)
    def test_archive_and_reopen_history(self):
        t=self.ticket();url='/api/admin/tickets/'+t['code']
        for status in ('Cerrado','Abierto','Cerrado'):self.assertEqual(self.client.patch(url,headers=self.headers,json={'status':status}).status_code,200)
        self.client.delete(url,headers=self.headers)
        history=self.client.get('/api/reports/tickets/'+t['code'],headers=self.headers).get_json()
        self.assertIsNotNone(history['closed_at']);self.assertEqual(history['events'][-1]['action'],'Archivado')
        self.assertEqual(self.client.get('/api/tickets/'+t['code'],headers={}).status_code,404)
    def test_device_printers_and_optional_computer_specs(self):
        payload=dict(name='Equipo opcional',kind='desktop',area='Sistemas',owner='Prueba')
        response=self.client.post('/api/devices',headers=self.headers,json=payload)
        self.assertEqual(response.status_code,201,response.get_json())
        device=response.get_json()
        for key in ('mac_address','processor','ram'):self.assertEqual(device[key],'')
        url='/api/devices/'+str(device['id'])
        specs=dict(ip_address='192.168.1.25',mac_address='aa-bb-cc-dd-ee-ff',processor='Intel Core i5',ram='16 GB DDR4')
        saved=self.client.patch(url,headers=self.headers,json={**payload,**specs})
        self.assertEqual(saved.status_code,200,saved.get_json())
        self.assertEqual(saved.get_json()['mac_address'],'AA:BB:CC:DD:EE:FF')
        legacy=self.client.patch(url,headers=self.headers,json=payload).get_json()
        self.assertEqual(legacy['ip_address'],specs['ip_address'])
        self.assertEqual(legacy['processor'],specs['processor'])
        self.assertEqual(legacy['ram'],specs['ram'])
        self.assertEqual(legacy['mac_address'],'AA:BB:CC:DD:EE:FF')
        self.assertEqual(self.client.patch(url,headers=self.headers,json={**payload,'mac_address':'invalid'}).status_code,400)
        printer=self.client.post('/api/devices',headers=self.headers,json={**payload,'name':'Impresora prueba','kind':'printer'})
        self.assertEqual(printer.status_code,201,printer.get_json())
        self.assertEqual(printer.get_json()['kind'],'printer')
        rows=self.client.get('/api/devices',headers=self.headers).get_json()
        self.assertEqual(len(rows),2)
        computer=next(row for row in rows if row['id']==device['id'])
        self.assertEqual(computer['processor'],specs['processor'])
        self.assertEqual(self.client.post('/api/devices',headers=self.headers,json={**payload,'kind':'scanner'}).status_code,400)

    def test_mobile_devices_and_map_restriction(self):
        payload=dict(name='Celular de prueba',kind='phone',area='Sistemas',owner='Prueba',x=25,y=40)
        response=self.client.post('/api/devices',headers=self.headers,json=payload)
        self.assertEqual(response.status_code,201,response.get_json())
        phone=response.get_json()
        self.assertIsNone(phone['x']);self.assertIsNone(phone['y'])
        url='/api/devices/'+str(phone['id'])
        tablet=self.client.patch(url,headers=self.headers,json={**payload,'kind':'tablet'}).get_json()
        self.assertEqual((tablet['x'],tablet['y']),(25,40))
        phone=self.client.patch(url,headers=self.headers,json=payload).get_json()
        self.assertIsNone(phone['x']);self.assertIsNone(phone['y'])

    def test_device_floor_and_office_persistence(self):
        payload=dict(name='Equipo oficinas',kind='desktop',area='Sistemas',owner='Prueba',x=23,y=68)
        created=self.client.post('/api/devices',headers=self.headers,json=payload)
        self.assertEqual(created.status_code,201)
        device=created.get_json();self.assertEqual(device['floor'],'');self.assertEqual(device['office'],'')
        url='/api/devices/'+str(device['id'])
        for floor in ('ground','upper'):
            response=self.client.patch(url,headers=self.headers,json={**payload,'floor':floor,'office':'Contabilidad'})
            self.assertEqual(response.status_code,200,response.get_json())
            self.assertEqual(response.get_json()['floor'],floor)
        old_client=self.client.patch(url,headers=self.headers,json=payload).get_json()
        self.assertEqual(old_client['floor'],'upper');self.assertEqual(old_client['office'],'Contabilidad')
        self.assertEqual((old_client['x'],old_client['y']),(23,68))
        self.assertEqual(self.client.patch(url,headers=self.headers,json={**payload,'floor':'invalid'}).status_code,400)
        listed=self.client.get('/api/devices',headers=self.headers).get_json()
        self.assertEqual(listed[0]['floor'],'upper')

    def test_new_device_area_is_added_to_catalog(self):
        area='Nueva area de inventario'
        payload=dict(name='Equipo nueva area',kind='desktop',area=area,owner='Prueba')
        response=self.client.post('/api/devices',headers=self.headers,json=payload)
        self.assertEqual(response.status_code,201,response.get_json())
        self.assertEqual(response.get_json()['area'],area)
        public=self.client.get('/api/config').get_json()
        self.assertTrue(any(row['name']==area for row in public['areas']))
        second=self.client.post('/api/devices',headers=self.headers,json={**payload,'name':'Otro equipo','area':area.lower()})
        self.assertEqual(second.status_code,201,second.get_json())
        self.assertEqual(second.get_json()['area'],area)
        with server.db() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) AS n FROM config_catalog WHERE kind='area' AND lower(name)=lower(%s)",(area,)).fetchone()['n'],1)
        updated=self.client.patch('/api/devices/'+str(response.get_json()['id']),headers=self.headers,json={**payload,'area':'Otra area nueva'})
        self.assertEqual(updated.status_code,200,updated.get_json())
        self.assertEqual(updated.get_json()['area'],'Otra area nueva')

    def test_migrations_are_idempotent(self):
        from migrations import migrate
        migrate(server.db);migrate(server.db)
        from migrations import UPGRADES
        with server.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) AS n FROM schema_migrations').fetchone()['n'],len(UPGRADES))

if __name__=='__main__':unittest.main(verbosity=2)
