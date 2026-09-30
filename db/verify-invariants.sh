#!/bin/bash
# Pruebas negativas contra la base de datos real.
#
# Cada caso INTENTA violar un invariante del modelo de dominio. La prueba pasa
# cuando MySQL lo RECHAZA: si la escritura se acepta, el invariante existe solo
# en la documentacion y no en el sistema.
#
# Uso:  bash db/verify-invariants.sh
# Requiere el entorno levantado (docker compose up -d) y las migraciones aplicadas.

set -uo pipefail

PASS=0
FAIL=0

mysql_root() {
  docker exec -i pa-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" "$@" 2>&1 | grep -v "Using a password"
}

# Espera que la sentencia FALLE. Si tiene exito, el invariante no se cumple.
debe_fallar() {
  local descripcion="$1" sql="$2"
  local salida
  salida=$(mysql_root -e "$sql" 2>&1)
  # Una sentencia que no toca ninguna fila no demuestra nada: pasaria por
  # "rechazada" cuando en realidad no se intento la escritura. Se marca como
  # prueba invalida, no como aprobada.
  if echo "$salida" | grep -qiE "Rows matched: 0"; then
    echo "  INVALID $descripcion  <-- la sentencia no afecto ninguna fila"
    FAIL=$((FAIL + 1))
    return
  fi
  if echo "$salida" | grep -qiE "ERROR|violated|Duplicate|denied|cannot|inmutable"; then
    echo "  OK      $descripcion"
    PASS=$((PASS + 1))
  else
    echo "  FALLO   $descripcion  <-- la base ACEPTO la escritura"
    echo "          $salida" | head -2
    FAIL=$((FAIL + 1))
  fi
}

debe_pasar() {
  local descripcion="$1" sql="$2"
  local salida
  salida=$(mysql_root -e "$sql" 2>&1)
  if echo "$salida" | grep -qiE "^ERROR"; then
    echo "  FALLO   $descripcion  <-- deberia haber funcionado"
    echo "          $salida" | head -2
    FAIL=$((FAIL + 1))
  else
    echo "  OK      $descripcion"
    PASS=$((PASS + 1))
  fi
}

echo "Preparando datos minimos"
mysql_root -e "
USE pa_request;
SET FOREIGN_KEY_CHECKS=1;
DELETE FROM solicitud_servicio; DELETE FROM propuesta; DELETE FROM necesidad;
DELETE FROM servicio_ref; DELETE FROM categoria_ref; DELETE FROM prestador_ref; DELETE FROM usuario_ref;
INSERT INTO usuario_ref (id_usuario,nombre,correo,estado) VALUES
  (1,'Marta Solicitante','marta@test.local','ACTIVO'),
  (2,'Pedro Oferente','pedro@test.local','ACTIVO'),
  (3,'Lucia Oferente','lucia@test.local','ACTIVO');
INSERT INTO prestador_ref (id_prestador,id_usuario,nombre,especialidad,estado) VALUES
  (10,2,'Pedro Oferente','Plomeria','ACTIVE'),
  (11,3,'Lucia Oferente','Electricidad','ACTIVE');
INSERT INTO categoria_ref (id_categoria,nombre_categoria,activa) VALUES (100,'Plomeria',1);
INSERT INTO servicio_ref (id_servicio,id_prestador,id_categoria,nombre_servicio,estado)
  VALUES (500,10,100,'Reparacion de fugas','ACTIVE');
INSERT INTO necesidad (id_necesidad,titulo,descripcion,id_usuario,id_categoria,estado,fecha_vigencia)
  VALUES (1,'Fuga en cocina','Gotea bajo el lavaplatos',1,100,'ABIERTA',DATE_ADD(NOW(),INTERVAL 14 DAY));
INSERT INTO propuesta (id_propuesta,id_necesidad,id_prestador,precio,tiempo_estimado,mensaje,estado)
  VALUES (1,1,10,230000,3,'Puedo el jueves','ENVIADA'),
         (2,1,11,210000,2,'Disponible manana','ENVIADA');
" >/dev/null

echo
echo "Agregado Necesidad/Propuesta"
debe_fallar "una sola propuesta vigente por oferente y necesidad (RF139)" \
  "INSERT INTO pa_request.propuesta (id_necesidad,id_prestador,precio,tiempo_estimado,mensaje,estado)
   VALUES (1,10,999999,1,'segunda propuesta del mismo oferente','ENVIADA');"

debe_pasar "el oferente puede reproponer si retiro la anterior (RF144)" \
  "UPDATE pa_request.propuesta SET estado='RETIRADA' WHERE id_propuesta=2;
   INSERT INTO pa_request.propuesta (id_necesidad,id_prestador,precio,tiempo_estimado,mensaje,estado)
   VALUES (1,11,205000,2,'propuesta corregida','ENVIADA');"

debe_pasar "adjudicar una propuesta" \
  "UPDATE pa_request.propuesta SET estado='ACEPTADA' WHERE id_propuesta=1;"

debe_fallar "como maximo una propuesta adjudicada por necesidad (NEED-AGGR-INV-008)" \
  "UPDATE pa_request.propuesta SET estado='ACEPTADA' WHERE id_necesidad=1 AND estado='ENVIADA';"

debe_fallar "precio de propuesta mayor que cero" \
  "INSERT INTO pa_request.propuesta (id_necesidad,id_prestador,precio,tiempo_estimado,mensaje,estado)
   VALUES (1,11,0,1,'gratis','RETIRADA');"

debe_fallar "estado de propuesta fuera del modelo" \
  "INSERT INTO pa_request.propuesta (id_necesidad,id_prestador,precio,tiempo_estimado,mensaje,estado)
   VALUES (1,11,100,1,'estado inventado','PENDIENTE_REVISION');"

