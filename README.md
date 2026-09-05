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
