FROM node:22-alpine

ENV NODE_ENV=production \
    CONTENT_RUNTIME_MODE=shadow \
    CONTENT_READ_SOURCE=object_storage \
    PORT=8080

WORKDIR /app
RUN apk add --no-cache postgresql-client
COPY services/content-api/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-package-lock && npm cache clean --force
COPY services/content-api/migrations ./migrations
COPY services/content-api/src ./src

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