debe_fallar "vigencia de la necesidad posterior a su publicacion" \
  "INSERT INTO pa_request.necesidad (titulo,descripcion,id_usuario,id_categoria,estado,fecha_publicacion,fecha_vigencia)
   VALUES ('x','y',1,100,'ABIERTA',NOW(),DATE_SUB(NOW(),INTERVAL 1 DAY));"

echo
echo "Solicitud de servicio"
debe_pasar "solicitud por adjudicacion, en estado ACEPTADA" \
  "INSERT INTO pa_request.solicitud_servicio
     (estado,origen,descripcion_problema,id_usuario,id_prestador,id_necesidad,id_propuesta,valor_acordado,plazo_acordado)
   VALUES ('ACEPTADA','ADJUDICACION','Gotea bajo el lavaplatos',1,10,1,1,230000,3);"

debe_fallar "una adjudicacion no puede nacer PENDIENTE (REQUEST-INV-004)" \
  "INSERT INTO pa_request.solicitud_servicio
     (estado,origen,descripcion_problema,id_usuario,id_prestador,id_necesidad,id_propuesta)
   VALUES ('PENDIENTE','ADJUDICACION','x',1,10,1,3);"

debe_fallar "una propuesta produce como mucho una contratacion" \
  "INSERT INTO pa_request.solicitud_servicio
     (estado,origen,descripcion_problema,id_usuario,id_prestador,id_necesidad,id_propuesta)
   VALUES ('ACEPTADA','ADJUDICACION','duplicada',1,10,1,1);"

debe_fallar "origen DIRECTA exige servicio y prohibe necesidad (REQUEST-INV-003)" \
  "INSERT INTO pa_request.solicitud_servicio
     (estado,origen,descripcion_problema,id_usuario,id_prestador,id_necesidad,id_propuesta)
   VALUES ('PENDIENTE','DIRECTA','sin servicio',1,10,1,3);"

debe_pasar "solicitud directa sobre un servicio publicado" \
  "INSERT INTO pa_request.solicitud_servicio
     (estado,origen,descripcion_problema,id_usuario,id_prestador,id_servicio)
   VALUES ('PENDIENTE','DIRECTA','Se tapo el desague',1,10,500);"

echo
echo "Auditoria inmutable (RF103)"
mysql_root -e "INSERT INTO pa_admin.audit_record (ocurrido_at,accion,recurso_tipo,recurso_id,resultado)
  VALUES (NOW(),'NeedPublished','NECESIDAD','1','EXITO');" >/dev/null

debe_fallar "la auditoria no admite UPDATE" \
  "UPDATE pa_admin.audit_record SET accion='alterado' WHERE id_auditoria=1;"

debe_fallar "la auditoria no admite DELETE" \
  "DELETE FROM pa_admin.audit_record WHERE id_auditoria=1;"

echo
echo "Calificaciones"
mysql_root -e "
USE pa_rating;
DELETE FROM calificacion; DELETE FROM solicitud_ref; DELETE FROM usuario_ref;
INSERT INTO usuario_ref (id_usuario,nombre,estado) VALUES (1,'Marta','ACTIVO'),(2,'Pedro','ACTIVO');
INSERT INTO solicitud_ref (id_solicitud,id_usuario,id_prestador,id_usuario_prestador,estado,completada_at)
  VALUES (1,1,10,2,'COMPLETADA',NOW());
INSERT INTO calificacion (id_solicitud,direccion,id_emisor,id_receptor,puntuacion)
  VALUES (1,'SOLICITANTE_A_OFERENTE',1,2,5);" >/dev/null

debe_fallar "puntuacion fuera del rango 1-5" \
  "INSERT INTO pa_rating.calificacion (id_solicitud,direccion,id_emisor,id_receptor,puntuacion)
   VALUES (1,'OFERENTE_A_SOLICITANTE',2,1,9);"

debe_fallar "nadie se califica a si mismo" \
  "INSERT INTO pa_rating.calificacion (id_solicitud,direccion,id_emisor,id_receptor,puntuacion)
   VALUES (1,'OFERENTE_A_SOLICITANTE',2,2,5);"

debe_fallar "una calificacion por parte y solicitud (RF82)" \
  "INSERT INTO pa_rating.calificacion (id_solicitud,direccion,id_emisor,id_receptor,puntuacion)
   VALUES (1,'SOLICITANTE_A_OFERENTE',1,2,3);"

debe_pasar "la contraparte si puede calificar (RF164)" \
  "INSERT INTO pa_rating.calificacion (id_solicitud,direccion,id_emisor,id_receptor,puntuacion)
   VALUES (1,'OFERENTE_A_SOLICITANTE',2,1,4);"

echo
echo "Aislamiento entre esquemas (RNF28)"
for par in "pa_auth_svc:DB_AUTH_PASSWORD:pa_request" "pa_request_svc:DB_REQUEST_PASSWORD:pa_auth" "pa_catalog_svc:DB_CATALOG_PASSWORD:pa_admin"; do
  usuario="${par%%:*}"; resto="${par#*:}"; var="${resto%%:*}"; ajeno="${resto##*:}"
  salida=$(docker exec -i pa-mysql mysql -u"$usuario" -p"${!var}" -e "SELECT COUNT(*) FROM ${ajeno}.usuario_ref;" 2>&1 | grep -v "Using a password")
  if echo "$salida" | grep -qiE "ERROR|denied|Unknown database"; then
    echo "  OK      $usuario no alcanza $ajeno"
    PASS=$((PASS + 1))
  else
    echo "  FALLO   $usuario SI pudo leer $ajeno"
    FAIL=$((FAIL + 1))
  fi
done

echo
echo "─────────────────────────────────────────"
echo "  pasaron: $PASS    fallaron: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
