#!/bin/sh
# Aplica las migraciones y, solo en desarrollo o pruebas, carga los seeds.
#
# El propio CLI vuelve a comprobar el entorno: esta condicion decide si se
# intenta, y la del CLI decide si se permite.
set -e

echo "[migrator] aplicando migraciones"
node db/cli.js migrate

case "${NODE_ENV:-}" in
  development|test)
    echo "[migrator] cargando seeds (NODE_ENV=${NODE_ENV})"
    node db/cli.js seed
    ;;
  *)
    echo "[migrator] seeds omitidos (NODE_ENV=${NODE_ENV:-sin definir})"
    ;;
esac

echo "[migrator] listo"
