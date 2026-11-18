"""Versioned, transactional upgrades serialized across application workers."""
from inventory import SCHEMA as INVENTORY
from reports import SCHEMA as REPORTS
from maintenance import SCHEMA as MAINTENANCE
from settings import SCHEMA as SETTINGS
from auth import SCHEMA as AUTH, bootstrap
from plant_plan import SCHEMA as PLAN
from pending import SCHEMA as PENDING

BASE = """
CREATE TABLE IF NOT EXISTS tickets(id SERIAL PRIMARY KEY,code TEXT UNIQUE,requester TEXT NOT NULL,area TEXT NOT NULL,subject TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Abierto',assignee TEXT DEFAULT 'Sin asignar',created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS comments(id SERIAL PRIMARY KEY,ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,author TEXT NOT NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS attachments(id SERIAL PRIMARY KEY,ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,data BYTEA NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
"""
UPGRADES = [
    (1,BASE+INVENTORY+REPORTS+MAINTENANCE+SETTINGS),
    (2,AUTH+"""
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tracking_hash TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS tickets_tracking_idx ON tickets(tracking_hash) WHERE tracking_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS tickets_opened_idx ON tickets(created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS tickets_closed_idx ON tickets(closed_at DESC) WHERE closed_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS tickets_active_idx ON tickets(id DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS comments_ticket_idx ON comments(ticket_id,id);
      CREATE INDEX IF NOT EXISTS attachments_ticket_idx ON attachments(ticket_id,id);
    """),
    (3,"""
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS mac_address TEXT NOT NULL DEFAULT '';
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS processor TEXT NOT NULL DEFAULT '';
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS ram TEXT NOT NULL DEFAULT '';
      ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_kind_check;
      ALTER TABLE devices ADD CONSTRAINT devices_kind_check CHECK (kind IN ('desktop','laptop','printer'));
    """),
    (4,"ALTER TABLE devices ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';"),
    (5,"""
      ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_kind_check;
      ALTER TABLE devices ADD CONSTRAINT devices_kind_check CHECK (kind IN ('desktop','laptop','printer','tablet','phone'));
      ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_phone_location_check;
      ALTER TABLE devices ADD CONSTRAINT devices_phone_location_check CHECK (kind <> 'phone' OR (x IS NULL AND y IS NULL));
    """),
    (6,"""
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS floor TEXT NOT NULL DEFAULT '';
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS office TEXT NOT NULL DEFAULT '';
      ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_floor_check;
      ALTER TABLE devices ADD CONSTRAINT devices_floor_check CHECK (floor IN ('','ground','upper'));
    """),
    (7,PLAN),
    (8,"""
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS payroll TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS tickets_payroll_idx ON tickets(payroll) WHERE payroll <> '';
      CREATE INDEX IF NOT EXISTS tickets_requester_idx ON tickets(lower(requester));
    """),
    (9,PENDING),
]

def migrate(db):
    with db() as c:
        c.execute('SELECT pg_advisory_xact_lock(864012307)')
        c.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
        versions={r['version'] for r in c.execute('SELECT version FROM schema_migrations').fetchall()}
        for version,sql in UPGRADES:
            if version not in versions:
                c.execute(sql)
                c.execute('INSERT INTO schema_migrations(version) VALUES(%s)',(version,))
        bootstrap(c)
