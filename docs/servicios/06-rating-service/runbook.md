# Runbook — rating-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Arranque y comprobacion

```bash
docker compose --profile apps up -d rating-service
docker exec pa-rating wget -qO- http://localhost:3005/health
```

`/health` responde `status: ok` cuando la base contesta. Lo consulta el
orquestador, y es una de las dos unicas rutas que NO exigen el secreto interno
—la otra es `/metrics`—, porque quien pregunta no lo conoce.

## Donde mirar cuando algo va mal

| Sintoma | Primer sitio |
|---|---|
| El contenedor no llega a sano | `docker logs pa-rating`. Una variable de entorno ausente o mal formada **impide el arranque** a proposito, y el mensaje dice cual es |
| Responde 403 a todo | falta `x-internal-secret`: la peticion no vino del gateway |
| Un cambio no aparece en otro servicio | [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) §7, en ese orden: outbox, intentos, cola, `.dlq`, `processed_event` |
| Latencia alta | el panel de Grafana, por ruta: [05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md) |
| Las replicas estan vacias | `npm run db:reemit rating`. Las semillas no escriben en el outbox |

## Registro y metricas

Una linea JSON por peticion servida, con `correlationId`, ruta, estado y
duracion. `/metrics` expone el histograma por ruta y el contador de 5xx. Ni el
registro ni las metricas copian cuerpos ni cabeceras: por ahi viajan contrasenas
y tokens.

```bash
docker logs pa-rating --tail 50
docker exec pa-rating wget -qO- http://localhost:3005/metrics | head
```

## Respaldo y restauracion

El esquema `pa_rating` entra en el respaldo general, cuya restauracion esta
probada sobre los siete esquemas:
[03-RUNBOOK-RESPALDOS.md](../../03-RUNBOOK-RESPALDOS.md).

```bash
bash db/respaldo.sh crear
bash db/respaldo.sh probar pa_rating
```
