# Moderación propuesta

## Criterios operativos de accesibilidad

Antes de publicar se comprueban: condición observable, ubicación coherente, fecha, permanencia, grupos potencialmente afectados, ausencia de datos personales y diferencia entre anchura estimada y medida. “Publicada” significa revisada por otra cuenta; no significa certificada ni conforme a normativa. En la variante conservadora actual, toda aportación comunitaria abierta puede advertir y penalizar, pero ninguna excluye automáticamente un paso. Al marcarla resuelta deja de afectar rutas y conserva auditoría. La auto-moderación continúa prohibida.

Una publicación resuelta puede reabrirse si una nueva comprobación muestra que la condición vuelve a estar presente. Resolver y reabrir exigen versión, motivo de 3 a 300 caracteres e `Idempotency-Key`; ambos cambios son append-only, idempotentes y siguen prohibidos para la cuenta autora. El texto del motivo se usa para validar la operación, pero la auditoría persistente conserva únicamente su huella SHA-256 y la acción.

## Roles

Visitante consulta; colaborador verificado aporta y señala; moderador revisa; administrador gobierna red y roles; sistema ejecuta caducidades y trabajos.

## Cuenta y privacidad

| Origen | Acción | Destino | Actor | Condición |
| --- | --- | --- | --- | --- |
| `pending_verification` | verificar | `active` | titular | token válido de un uso |
| `active` | suspender | `suspended` | administrador | motivo y duración |
| `suspended` | reactivar | `active` | administrador | revisión registrada |
| `active/suspended` | solicitar borrado | `deletion_requested` | titular | sesión reciente |
| `deletion_requested` | anonimizar | `anonymized` | sistema | solicitud confirmada |

Una cuenta suspendida conserva exportación, borrado y apelación. Exportación: `requested → preparing → available/failed → expired`. Borrado: `requested → confirmed → processing → anonymized/failed`. Toda transición genera auditoría; enlaces de descarga caducan y nunca son públicos.

## Aportaciones

| Origen | Acción | Destino | Actor | Error principal | Auditoría |
| --- | --- | --- | --- | --- | --- |
| `draft` | enviar | `pending` | autor verificado | `422` incompleta | sí |
| `pending` | tomar | `under_review` | moderador ajeno | `409/412` conflicto | sí |
| `under_review` | publicar | `published` | moderador ajeno | `403` conflicto de interés | sí |
| `under_review` | rechazar | `rejected` | moderador ajeno | motivo obligatorio | sí |
| `published` | cuestionar | `disputed` | sistema/moderador | caso insuficiente | sí |
| `published` | caducar/sustituir | `expired/superseded` | sistema/moderador | versión obsoleta | sí |
| `rejected` | apelar | `appealed` | autor | una apelación activa | sí |

Ningún `PATCH` genérico cambia estados. Una versión publicada nunca se sobrescribe. Confirmaciones y rechazos priorizan revisión, pero no publican contenido.

## Denuncias y apelaciones

Denuncia: `open → triaged → investigating → resolved/dismissed`. Apelación: `submitted → appeal_review → restored/rejection_confirmed`. Solo el autor afectado apela y solo existe una apelación activa por decisión. Cuando sea posible, la resuelve otra persona. Motivo público y notas internas quedan separados.

Un posible dato personal o peligro físico permite ocultación cautelar. Ocultar el texto no declara resuelta la condición del lugar.
