#!/bin/bash
# Crea un esquema y un usuario por microservicio, cada uno con el privilegio
# minimo necesario sobre su propio esquema y ningun acceso a los demas.
#
# Es un .sh y no un .sql porque las contrasenas llegan por variable de entorno:
# escribirlas en un .sql versionado las dejaria en el repositorio.
#
# Se ejecuta una sola vez, cuando MySQL crea su volumen de datos.
# Para reejecutarlo:  docker compose down -v && docker compose up -d
#
# SRS: RNF28 (credenciales propias por servicio, restringidas a su esquema).

set -euo pipefail

# Cada entrada es "esquema:variable_de_usuario:variable_de_contrasena".
SERVICES=(
  "pa_auth:DB_AUTH_USER:DB_AUTH_PASSWORD"
  "pa_provider:DB_PROVIDER_USER:DB_PROVIDER_PASSWORD"
  "pa_catalog:DB_CATALOG_USER:DB_CATALOG_PASSWORD"
  "pa_request:DB_REQUEST_USER:DB_REQUEST_PASSWORD"
  "pa_rating:DB_RATING_USER:DB_RATING_PASSWORD"
  "pa_notification:DB_NOTIFICATION_USER:DB_NOTIFICATION_PASSWORD"
  "pa_admin:DB_ADMIN_USER:DB_ADMIN_PASSWORD"
)

# Privilegios concedidos a cada servicio sobre SU esquema.
#
# Incluye TRIGGER porque pa_admin crea los disparadores que hacen inmutable la
# tabla de auditoria, y DROP porque el `down` de toda migracion ejecuta
# dropTableIfExists: sin el, `db:rollback` y `db:reset` fallarian y una
# migracion dejaria de ser reversible.
#
# DROP esta acotado a `${schema}`.*, asi que un servicio solo puede soltar sus
# propias tablas. No se concede GRANT OPTION ni ningun privilegio global.
GRANTS="SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, TRIGGER, DROP"

echo "[init] creando esquemas y usuarios de Punto Amigo"

# Como se llega a MySQL depende de quien ejecuta esto.
#
# Dentro del contenedor, root entra por socket unix y no hay nada mas simple. En
# CI, en cambio, MySQL es un service container al que solo se llega por TCP: con
# `--protocol=socket` el cliente busca /var/run/mysqld/mysqld.sock, que ahi no
# existe, y falla con "Can't connect ... through socket" o "Wrong or unknown
# protocol". Por eso el modo se deduce de MYSQL_HOST en vez de fijarse.
if [ -n "${MYSQL_HOST:-}" ]; then
  CONEXION=(--protocol=tcp -h "${MYSQL_HOST}" -P "${MYSQL_PORT:-3306}")
  echo "[init] conectando a ${MYSQL_HOST}:${MYSQL_PORT:-3306} por TCP"
else
  CONEXION=(--protocol=socket)
  echo "[init] conectando por socket unix"
fi

