FROM python:3.13-alpine
WORKDIR /app
COPY server.py .
COPY inventory.py .
COPY reports.py .
COPY maintenance.py .
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
USER app
EXPOSE 8081
CMD ["python","server.py"]
