FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY public.css /usr/share/nginx/html/public.css
COPY receipt.css /usr/share/nginx/html/receipt.css
COPY login.css /usr/share/nginx/html/login.css
COPY admin.css /usr/share/nginx/html/admin.css
COPY app.js /usr/share/nginx/html/app.js
COPY inventory.js inventory.css Bodegas_Ramos_V06.svg /usr/share/nginx/html/
COPY reports.js reports.css /usr/share/nginx/html/
COPY mesa /usr/share/nginx/html/mesa
COPY mesa-adapter.css /usr/share/nginx/html/mesa-adapter.css
COPY logo-mesa.svg /usr/share/nginx/html/logo-mesa.svg
COPY logo.css /usr/share/nginx/html/logo.css

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
