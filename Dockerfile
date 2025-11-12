FROM nginx:alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY public/ /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]





