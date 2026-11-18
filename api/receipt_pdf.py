"""Branded, paginated ticket receipts. All user content is escaped before layout."""
import io
from datetime import datetime, timezone, timedelta
from html import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.pagesizes import letter


def render_receipt(ticket, support):
    output = io.BytesIO()
    blue = colors.HexColor('#0879d9')
    ink = colors.HexColor('#172235')
    muted = colors.HexColor('#536579')
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle('TicketBody', fontName='Helvetica', fontSize=9, leading=13, textColor=ink, spaceAfter=4, splitLongWords=True))
    styles.add(ParagraphStyle('TicketLabel', parent=styles['TicketBody'], fontSize=8, textColor=muted, spaceAfter=3))
    styles.add(ParagraphStyle('TicketHeading', parent=styles['TicketBody'], fontName='Helvetica-Bold', fontSize=12, leading=16, spaceBefore=10, spaceAfter=7))
    styles.add(ParagraphStyle('TicketCode', parent=styles['TicketBody'], fontName='Helvetica-Bold', fontSize=30, leading=38, textColor=blue))
    def para(value, style='TicketBody'):
        return Paragraph(escape(str(value or 'No registrado')).replace('\n', '<br/>'), styles[style])
    doc = SimpleDocTemplate(output, pagesize=letter, rightMargin=48, leftMargin=48, topMargin=104, bottomMargin=60, title=f"Comprobante {ticket['code']}", author='MESA TI', pageCompression=0)
    story = [para('COMPROBANTE DE SOLICITUD', 'TicketLabel'), para(ticket['code'], 'TicketCode'), para(ticket['subject'], 'TicketHeading')]
    def date(value):
        if not value: return 'No registrado'
        if isinstance(value,str): value=datetime.fromisoformat(value)
        return value.astimezone(timezone(timedelta(hours=-6))).strftime('%d/%m/%Y %H:%M') + ' (UTC-06)'
    rows = []
    fields = [('Estado', ticket['status']), ('Prioridad', ticket['priority']), ('Solicitante', ticket['requester']), ('Número de nómina', ticket.get('payroll')), ('Área', ticket['area']), ('Categoría', ticket['category']), ('Equipo', ticket.get('device_name')), ('Asignado a', ticket.get('assignee')), ('Fecha de creación', date(ticket['created_at'])), ('Última actualización', date(ticket['updated_at']))]
    for i in range(0, len(fields), 2):
        rows.append([[para(label, 'TicketLabel'), para(value)] for label, value in fields[i:i+2]])
    grid = Table(rows, colWidths=[258, 258], hAlign='LEFT')
    grid.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#f2f7fc')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.5,colors.white)]))
    story.extend([grid, para('Descripción de la solicitud', 'TicketHeading')])
    for line in str(ticket['description']).split('\n'):
        # Separate paragraphs keep even very long descriptions splittable across pages.
        story.append(para(line or ' '))
    if ticket.get('attachments'):
        story.append(para('Evidencia adjunta', 'TicketHeading'))
        for attachment in ticket['attachments']: story.append(para(attachment['name']))
    story.append(para('Consulta el estado y el detalle con tu folio, tu nombre completo o tu número de nómina.'))
    story.extend([para('Contacto de soporte', 'TicketHeading')])
    contact=[]
    for label, key in [('Planta','site_name'), ('Soporte','technician_name'), ('Extensión','extension'), ('Correo','email'), ('Horario','hours')]:
        if support.get(key): contact.append(f'{label}: {support[key]}')
    story.append(para(' | '.join(contact)))
    def frame(canvas, document):
        canvas.saveState()
        canvas.setFillColor(ink); canvas.rect(0, 716, 612, 76, fill=1, stroke=0)
        canvas.setFillColor(blue); canvas.rect(0, 712, 612, 4, fill=1, stroke=0)
        canvas.setFillColor(colors.white); canvas.setFont('Helvetica-Bold', 22); canvas.drawString(48, 747, 'MESA TI')
        canvas.setFont('Helvetica', 9); canvas.drawRightString(564, 750, 'SOPORTE INTERNO')
        canvas.setStrokeColor(colors.HexColor('#dce4ec'));canvas.line(48, 44, 564, 44)
        canvas.setFillColor(muted);canvas.setFont('Helvetica', 8)
        canvas.drawString(48, 30, f"{ticket['code']} | Conserva este comprobante")
        canvas.drawRightString(564, 30, f'Página {document.page}')
        canvas.restoreState()
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return output.getvalue()
