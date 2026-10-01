# Presentación de RutaViva Community Sevilla

## Explicación en una frase

RutaViva es una aplicación web que combina una red peatonal abierta con conocimiento vecinal moderado para proponer rutas directas y alternativas con menos barreras conocidas, explicando siempre por qué recomienda cada recorrido.

## El problema que resuelve

Los mapas generalistas conocen calles, pero no siempre reflejan un cierre reciente, un pasaje útil, una barrera, un tramo con iluminación deficiente o una dificultad de accesibilidad. Esa información existe en el barrio, pero suele quedar dispersa en conversaciones y redes sociales. RutaViva la convierte en datos estructurados, revisados, vigentes y útiles para planificar recorridos.

## Cómo funciona, explicado de forma sencilla

1. Cualquier persona puede consultar el mapa y calcular una ruta sin crear una cuenta.
2. El usuario elige un origen A y un destino B. RutaViva calcula la opción de menor distancia y, si es diferente, otra que evita barreras e incidencias conocidas.
3. El resultado muestra metros, tiempo estimado, puntuación, cobertura de accesibilidad, factores principales, avisos y un recorrido textual.
4. Una persona registrada puede aportar un atajo, camino accesible, barrera, cierre o problema de iluminación.
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
6. Crea una aportación de demostración sin publicarla todavía. Señala cómo se guarda con reintento seguro y pasa a moderación.
7. Con otra cuenta, toma el caso y explica la prohibición de auto-revisión.
8. Termina en “Cómo usar” y “Metodología” para demostrar accesibilidad y transparencia.

## Guion de 60 segundos

“Las calles cambian más rápido que muchos mapas. RutaViva Community Sevilla convierte lo que sabe el barrio en rutas peatonales explicables. Cualquier persona elige origen y destino y compara la ruta directa con una alternativa que reduce barreras conocidas. La aplicación muestra distancia, tiempo, cobertura de accesibilidad y el motivo de cada recomendación. La comunidad puede proponer atajos, cierres o problemas de iluminación, pero nada influye en una ruta hasta superar una moderación independiente. Las incidencias caducan, las discrepancias se tienen en cuenta y las métricas protegen a grupos pequeños. Es una plataforma web accesible, con datos abiertos de OpenStreetMap, backend PostgreSQL/PostGIS y una arquitectura preparada para ampliar el piloto por barrios o ciudades.”

## Qué demuestra técnicamente

- API REST con contratos documentados y errores seguros.
- PostgreSQL/PostGIS con migraciones incrementales, funciones de privilegio mínimo y publicación transaccional de red.
- Cálculo de rutas determinista con cola de prioridad, perfil directo y perfil accesible.
- Autenticación mediante enlaces mágicos, sesiones revocables, CSRF e idempotencia.
- Moderación independiente, historial inmutable, reacciones y caducidad de incidencias.
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

**¿Cómo se evita información falsa?** No se publica automáticamente: hay moderación independiente, historial, confirmaciones, rechazo comunitario, caducidad y trazabilidad.

**¿Guarda los recorridos consultados?** No. El cálculo recibe origen y destino para responder y no persiste la búsqueda por defecto.

**¿Qué ocurre si hay pocos usuarios?** La aplicación lo declara de forma honesta y oculta métricas de grupos de una a cuatro personas.

**¿Qué haría falta para contratarla?** Definir alcance geográfico, responsables de moderación, requisitos legales, identidad visual, soporte, datos institucionales, niveles de servicio y presupuesto. Nada de eso se presume contratado en el piloto.

## Datos que todavía necesitamos del mundo real

Para validar el ciclo completo hacen falta observaciones reales dentro del piloto: un atajo, barrera, cierre, problema de iluminación o camino accesible, con ubicación y descripción no sensible. Deben aportarse únicamente cuando la persona responsable confirme que son hechos observados y seguros de comunicar; nunca se inventan para una demostración pública.
