# Imagen de provider-service. Dos etapas: se compila con las dependencias de
# desarrollo y se ejecuta sin ellas, de modo que TypeScript y las pruebas no
# viajan a produccion.
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/service-kit/package.json packages/service-kit/
COPY packages/messaging/package.json packages/messaging/
COPY services/provider-service/package.json services/provider-service/
RUN npm ci --ignore-scripts=false

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/service-kit packages/service-kit
COPY packages/messaging packages/messaging
COPY services/provider-service services/provider-service
RUN npx tsc --build services/provider-service

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/service-kit/package.json packages/service-kit/
COPY packages/messaging/package.json packages/messaging/
COPY services/provider-service/package.json services/provider-service/
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/service-kit/dist packages/service-kit/dist
COPY --from=build /app/packages/messaging/dist packages/messaging/dist
COPY --from=build /app/services/provider-service/dist services/provider-service/dist

# Sin privilegios de root: la imagen de node ya trae el usuario `node`.
USER node
EXPOSE 3002

# El orquestador comprueba el estado por HTTP; no hace falta curl en la imagen.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "services/provider-service/dist/main.js"]
