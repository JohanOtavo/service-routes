#!/usr/bin/env bash
#
# Respaldo y restauracion de los siete esquemas (AT-004).
#
#   ./db/respaldo.sh crear [esquema]       vuelca y registra el respaldo
#   ./db/respaldo.sh restaurar <archivo> <esquema_destino>
#   ./db/respaldo.sh probar [esquema]      crea, restaura en un esquema de
#                                          verificacion, compara y lo tira
#
# Por que existe: AT-004 es el unico elemento de severidad High del proyecto.
# La tabla `backup_record` de pa_admin lleva desde el primer dia una columna
# `restauracion_probada_at` que nadie escribia, porque no habia ni procedimiento
# ni script. Un respaldo que nunca se ha restaurado no es un respaldo: es un
# archivo del que se supone algo.
#
# El subcomando `probar` es el que de verdad cierra el elemento. Vuelca, lo
# restaura en un esquema APARTE y compara tabla por tabla contra el original.
# Restaurar sobre el esquema de produccion para "comprobar" seria destruir lo
# que se intenta proteger, asi que `restaurar` exige que le digan el destino y
# nunca lo deduce.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${MYSQL_ROOT_PASSWORD:?Falta MYSQL_ROOT_PASSWORD. Copia .env.example a .env.}"

CONTENEDOR="${PA_MYSQL_CONTAINER:-pa-mysql}"
DESTINO="${PA_BACKUP_DIR:-./dumps}"
ESQUEMAS=(pa_auth pa_provider pa_catalog pa_request pa_rating pa_notification pa_admin)

# `mysql` y `mysqldump` corren DENTRO del contenedor: asi el procedimiento no
# depende de que quien lo ejecute tenga instalado un cliente de la version
# correcta, que es una de las formas tipicas de que un respaldo no se pueda
# restaurar cuando hace falta.
# `-i` SOLO donde se canaliza algo por stdin: el volcado y la restauracion.
#
# Ponerlo tambien en las consultas tenia un efecto que no se ve hasta que se
# busca: `docker exec -i` lee stdin, y dentro de un `while read` se come las
# lineas que le quedaban al bucle. La huella de tablas salia con una sola fila,
# las dos huellas salian igual de truncadas, y la comparacion de `probar` daba
# por verificada una restauracion que no habia comprobado nada. Un falso
# positivo justo en la herramienta que existe para no tener falsos positivos.
en_contenedor() { docker exec -i "$CONTENEDOR" "$@"; }

# MYSQL_PWD y no `-p`: la contrasena en la linea de comandos aparece en la lista
# de procesos del contenedor, y el cliente avisa de ello en cada invocacion.
sql() {
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTENEDOR" \
    mysql -uroot --skip-column-names -s -e "$1"
}

existe_esquema() {
  [ "$(sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$1';")" = "1" ]
}

