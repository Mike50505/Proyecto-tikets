# Seguridad y operación

Las correcciones del análisis del 16 de octubre de 2026 conservan los tickets,
inventario, adjuntos e historial existentes.

## Seguimiento público

Crear un ticket no requiere cuenta. El comprobante incluye el folio y una clave
aleatoria de seguimiento. Copiar código, JPG y PDF conservan ambos datos. La
clave se almacena en el servidor sólo como hash y se transmite por un encabezado,
sin incluirla en la URL ni en los registros de acceso de Nginx.

Consultar un folio requiere esa clave. La respuesta pública contiene únicamente
folio, estado y fechas de apertura/actualización. La descripción, el solicitante,
el dispositivo, los comentarios y los adjuntos requieren sesión de TI.

Los tickets anteriores siguen en el panel y en Reportes. Como no tenían clave,
TI debe abrir su ficha y pulsar **Generar clave de seguimiento** para compartirla
con el solicitante. Renovar una clave invalida la anterior y deja un movimiento
en el historial. Los comprobantes PDF también requieren clave o sesión.

## Cuentas individuales

La primera inicialización crea la cuenta indicada en `ADMIN_USER` y
`ADMIN_PASSWORD`; se conserva la credencial de la instalación existente.
Después de esa inicialización, cambiar estas variables no sobrescribe cuentas.

En **Configuración → Cuentas de TI**, un administrador puede crear técnicos u
otros administradores, cambiar permisos, restablecer contraseñas y desactivar
cuentas. Debe quedar un administrador activo. Cada persona cambia su contraseña
en **Mi cuenta** proporcionando la actual. Las nuevas contraseñas requieren de
12 a 200 caracteres y se guardan con scrypt y sal aleatoria.

Cambiar contraseña, permisos o estado revoca las sesiones de esa cuenta.
**Cerrar sesión** revoca el token en PostgreSQL. Las sesiones duran ocho horas;
los tokens se guardan como hashes y funcionan entre los workers de Gunicorn.
El historial de tickets registra el usuario individual que realizó cada cambio.

Tras diez fallos por cuenta o sesenta por IP durante quince minutos, el acceso
devuelve HTTP 429 con `Retry-After`. Los intentos se conservan entre reinicios.
No se recomienda compartir cuentas; la cuenta inicial sirve para dar de alta
las cuentas personales.

## Archivos, API y servidor

Se permiten cinco archivos, máximo 10 MiB por archivo y 50 MiB en total.
Nginx y Flask aceptan hasta 72 MiB de solicitud para cubrir la codificación
base64 y el JSON. La API valida tamaños antes de decodificar, nombres sin
caracteres de control, tipos de datos y longitudes de los campos. Las descargas
usan `application/octet-stream` y un nombre codificado para evitar interpretar
contenido activo o inyectar encabezados.

La prioridad se valida contra una lista cerrada. El frontend usa clases CSS
conocidas y escapa comillas cuando genera atributos. La política CSP permite
scripts del mismo origen y bloquea manejadores de eventos inyectados.

Flask se sirve mediante Gunicorn con dos workers y cuatro hilos por worker.
Nginx usa la rama estable 1.30. El healthcheck de API consulta PostgreSQL y
devuelve HTTP 503 cuando la base no está disponible. Los errores de API son
JSON y no muestran credenciales ni detalles de SQL. Las migraciones se registran
en `schema_migrations` y se ejecutan transaccionalmente con un bloqueo asesor.

El Compose base publica sólo `127.0.0.1:8080`. El override de esta estación usa
`127.0.0.1:8082`. Para compartir el servicio con otros equipos se requiere un
proxy HTTPS configurado para la red autorizada; no se modifica un proxy externo
mediante esta actualización.

## Reportes y paginación

`GET /api/tickets` y `GET /api/reports/tickets` devuelven `items`, `total`,
`page`, `page_size` y resúmenes. El tamaño predeterminado es 25 y el máximo 100.
Los filtros se ejecutan en PostgreSQL y las fechas usan Ciudad de México. Los
indicadores y distribuciones abarcan toda la selección, no sólo la página.

`GET /api/reports/tickets/export` exporta la selección completa con un cursor
de servidor y protección ante fórmulas de hojas de cálculo. La impresión
solicita páginas adicionales sólo cuando se pulsa Imprimir, conservando todos
los resultados. Los detalles y descripciones se consultan al abrir la ficha.

## Respaldos

El servicio `backup` crea un dump de PostgreSQL al iniciar y cada 24 horas,
en `backups/tickets-<fecha-UTC>.dump`. Comprueba el índice del archivo antes de
publicarlo y mantiene el estado de salud con la fecha del último respaldo.
Un fallo se reintenta a los 60 segundos. No elimina respaldos antiguos.
La carpeta está excluida de Git y de la imagen web.

Para crear un respaldo manual previo a una actualización:

```powershell
powershell -NoProfile -File scripts/backup.ps1
docker compose ps backup
docker compose logs --tail 20 backup
```

El respaldo contiene datos sensibles, incluidos hashes de cuentas y las
contraseñas cifradas del inventario. Guarda una copia en almacenamiento
restringido fuera de este equipo y conserva `DEVICE_ENCRYPTION_KEY` por separado
en un lugar seguro: sin esa clave, restaurar la base no permite descifrar las
contraseñas del inventario. El respaldo local protege frente a cambios y errores;
no sustituye una copia externa frente a la pérdida del disco.

Para restaurar en otro servidor, usa PostgreSQL 17, una base vacía y
`pg_restore --exit-on-error --no-owner`. Antes de abrir el acceso, elimina las
sesiones restauradas con `DELETE FROM ti_sessions` para que los usuarios vuelvan
a autenticarse. Configura la clave de cifrado original,
inicia la API y comprueba tickets, historial e inventario antes de cambiar el
acceso de los usuarios. No restaures encima de una base operativa sin una copia
previa y una ventana de mantenimiento. No uses `docker compose down -v` sobre
la instalación operativa.

## Pruebas

```powershell
npm test
npm run test:security
npm run test:reports
```

El runner crea el proyecto Docker `mesa-ti-tests` con la base `tickets_test`
en almacenamiento temporal y el frontend en `127.0.0.1:18082`. No usa el volumen
ni las credenciales operativas. Los scripts abortan si no se confirma que se
trata de ese servicio de pruebas. Las limpiezas SQL apuntan exclusivamente al
Compose de pruebas. Al terminar, incluso si hay errores, el runner retira los
contenedores temporales. `KEEP_TEST_STACK=1` permite conservarlos para depurar.

Se ejecutan regresiones Python de API, las suites de navegador de móvil,
inventario, reportes, mantenimiento, configuración y seguridad, y un `pg_dump`
con restauración real en otra base de pruebas y comparación de conteos.
Chrome es el navegador predeterminado; `BROWSER_PATH` permite indicar otra
instalación compatible. Docker y Node deben estar disponibles.

Las pruebas cubren inyección en prioridades históricas y nombres de archivos,
validación de prioridades nuevas, consulta pública, rotación de claves,
adjuntos mayores de 1 MiB, formularios y comentarios, paginación, estadísticas,
CSV, impresión, cifrado, agenda, cuentas, permisos, contraseñas y revocación.
