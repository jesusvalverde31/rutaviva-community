# Checklist de release

- [ ] Rama creada desde `origin/main` y estado local limpio.
- [ ] Versión coherente en package, lockfile y OpenAPI.
- [ ] `npm run build`, `npm run check`, `npm test` y `git -c core.whitespace=cr-at-eol diff --check` en verde.
- [ ] Integración real con rollback solo si el cambio afecta a base o backend.
- [ ] PR completa, CI `verify` verde y conversaciones resueltas.
- [ ] SHA fusionado visible como `Live` en Render.
- [ ] Health, ready, bootstrap y portada superan el smoke público.
- [ ] Tag y GitHub Release creados después del smoke y sobre el mismo SHA.
- [ ] README, tareas y documentación central distinguen evidencia y pendientes.