# Un identificador que llegue con comillas o barras invertidas romperia el
# literal SQL y ejecutaria lo que venga detras, en una sesion abierta como root.
# Se rechaza antes de construir ninguna sentencia.
validar_identificador() {
  local valor="$1" etiqueta="$2"
  if ! [[ "$valor" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "[init] ERROR: $etiqueta invalido ('$valor'). Solo letras, digitos y guion bajo." >&2
    exit 1
  fi
}

# La contrasena si puede llevar simbolos, pero no comillas simples ni barras
# invertidas: son los dos caracteres capaces de escapar del literal.
validar_contrasena() {
  local valor="$1" etiqueta="$2"
  if [ -z "$valor" ]; then
    echo "[init] ERROR: falta $etiqueta" >&2
    exit 1
  fi
  case "$valor" in
    *\'*|*\\*)
      echo "[init] ERROR: $etiqueta no puede contener comilla simple ni barra invertida." >&2
      exit 1
      ;;
  esac
}

for entry in "${SERVICES[@]}"; do
  schema="${entry%%:*}"
  rest="${entry#*:}"
  user_var="${rest%%:*}"
  pass_var="${rest#*:}"

  user="${!user_var:-${schema}_svc}"
  pass="${!pass_var:-}"

  validar_identificador "$schema" "esquema"
  validar_identificador "$user" "usuario ($user_var)"
  validar_contrasena "$pass" "$pass_var"

  # DROP USER antes de CREATE, y no CREATE USER IF NOT EXISTS.
  #
  # Un usuario preexistente conserva TODOS sus privilegios, incluidos los que
  # tuviera sobre otros esquemas. Y REVOKE ALL PRIVILEGES ON *.* no los quita:
  # en MySQL los privilegios viven por nivel, y esa sentencia solo toca el nivel
  # global; un GRANT sobre pa_auth.* concedido antes sobrevive intacto. Tampoco
  # alcanza a GRANT OPTION, que ALL PRIVILEGES excluye explicitamente.
  #
  # Recrear la cuenta es la unica forma de partir de cero con certeza.
  mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${schema}\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

DROP USER IF EXISTS '${user}'@'%';
CREATE USER '${user}'@'%' IDENTIFIED BY '${pass}';

-- Privilegio minimo: datos y migraciones sobre SU esquema y nada mas.
-- La cuenta recien creada solo tiene USAGE a nivel global, asi que este es
-- literalmente el unico privilegio que posee.
GRANT ${GRANTS} ON \`${schema}\`.* TO '${user}'@'%';
SQL

  echo "[init]   ${schema} <- ${user}"
done

mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "FLUSH PRIVILEGES;"

# --------------------------------------------------------------------------------------
# Excepcion documentada: admin-reporting-service lee cinco tablas de otros esquemas.
#
# RF108 prohibia que este servicio consultara otra base de datos. ADR-005 relaja esa
# regla para el calculo de estadisticas, porque las metricas que pide el SRS viven en
# request, catalog y rating, y ningun servicio publica eventos con ese contenido.
#
# El privilegio se concede a NIVEL DE TABLA, no de esquema, por dos razones:
#
#   1. `SCHEMA_PRIVILEGES` solo registra privilegios de nivel esquema. Concederlos a
#      nivel de tabla deja la verificacion de aislamiento de abajo exactamente igual de
#      estricta: un GRANT accidental sobre `pa_request.*` -que es el error grave- sigue
#      haciendo fallar el arranque.
#   2. La excepcion queda acotada a cinco tablas y no a tres esquemas. Si manana hace
#      falta una sexta tabla, hay que editar esta lista y el ADR, no abrir un esquema.
#
# Solo SELECT. Ni escritura, ni GRANT OPTION, ni privilegios globales.
REPORTING_READS=(
  "pa_request.necesidad"
  "pa_request.propuesta"
  "pa_catalog.prestador_ref"
  "pa_catalog.servicio"
  "pa_rating.calificacion"
)

echo "[init] concediendo lectura de reportes a pa_admin_svc (ADR-005)"
for tabla in "${REPORTING_READS[@]}"; do
  mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
GRANT SELECT ON \`${tabla%%.*}\`.\`${tabla##*.}\` TO '${DB_ADMIN_USER:-pa_admin_svc}'@'%';
SQL
  echo "[init]   SELECT ${tabla}"
done

# Comprobacion: ningun usuario de servicio debe tener privilegios fuera de su
# esquema. Si el bucle anterior se equivocara, esto lo detecta ahora y no en
# produccion.
echo "[init] verificando aislamiento entre esquemas"
for entry in "${SERVICES[@]}"; do
  schema="${entry%%:*}"
  rest="${entry#*:}"
  user_var="${rest%%:*}"
  user="${!user_var:-${schema}_svc}"

  fugas=$(mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES
     WHERE GRANTEE = \"'${user}'@'%'\" AND TABLE_SCHEMA <> '${schema}';")

  globales=$(mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES
     WHERE GRANTEE = \"'${user}'@'%'\" AND PRIVILEGE_TYPE <> 'USAGE';")

  if [ "$fugas" != "0" ] || [ "$globales" != "0" ]; then
    echo "[init] ERROR: ${user} tiene ${fugas} privilegio(s) en otros esquemas y ${globales} global(es)" >&2
    exit 1
  fi
done

# La excepcion de ADR-005 es a nivel de TABLA, y TABLE_PRIVILEGES es distinta de
# SCHEMA_PRIVILEGES: el bucle de arriba no la ve. Sin esta comprobacion la excepcion
# seria invisible para el gate, y un gate que no ve una excepcion deja de ser un gate.
#
# Se exige que los privilegios de tabla cruzados sean EXACTAMENTE la lista aprobada.
# Cualquier tabla de mas, cualquier privilegio distinto de SELECT, o cualquier tabla
# de la lista que sobre, hace fallar el arranque.
echo "[init] verificando excepcion de lectura de ADR-005"

# GROUP_CONCAT ordena por TABLE_SCHEMA, TABLE_NAME; la lista esperada se ordena con
# `sort` para que las dos cadenas coincidan sin depender del shell.
esperado=$(printf '%s\n' "${REPORTING_READS[@]}" | sort -u | tr '\n' ',' | sed 's/,$//')

no_select=$(mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
   WHERE GRANTEE = \"'${DB_ADMIN_USER:-pa_admin_svc}'@'%'\"
     AND TABLE_SCHEMA <> 'pa_admin'
     AND PRIVILEGE_TYPE <> 'SELECT';")

concedidas=$(mysql "${CONEXION[@]}" -uroot -p"${MYSQL_ROOT_PASSWORD}" -N -B -e \
  "SELECT GROUP_CONCAT(CONCAT(TABLE_SCHEMA, '.', TABLE_NAME) ORDER BY TABLE_SCHEMA, TABLE_NAME)
   FROM information_schema.TABLE_PRIVILEGES
   WHERE GRANTEE = \"'${DB_ADMIN_USER:-pa_admin_svc}'@'%'\"
     AND TABLE_SCHEMA <> 'pa_admin';")

if [ "$no_select" != "0" ]; then
  echo "[init] ERROR: pa_admin_svc tiene ${no_select} privilegio(s) de tabla Cruzados que no son SELECT" >&2
  exit 1
fi

if [ "$concedidas" != "$esperado" ]; then
  echo "[init] ERROR: los privilegios cruzados de pa_admin_svc no son los de ADR-005" >&2
  echo "[init]   esperado: ${esperado}" >&2
  echo "[init]   real:     ${concedidas}" >&2
  exit 1
fi

echo "[init] listo: 7 esquemas, 7 usuarios, aislamiento verificado, excepcion ADR-005 verificada"
