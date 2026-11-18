"""Bounded ticket pages, full-selection statistics and streamed CSV export."""
import csv
import io
from datetime import date
from urllib.parse import parse_qs, urlparse

PRIORITIES=('Baja','Media','Alta','Crítica')
STATUSES=('Abierto','En progreso','Cerrado')
COLUMNS='id,code,requester,area,subject,category,priority,status,assignee,created_at,updated_at,closed_at,deleted_at,device_id,device_name'

def arguments(url,active=False):
    query=parse_qs(urlparse(url).query,keep_blank_values=True)
    if any(len(values)!=1 for values in query.values()):raise ValueError('Filtros duplicados')
    values={k:v[0] for k,v in query.items()}
    def integer(name,default,maximum):
        raw=values.get(name,str(default))
        if not raw.isdigit() or not 1<=int(raw)<=maximum:raise ValueError('Paginación inválida')
        return int(raw)
    page=integer('page',1,1000000);size=integer('page_size',25,100)
    clauses=[];params=[]
    basis=values.get('basis','created_at')
    if basis not in ('created_at','closed_at'):raise ValueError('Fecha de referencia inválida')
    if basis=='closed_at':clauses.append('closed_at IS NOT NULL')
    bounds={}
    for name,operator in [('from','>='),('to','<=')]:
        raw=values.get(name,'')
        if raw:
            try:bounds[name]=date.fromisoformat(raw)
            except ValueError:raise ValueError('Fecha inválida')
            clauses.append(f"({basis} AT TIME ZONE 'America/Mexico_City')::date {operator} %s")
            params.append(bounds[name])
    if 'from' in bounds and 'to' in bounds and bounds['from']>bounds['to']:raise ValueError('La fecha Desde debe ser anterior o igual a Hasta.')
    for field in ('status','area','category','priority'):
        value=values.get(field,'')
        if len(value)>200:raise ValueError('Filtro demasiado largo')
        if value:
            if field=='status' and value not in STATUSES:raise ValueError('Estado inválido')
            if field=='priority' and value not in PRIORITIES:raise ValueError('Prioridad inválida')
            clauses.append(field+'=%s');params.append(value)
    archive='active' if active else values.get('archive','')
    if archive not in ('','active','archived'):raise ValueError('Filtro de archivo inválido')
    if archive:clauses.append('deleted_at IS '+('NOT ' if archive=='archived' else '')+'NULL')
    search=values.get('search','').strip()
    if len(search)>200:raise ValueError('Búsqueda demasiado larga')
    if search:
        clauses.append("concat_ws(' ',code,subject,requester,assignee,description,device_name) ILIKE %s")
        params.append('%'+search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%')
    return (' WHERE '+' AND '.join(clauses) if clauses else ''),params,page,size

def stats(c,where='',params=()):
    return c.execute("""SELECT COUNT(*) AS total,
      COUNT(*) FILTER(WHERE status='Abierto') AS opened,
      COUNT(*) FILTER(WHERE status='En progreso') AS progress,
      COUNT(*) FILTER(WHERE status='Cerrado') AS closed,
      COUNT(*) FILTER(WHERE deleted_at IS NOT NULL) AS archived,
      COUNT(*) FILTER(WHERE status='Cerrado' AND closed_at IS NOT NULL) AS measured,
      COUNT(*) FILTER(WHERE status='Cerrado' AND date_trunc('month',closed_at AT TIME ZONE 'America/Mexico_City')=date_trunc('month',NOW() AT TIME ZONE 'America/Mexico_City')) AS closed_month,
      AVG(GREATEST(0,EXTRACT(EPOCH FROM (closed_at-created_at))/3600)) FILTER(WHERE status='Cerrado' AND closed_at IS NOT NULL)::double precision AS average_hours
      FROM tickets"""+where,params).fetchone()

def listing(c,url,serialize,active=False):
    where,params,page,size=arguments(url,active)
    summary=stats(c,where,params)
    # Use one snapshot for rows, aggregates and available options.
    total=summary['total'];page=min(page,max(1,(total+size-1)//size))
    items=c.execute(f'SELECT {COLUMNS} FROM tickets'+where+' ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s',params+[size,(page-1)*size]).fetchall()
    result={'items':[{k:serialize(v) for k,v in row.items()} for row in items], 'total':total,'page':page,'page_size':size,'summary':summary}
    for field in ('area','category'):
        result['areas' if field=='area' else 'categories']=[row['value'] for row in c.execute(f'SELECT DISTINCT {field} AS value FROM tickets'+(' WHERE deleted_at IS NULL' if active else '')+' ORDER BY value').fetchall()]
    if active:result['dashboard']=stats(c,' WHERE deleted_at IS NULL')
    else:
        result['breakdowns']={field:c.execute(f'SELECT {field} AS label,COUNT(*) AS count FROM tickets'+where+f' GROUP BY {field} ORDER BY count DESC,{field}',params).fetchall() for field in ('area','category')}
    return result

def csv_cell(value):
    text=str(value if value is not None else '')
    return "'"+text if text.lstrip().startswith(('=','+','-','@')) else text

def export_csv(db,url):
    where,params,_,_=arguments(url)
    output=io.StringIO();writer=csv.writer(output)
    writer.writerow(['Folio','Equipo relacionado','Asunto','Descripción','Solicitante','Área','Categoría','Prioridad','Estado actual','Responsable','Apertura (CDMX)','Último cierre (CDMX)','Tiempo al cierre (horas)','Última actualización (CDMX)','Archivado (CDMX)'])
    yield '\ufeff'+output.getvalue();output.seek(0);output.truncate(0)
    with db() as c:
        with c.cursor(name='ticket_csv') as cursor:
            cursor.execute("""SELECT code,device_name,subject,description,requester,area,category,priority,status,assignee,
              to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD HH24:MI:SS') AS opened,
              to_char(closed_at AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD HH24:MI:SS') AS closed,
              CASE WHEN status='Cerrado' AND closed_at IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (closed_at-created_at))/3600) END AS hours,
              to_char(updated_at AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD HH24:MI:SS') AS updated,
              to_char(deleted_at AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD HH24:MI:SS') AS archived
              FROM tickets"""+where+' ORDER BY created_at DESC,id DESC',params)
            for row in cursor:
                writer.writerow([csv_cell(v) for v in row.values()])
                yield output.getvalue();output.seek(0);output.truncate(0)
