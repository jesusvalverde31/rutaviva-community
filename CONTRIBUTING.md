# Contribuir

1. Actualiza `main` mediante avance rápido y crea una rama corta.
2. Cambia solo lo necesario y usa datos sintéticos.
3. Ejecuta `npm run build`, `npm run check`, `npm test` y `git -c core.whitespace=cr-at-eol diff --check`. La última variante evita falsos positivos por los finales CRLF históricos sin ocultar espacios finales reales.
4. Abre una pull request y completa riesgo, recuperación e impacto.
5. Fusiona únicamente con CI verde y conversaciones resueltas.

No hagas push directo a `main`, no incluyas secretos ni datos personales y no ejecutes integración real sin autorización.

Este repositorio no acepta contribuciones externas de código por defecto. Antes de abrir una pull request, crea una propuesta y espera una invitación escrita junto con un acuerdo expreso sobre los derechos de la contribución. Una pull request no solicitada no concede al titular derechos sobre el código del tercero y puede cerrarse sin integrarse. La licencia propietaria de `LICENSE` permanece sin cambios.
