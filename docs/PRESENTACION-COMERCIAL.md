# Presentación de RutaViva Community Sevilla

## Propuesta principal actual

RutaViva convierte observaciones ciudadanas sobre barreras y deterioro peatonal en información estructurada, moderada y explicable. Una entidad puede visualizar problemas abiertos, priorizar comprobaciones y mostrar recorridos orientativos con menos barreras conocidas. El sistema no certifica accesibilidad ni sustituye una auditoría técnica.

Destinatarios potenciales: ayuntamientos, empresas de mantenimiento urbano, asociaciones vecinales y organizaciones de accesibilidad como ONCE. Esta enumeración no implica relación, aval ni colaboración actual.

## Explicación en una frase

RutaViva es una aplicación web que combina una red peatonal abierta con conocimiento vecinal moderado para proponer rutas directas y alternativas con menos barreras conocidas, explicando siempre por qué recomienda cada recorrido.

## El problema que resuelve

Los mapas generalistas conocen calles, pero no siempre reflejan un cierre reciente, un pasaje útil, una barrera, un tramo con iluminación deficiente o una dificultad de accesibilidad. Esa información existe en el barrio, pero suele quedar dispersa en conversaciones y redes sociales. RutaViva la convierte en datos estructurados, revisados, vigentes y útiles para planificar recorridos.

## Cómo funciona, explicado de forma sencilla

1. Cualquier persona puede consultar el mapa y calcular una ruta sin crear una cuenta.
2. El usuario elige un origen A y un destino B. RutaViva calcula la opción de menor distancia y, si es diferente, otra que reduce barreras e incidencias conocidas.
3. El resultado muestra metros, tiempo estimado, puntuación, cobertura de accesibilidad, factores principales, avisos y un recorrido textual.
4. Una persona registrada puede comunicar una barrera, deterioro, cierre, cruce, problema de orientación o iluminación, indicando evidencia y vigencia. Los atajos históricos siguen visibles como categoría secundaria.
5. La aportación no modifica rutas inmediatamente. Otra cuenta autorizada debe revisarla y publicar o rechazarla con un motivo.
6. Las personas pueden confirmar o rechazar información publicada. Las discrepancias suficientes impiden que esa aportación siga influyendo en el cálculo.
7. Los cierres y demás incidencias caducan según su tipo para reducir el riesgo de utilizar información antigua.

## Qué ve cada tipo de usuario

- Visitante: mapa, buscador, filtros, planificador A-B, actividad agregada, metodología y guía completa.
- Colaborador: todo lo anterior, más creación de aportaciones, historial y confirmaciones comunitarias.
- Moderador: cola de revisión, reclamación de casos y decisiones motivadas. No puede aprobar su propio contenido.
- Administrador: los privilegios de moderación autorizados para gestionar el piloto; no obtiene acceso público a secretos o credenciales.

## Demostración recomendada de 5 minutos

1. Abre la portada y resume el propósito con la frase inicial.
2. Enseña las métricas públicas y explica que los grupos con menos de cinco participantes se ocultan por privacidad.
3. En el mapa, selecciona A y B y calcula una ruta. Compara la directa con la alternativa accesible y lee un factor y un aviso.
4. Abre los filtros y muestra que mapa y lista ofrecen información equivalente.
5. Entra con un enlace mágico. No hay contraseña que recordar ni almacenar.
6. Usa el caso real previamente confirmado y créalo sin publicarlo todavía. Señala cómo se guarda con reintento seguro y pasa a moderación.
7. Con otra cuenta, toma el caso y explica la prohibición de que la misma cuenta revise su propia aportación.
8. Termina en “Cómo usar” y “Metodología” para demostrar accesibilidad y transparencia.

La primera demostración basada en un hecho de Sevilla debe seguir la [guía de validación del piloto real](VALIDACION-PILOTO-REAL.md). Esa guía separa técnicamente la cuenta autora de la moderadora, compara el mismo trayecto A/B antes y después y obliga a informar honestamente aunque la ruta no cambie. En el piloto inicial, Jesús opera ambas cuentas; la independencia humana solo podrá afirmarse después de una validación futura con dos personas distintas. El caso real todavía está pendiente y no debe presentarse como ejecutado ni como prueba de seguridad.

Si todavía no existe un caso real confirmado, no se crea contenido ficticio persistente en producción. Una demostración simulada solo puede hacerse en un entorno aislado de pruebas, con rollback o eliminación segura comprobada al terminar.

## Guion de 60 segundos

“Las calles cambian más rápido que muchos mapas. RutaViva Community Sevilla transforma observaciones sobre barreras y deterioro peatonal en información estructurada y revisada. Cualquier persona compara una ruta directa con otra que reduce barreras conocidas y entiende distancia, cobertura y avisos. La comunidad describe condiciones del entorno, a quién podrían afectar y si existe una medición; nada influye hasta superar moderación independiente. Publicada no significa certificada y ninguna observación ciudadana bloquea automáticamente un tramo. Es una plataforma web accesible, con OpenStreetMap, PostgreSQL/PostGIS y arquitectura preparada para ampliar el piloto.”