# Numero de filas por tabla, ordenado. Es la huella con la que se compara un
# esquema restaurado contra el original.
#
# `backup_record` se excluye, y no por comodidad: `crear` inserta en ella la
# fila del propio respaldo DESPUES de volcar, asi que el esquema original gana
# una fila que el volcado no puede contener. Comparandola, `probar pa_admin`
# fallaba siempre con una diferencia de exactamente 1. La tabla que registra el
# respaldo no puede formar parte de la verificacion de ese respaldo.
#
# Nota de uso: esto compara contra el esquema VIVO. Si algo escribe entre el
# volcado y la comparacion, sale una diferencia que no es un fallo de la
# restauracion. `probar` se ejecuta con los servicios parados.
huella() {
  local esquema="$1"
  sql "SELECT table_name FROM information_schema.tables
       WHERE table_schema='$esquema' AND table_type='BASE TABLE'
         AND table_name <> 'backup_record' ORDER BY table_name;" |
    while read -r tabla; do
      [ -z "$tabla" ] && continue
      printf '%s %s\n' "$tabla" "$(sql "SELECT COUNT(*) FROM \`$esquema\`.\`$tabla\`;")"
    done
}

# Deja registrado el respaldo en pa_admin. Sin esto el runbook seria una
# promesa: `backup_record` es donde se puede comprobar que se hizo y cuando.
registrar() {
  local esquema="$1" iniciado="$2" bytes="$3" ubicacion="$4" exitoso="$5" probada="$6"
  local probada_sql="NULL"
  [ -n "$probada" ] && probada_sql="'$probada'"

  sql "INSERT INTO pa_admin.backup_record
         (esquema, iniciado_at, finalizado_at, exitoso, tamano_bytes, ubicacion,
          restauracion_probada_at)
       VALUES ('$esquema', '$iniciado', UTC_TIMESTAMP(), $exitoso, $bytes,
               '$ubicacion', $probada_sql);"
}

crear() {
  local esquema="$1"
  local iniciado archivo
  iniciado="$(date -u '+%Y-%m-%d %H:%M:%S')"
  mkdir -p "$DESTINO"
  archivo="$DESTINO/${esquema}-$(date -u '+%Y%m%dT%H%M%SZ').sql.gz"

  # --single-transaction: volcado consistente sin bloquear escrituras.
  # --routines y --triggers: `audit_record` es inmutable GRACIAS a dos
  #   disparadores. Un volcado sin ellos restauraria una tabla de auditoria que
  #   se puede modificar, que es peor que no tener respaldo.
  if docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTENEDOR" \
      mysqldump -uroot --single-transaction --routines --triggers --events \
      --databases "$esquema" | gzip >"$archivo"; then
    local bytes
    bytes="$(wc -c <"$archivo" | tr -d ' ')"
    registrar "$esquema" "$iniciado" "$bytes" "$archivo" 1 ""
    echo "  $esquema: $archivo ($bytes bytes)"
    echo "$archivo"
  else
    registrar "$esquema" "$iniciado" "NULL" "$archivo" 0 ""
    echo "  $esquema: FALLO el volcado" >&2
    return 1
  fi
}

restaurar() {
  local archivo="$1" destino="$2"
  [ -f "$archivo" ] || { echo "No existe el archivo: $archivo" >&2; return 1; }

  # El volcado trae CREATE DATABASE del esquema ORIGINAL por --databases, asi
  # que restaurar en otro nombre exige reescribir esas dos sentencias. Se hace
  # con sed sobre el flujo y no editando el archivo: el respaldo no se toca.
  local origen
  origen="$(basename "$archivo" | sed 's/-[0-9TZ]*\.sql\.gz$//')"

  sql "DROP DATABASE IF EXISTS \`$destino\`; CREATE DATABASE \`$destino\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

  gunzip -c "$archivo" |
    sed "s/\`$origen\`/\`$destino\`/g" |
    docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTENEDOR" mysql -uroot "$destino"

  echo "  restaurado $origen -> $destino"
}

probar() {
  local esquema="$1"
  local verificacion="${esquema}_verificacion"
  local probada archivo

  echo "[respaldo] probando $esquema"
  archivo="$(crear "$esquema" | tail -1)"
  restaurar "$archivo" "$verificacion"

  local antes despues tablas
  antes="$(huella "$esquema")"
  despues="$(huella "$verificacion")"
  tablas="$(printf '%s' "$antes" | grep -c . || true)"

  # Una huella vacia comparada con otra huella vacia son iguales, y eso daria
  # por buena una restauracion sin haber mirado una sola tabla. Es el fallo que
  # tuvo la primera version de este script, asi que la condicion es explicita.
  if [ "$tablas" -lt 1 ]; then
    echo "  $esquema: no se pudo leer ninguna tabla; la prueba no es concluyente" >&2
    sql "DROP DATABASE IF EXISTS \`$verificacion\`;"
    return 1
  fi

  if [ "$antes" = "$despues" ]; then
    probada="$(date -u '+%Y-%m-%d %H:%M:%S')"
    sql "UPDATE pa_admin.backup_record SET restauracion_probada_at='$probada'
         WHERE ubicacion='$archivo';"
    echo "  $esquema: restauracion VERIFICADA ($tablas tablas comparadas)"
  else
    echo "  $esquema: la restauracion NO coincide con el original" >&2
    diff <(echo "$antes") <(echo "$despues") >&2 || true
    sql "DROP DATABASE IF EXISTS \`$verificacion\`;"
    return 1
  fi

  # El esquema de verificacion se tira siempre: dejarlo seria una copia de los
  # datos sin dueno, sin usuario propio y sin politica de conservacion.
  sql "DROP DATABASE IF EXISTS \`$verificacion\`;"
}

objetivos() {
  if [ -n "${1:-}" ]; then
    existe_esquema "$1" || { echo "Esquema desconocido o ausente: $1" >&2; exit 1; }
    echo "$1"
  else
    printf '%s\n' "${ESQUEMAS[@]}"
  fi
}

case "${1:-}" in
  crear)
    for e in $(objetivos "${2:-}"); do crear "$e" >/dev/null; done
    echo "[respaldo] crear completado"
    ;;
  restaurar)
    [ $# -eq 3 ] || { echo "Uso: $0 restaurar <archivo> <esquema_destino>" >&2; exit 1; }
    restaurar "$2" "$3"
    ;;
  probar)
    for e in $(objetivos "${2:-}"); do probar "$e"; done
    echo "[respaldo] probar completado"
    ;;
  *)
    echo "Uso: $0 <crear|restaurar|probar> [...]" >&2
    exit 1
    ;;
esac
