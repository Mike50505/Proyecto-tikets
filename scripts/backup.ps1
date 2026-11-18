param([string]$Project = 'proyectotikets')
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '^[a-z0-9][a-z0-9_-]+$') { throw 'Nombre de proyecto inválido' }
$ticketRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $ticketRoot 'backups'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "tickets-$stamp.dump"
Push-Location $ticketRoot
try {
  & docker compose -p $Project exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/mesa-backup.dump && pg_restore -l /tmp/mesa-backup.dump > /dev/null'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar y verificar el respaldo' }
  $container = & docker compose -p $Project ps -q postgres
  if ($LASTEXITCODE -ne 0 -or !$container) { throw 'No se encontró el contenedor PostgreSQL' }
  $file = Join-Path $destination $name
  & docker cp "${container}:/tmp/mesa-backup.dump" $file
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo' }
  Get-FileHash -Algorithm SHA256 -LiteralPath $file | Select-Object Algorithm, Hash, Path
} finally { Pop-Location }