## Qué demuestra técnicamente

- API REST con contratos documentados y errores seguros.
- PostgreSQL/PostGIS con migraciones incrementales, funciones de privilegio mínimo y publicación transaccional de red.
- Cálculo de rutas determinista con cola de prioridad, perfil directo y perfil accesible.
- Autenticación mediante enlaces mágicos, sesiones revocables, CSRF e idempotencia.
- Separación técnica entre cuenta autora y cuenta moderadora, historial inmutable, reacciones y caducidad de incidencias.
- Rate limiting persistente con identificador de red derivado; no se conserva la IP en claro.
- Caché acotada, ETag, métricas con privacidad mínima de cinco participantes y estados degradados honestos.
- Interfaz responsive, navegación por teclado, foco visible, mensajes accesibles y alternativa textual al mapa y al gráfico.

## Propuesta de valor para entidades

RutaViva puede servir como piloto de participación ciudadana para ayuntamientos, asociaciones vecinales, universidades, organizaciones de accesibilidad o proyectos de movilidad. Su valor no está en prometer una navegación perfecta, sino en ofrecer un proceso auditable para recopilar, revisar, caducar y aplicar conocimiento local.

Una implantación profesional futura podría incluir identidad institucional, panel de indicadores por distrito, acuerdos de moderación, exportación de incidencias, integración con datos municipales y soporte con niveles de servicio. Estas posibilidades son una hoja de ruta, no funciones ya vendidas ni verificadas.

## Diferencias frente a un mapa convencional

| Mapa convencional | RutaViva |
| --- | --- |
| Red general de calles | Piloto peatonal enriquecido con conocimiento local |
| Resultado centrado en distancia o tiempo | Opción directa y alternativa con menos barreras conocidas |
| Poca explicación del porqué | Factores, cobertura, avisos y recorrido textual |
| Cambios comunitarios poco visibles | Ciclo de aportación, moderación, confirmación, disputa y caducidad |
| Métricas opacas | Metodología versionada y estadísticas con protección de grupos pequeños |

## Límites que deben decirse con claridad

- Las rutas son orientativas y no garantizan seguridad ni accesibilidad real.
- El piloto cubre una zona limitada de Sevilla y depende de la calidad y actualidad de los datos.
- OpenStreetMap se utiliza conforme a ODbL y requiere atribución.
- El plan gratuito de infraestructura no ofrece un acuerdo de disponibilidad; puede suspenderse por inactividad o alcanzar límites.
- Antes de una explotación comercial o despliegue general hacen falta revisión jurídica, política de privacidad, términos, canal de derechos, soporte operativo y un plan de continuidad.
- La propiedad del código propio corresponde a su titular, pero no convierte en propiedad privada los datos de OpenStreetMap ni otros componentes con licencia de terceros.

## Preguntas frecuentes de una empresa

**¿Ya es un producto terminado?** Es un piloto funcional con arquitectura real. Debe completarse la validación de campo, operación, soporte y revisión jurídica antes de presentarlo como servicio general.

**¿Puede ampliarse a otra ciudad?** La arquitectura está preparada para ciudades y zonas, pero cada despliegue necesita datos, límites, moderadores y validación local.

**¿Cómo se evita información falsa?** No se publica automáticamente: hay moderación con otra cuenta autorizada, historial, confirmaciones, rechazo comunitario, caducidad y trazabilidad. En el piloto inicial Jesús opera las dos cuentas; la independencia humana queda pendiente de una prueba futura con personas distintas.

**¿Guarda los recorridos consultados?** No. El cálculo recibe origen y destino para responder y no persiste la búsqueda por defecto.

**¿Qué ocurre si hay pocos usuarios?** La aplicación lo declara de forma honesta y oculta métricas de grupos de una a cuatro personas.

**¿Qué haría falta para contratarla?** Definir alcance geográfico, responsables de moderación, requisitos legales, identidad visual, soporte, datos institucionales, niveles de servicio y presupuesto. Nada de eso se presume contratado en el piloto.

## Datos que todavía necesitamos del mundo real

Para validar el ciclo completo hace falta una condición urbana real dentro del perímetro admitido, con ubicación, fecha, vigencia y descripción no sensible. Debe aportarse únicamente cuando la persona responsable confirme que es un hecho observado y seguro de comunicar; nunca se inventa para una demostración pública. Si queda fuera de la red vigente, valida el flujo comunitario pero no el cambio del cálculo A→B.

El procedimiento, los datos necesarios, los criterios de aceptación y la plantilla de evidencia están en [Validación del primer piloto real](VALIDACION-PILOTO-REAL.md). Se recomienda —pendiente de confirmación— usar la cuenta personal como autora y la laboral como moderadora. Ambas las opera Jesús en este piloto, por lo que se valida separación técnica de funciones y no independencia humana.
