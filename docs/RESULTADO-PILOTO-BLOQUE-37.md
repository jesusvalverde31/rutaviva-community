# Resultado del piloto del Bloque 37

## Estado

**EN CURSO.** La fuente, el caso candidato y la decisión de moderación esperada están definidos. El smoke público de solo lectura y la ruta A→B anterior se ejecutaron correctamente. La creación, el rechazo y la ruta posterior todavía no se han ejecutado y no deben darse por verificados.

## Fuente pública

El acta oficial de la Junta Municipal del Distrito Casco Antiguo de 6 de febrero de 2025 recoge que se comunicó un encharcamiento recurrente cuando llueve en el acerado a la altura del número 4 de la calle Herrera el Viejo. También recoge que se ordenó una inspección para valorar posibles soluciones.

Fuente: [Ayuntamiento de Sevilla — acta de 6 de febrero de 2025](https://www.sevilla.org/distritos/casco-antiguo/junta-consejo-convocatorias-actas/archivos-junta-municipal/2025/acta-6-de-febrero-2025.pdf).

La fuente acredita que el problema fue comunicado en esa fecha. **No acredita que continúe actualmente**, que exista una anchura insuficiente ni que una persona concreta haya observado el lugar en 2026.

## Ficha aprobada

```text
Familia: Barrera u obstáculo
Condición observable: Otro problema peatonal
Zona: Área piloto aproximada — Casco Antiguo

Ubicación pública exacta:
Acerado de la calle Herrera el Viejo, a la altura del nº 4,
entre las calles Monsalves y San Roque, 41001 Sevilla.

Geometría: punto

Título:
Encharcamiento comunicado junto al nº 4 de Herrera el Viejo

Descripción:
Fuente documental: acta de la Junta Municipal del Distrito Casco
Antiguo de 06/02/2025. Recoge un encharcamiento al llover en el
acerado, a la altura del nº 4, y que se ordenó una inspección para
valorar posibles soluciones. No existe una comprobación de campo
reciente; estado actual desconocido.

Fecha: 06/02/2025, fecha documental; no es una observación personal
Permanencia: no lo sé
Grupos afectados: peatones en general
Anchura: no medida; valor vacío
Ausencia de datos personales: confirmada

Ruta A:
Cruce de calle Herrera el Viejo con calle Monsalves

Ruta B:
Cruce de calle Herrera el Viejo con calle San Roque

Cuenta autora: laboral
Cuenta moderadora: personal
```

Jesús autorizó expresamente invertir las cuentas para completar el piloto. Las dos cuentas son operadas por Jesús. Esto permite comprobar la separación técnica de funciones, pero no constituye una moderación realizada por dos personas independientes.

## Decisión de moderación prevista

Con la evidencia disponible el caso **no debe publicarse**. Debe rechazarse con este motivo:

> El acta municipal acredita que la incidencia fue comunicada el 06/02/2025 y que se ordenó una inspección, pero no confirma que siga presente. Sin una comprobación reciente no debe publicarse ni penalizar rutas actuales.

El rechazo motivado es un resultado correcto del piloto: debe quedar auditado, el caso no debe aparecer al visitante y la ruta A→B debe permanecer sin cambios.

## Evidencia verificada hasta ahora

- Fecha de ejecución: 2026-10-05.
- Entorno: `https://rutaviva-community-sevilla-jv31.onrender.com/`.
- `npm run smoke:production`: **9/9 recursos correctos**.
- Comprobados por el smoke: `health`, `ready`, `bootstrap`, portada, manifest, service worker, página offline e iconos de 192 y 512 píxeles.
- La portada pública muestra cero aportaciones publicadas y cero pendientes antes del piloto.
- La aplicación exige iniciar sesión para enviar una aportación.
- La sesión integrada de la cuenta laboral está activa con los roles `collaborator` y `moderator`.

## Incidencia detectada antes del envío

La aportación no se ha enviado. En la prueba real se comprobó que `Empezar dibujo` sí activa el mapa, pero los controles `Añadir punto en el centro`, `Deshacer` y `Borrar` no ejecutan su acción.

La causa observada está en `public/app.js`: esos tres eventos conservan la referencia a las funciones vacías iniciales, anteriores a la importación asíncrona de `map.js`. El botón de inicio no sufre el problema porque usa una función envolvente que consulta la implementación actualizada al pulsarlo.

La prueba dejó un punto aproximado en `37.39185, -5.99873`. No se utilizará para enviar el caso: la ubicación no es suficientemente precisa y el control de borrado no responde. El piloto queda pausado antes de cualquier escritura hasta corregir y verificar estos controles.

## Ruta anterior verificada

```text
Fecha: 2026-10-05
Origen A: 37.39216, -5.99909
Destino B: 37.39178, -5.99967
Perfil: predeterminado de la interfaz pública
Distancia: 86 m
Tiempo estimado: 1 min
Puntuación: 79/100
Cobertura accesible conocida: 19 %
Alternativa accesible distinta: no disponible con los datos actuales
Red: osm-20260930135906-3f4223ab
Fecha de los datos OSM: 2026-09-30
Ajuste al mapa: A 13 m; B 17 m
```

El recorrido textual observado fue Calle Herrera el Viejo, seguida de Calle San Roque. Los factores mostrados fueron una barrera de accesibilidad en datos OSM, accesibilidad sin confirmar e iluminación sin confirmar. La interfaz recordó que la ruta es orientativa y que la cobertura de accesibilidad era inferior al 80 %.

## Evidencia pendiente

- Corrección y verificación de los controles de dibujo del mapa.
- Acceso con la cuenta autora laboral.
- Creación y envío de la aportación.
- Confirmación de que el estado pendiente no es público ni altera rutas.
- Acceso separado con la cuenta personal.
- Rechazo motivado y comprobación del historial.
- Ruta A→B posterior con los mismos puntos.
- Prueba de teclado, zoom y móvil dentro del recorrido real.

No se afirmará que ninguno de estos pasos está verificado hasta observarlo.

## Coste y límites

Coste observado: **0 €**. No se ha contratado ningún plan ni se han añadido dependencias. Este caso valida el control negativo de moderación si se completa; no valida todavía la publicación de una barrera vigente ni su influencia en el motor de rutas.

