# Imagen del migrador.
#
# Sustituye al `npm install` en tiempo de ejecucion que hacia antes el servicio
# `migrator`: aquello dependia de la red en cada arranque, no fijaba versiones
# —lo que 00-governance/security-rules.md prohibe— y fallaba sin dejar ningun
# registro, lo que lo volvia imposible de diagnosticar.
#
# Aqui las dependencias quedan fijadas en la imagen y el arranque solo ejecuta
# las migraciones.
FROM node:20-alpine

WORKDIR /app

# Solo el manifiesto de db/: el package.json raiz declara workspaces que no
# existen en esta imagen y romperian la instalacion.
COPY db/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY db ./db

# Sin privilegios de root: la imagen de node ya trae el usuario `node`.
USER node

ENTRYPOINT ["node", "db/cli.js"]
CMD ["migrate"]
