# Verificación del 16 de octubre de 2026

Actualización aplicada al proyecto Docker `proyectotikets`, usando el override
local y conservando el acceso en `http://127.0.0.1:8082` y el volumen PostgreSQL.

La ejecución completa de `node tests/run.mjs` terminó con código 0:

- 17 regresiones de API y seguridad sobre PostgreSQL real.
- Seis suites de navegador: flujo móvil, inventario, reportes, mantenimiento,
  configuración y seguridad/cuentas.
- Exportación `pg_dump` y restauración real en `tickets_restore_test`, con
  comparación de conteos y revocación de sesiones de la copia restaurada.
- Retirada de los contenedores y la base temporal al finalizar.

Antes de actualizar se creó y verificó
`backups/tickets-20261016-141134.dump` (185141 bytes). Se registraron conteos y
hashes de las seis tablas operativas: tickets, comentarios, adjuntos,
dispositivos, mantenimientos e historial. Después de actualizar, los conteos y
hashes coinciden, excluyendo únicamente la nueva columna de hash de seguimiento.
Las evidencias están en `backups/pre-update-integrity.json` y
`backups/post-update-integrity.json`, excluidas de Git.

La comprobación operativa `node --env-file=.env scripts/smoke.mjs` terminó con
código 0: salud real de la base, credenciales existentes, consulta pública
protegida, acceso a cuentas, seis paletas en escritorio y móvil, ausencia de
desbordamiento horizontal y revocación de sesión. No creó ni modificó tickets,
dispositivos, comentarios o mantenimientos. Sólo abrió y revocó una sesión de
comprobación.

Estado final: `mesa-ti`, `api`, `postgres` y `backup` en ejecución y saludables.
El servicio de respaldo generó y verificó su primer dump automático. Los
respaldos diarios son locales; una copia fuera del equipo y la custodia separada
de la clave de cifrado se describen en [seguridad y operación](seguridad-operacion.md).

Las sesiones antiguas del servidor anterior deben iniciar sesión de nuevo.
Las credenciales iniciales existentes siguen funcionando. Los folios anteriores
conservan sus registros; para seguimiento público, TI debe generar su clave
desde la ficha. Las cuentas personales se administran en Configuración.
