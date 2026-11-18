import assert from 'node:assert/strict';
import {ensureIsolated,dockerExec} from './helpers.mjs';
await ensureIsolated();
const query="SELECT (SELECT count(*) FROM tickets),(SELECT count(*) FROM attachments),(SELECT count(*) FROM devices),(SELECT count(*) FROM ti_users),(SELECT count(*) FROM ticket_events),(SELECT count(*) FROM schema_migrations),(SELECT count(*) FROM pending_tasks)";
const before=dockerExec('postgres','psql','-U','tickets','-d','tickets_test','-At','-c',query).trim();
try{
  dockerExec('postgres','pg_dump','-U','tickets','-d','tickets_test','-Fc','-f','/tmp/restore-test.dump');
  dockerExec('postgres','createdb','-U','tickets','tickets_restore_test');
  dockerExec('postgres','pg_restore','-U','tickets','--exit-on-error','--no-owner','-d','tickets_restore_test','/tmp/restore-test.dump');
  dockerExec('postgres','psql','-U','tickets','-d','tickets_restore_test','-c','DELETE FROM ti_sessions');
  const after=dockerExec('postgres','psql','-U','tickets','-d','tickets_restore_test','-At','-c',query).trim();assert.equal(after,before);
  console.log('Respaldo: pg_dump y restauración real en una base temporal independiente: OK');
}finally{dockerExec('postgres','dropdb','-U','tickets','--if-exists','tickets_restore_test');}
