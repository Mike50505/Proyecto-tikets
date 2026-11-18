"""Upgrade once, then hand HTTP serving to Gunicorn."""
import os
from server import init_db

init_db()
os.execvp('gunicorn',['gunicorn','--bind','0.0.0.0:8081','--workers','2','--worker-class','gthread','--threads','4','--timeout','60','--access-logfile','-','server:app'])
