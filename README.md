# Mesa TI

Interfaz inicial del sistema de tickets, servida con Nginx dentro de Docker.

## Iniciar

Desde PowerShell, dentro de esta carpeta:

Primero crea `.env` a partir de `.env.example` y cambia las contraseñas. El archivo `.env` no se publica en Git.

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

En la computadora servidor se abre en:

```text
http://localhost:8080
```

En otros equipos de la misma red se abre usando la IP del servidor:

```text
http://IP-DEL-SERVIDOR:8080
```

Para conocer la IP del servidor:

```powershell
ipconfig
```

Busca la dirección IPv4 del adaptador de red que esté en uso.

## Operación

Consultar el estado:

```powershell
docker compose ps
```

Ver registros:

```powershell
docker compose logs -f
```

Detener el sistema:

```powershell
docker compose down
```

Después de modificar la página, aplicar los cambios con:

```powershell
docker compose up -d --build
```

## Datos y administración

El sistema incluye una API en Python y PostgreSQL en el volumen Docker `proyectotikets_postgres_data`. Los tickets y archivos adjuntos son comunes para todos los equipos de la red y se conservan al reiniciar o reconstruir los contenedores. Los registros de la base SQLite inicial se migran automáticamente la primera vez.

El portal público permite crear y consultar tickets sin cuenta. El panel de TI requiere autenticación y permite cambiar estado, prioridad y responsable, agregar comentarios y eliminar órdenes.

> `docker compose down` conserva los datos. No uses `docker compose down -v` salvo que quieras borrar permanentemente la base.

## Inventario de dispositivos

Entra al panel de TI y abre **Dispositivos**. Puedes agregar PCs de escritorio y laptops, buscar por nombre, responsable o serie y filtrar por tipo y área. Cada ficha incluye responsable, usuario, contraseña opcional, modelo, serie, notas y fecha del último mantenimiento.

La vista **Plano** utiliza `Bodegas_Ramos_V06.svg`. Desde la ficha, pulsa **Colocar en el plano**, usa el zoom y haz clic en la ubicación. Confirma con **Guardar dispositivo**. Las coordenadas se guardan como porcentajes para conservar su posición con cualquier tamaño de pantalla. También puedes editar las coordenadas con teclado o quitar una ubicación. Los marcadores abren la ficha y distinguen escritorio y laptop por forma, icono y color.

Los dispositivos se guardan en PostgreSQL y sus rutas requieren la sesión de TI. Las contraseñas se cifran con Fernet; el listado no devuelve las contraseñas ni el contenido cifrado. Para consultarlas, usa **Mostrar** en la ficha. Al editar, dejar intacto el campo conserva la contraseña; vaciar un campo modificado la elimina.

Antes de guardar contraseñas, configura `DEVICE_ENCRYPTION_KEY` en `.env`. En esta instalación ya se generó una clave independiente. En una instalación nueva puedes generar una sin dependencias con `python -c "import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"`. Copia el resultado en `.env` y reconstruye los servicios. Conserva esa clave con el respaldo de la base: cambiarla impide descifrar las contraseñas anteriores. Cambiar la contraseña de acceso de TI no afecta el cifrado del inventario.

Validación del inventario: `npm run test:inventory` (app en `http://127.0.0.1:8082`; puedes cambiarla con `TEST_URL`). La prueba crea registros temporales y los elimina al terminar.

## Reportes e historial

**Reportes** muestra todos los tickets, incluidos los archivados, con apertura, estado actual, responsable, área, categoría, prioridad y último cierre. Los filtros permiten seleccionar fecha de apertura o último cierre, rango de fechas, estado, área, categoría, prioridad, archivo y búsqueda. Las fechas se interpretan en `America/Mexico_City`. Los indicadores y las distribuciones por área/categoría utilizan la selección completa, aunque la tabla se pagine de 25 en 25.

Selecciona un folio para consultar descripción, cambios de estado y asignación, comentarios, adjuntos y fechas. Cada transición se registra en PostgreSQL. Cerrar asigna `closed_at`; reabrir lo limpia pero conserva el cierre anterior en el historial. Editar otros campos de un ticket cerrado conserva su fecha de cierre. El tiempo hasta el cierre se calcula desde la apertura hasta el último cierre registrado y no representa horas efectivas de trabajo.

Los tickets anteriores a esta función tienen un movimiento **Registro previo**. Sus fechas de cierre y cambios anteriores son desconocidos: no se reconstruyen a partir de `updated_at`. Los tickets eliminados antes de la función tampoco se pueden recuperar. Desde ahora **Archivar ticket** quita el ticket del panel y de la consulta pública, conservando sus datos en Reportes.

**Exportar CSV** descarga todos los resultados filtrados, con protección ante fórmulas en textos. La ficha tiene su propia exportación del historial. **Imprimir / PDF** abre la impresión del navegador; selecciona Guardar como PDF para obtener el documento. La impresión incluye todas las páginas de la selección.

Validación: `npm run test:reports`. Requiere Docker local y crea registros temporales que elimina permanentemente al terminar, incluso si se archivaron durante la prueba.
