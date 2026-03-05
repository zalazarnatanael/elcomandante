# 🔒 Política de Seguridad para Agentes e Inteligencia Artificial - KOVE

## 1. Manejo de Secretos (.env)
- Los agentes tienen **prohibido** leer, modificar o crear archivos `.env` o `.env.*`.
- Los agentes **nunca** deben imprimir en consola (logs) o en archivos de documentación el contenido de variables de entorno.

## 2. Hardcoding de Llaves
- Está terminantemente prohibido escribir llaves de API o URLs de Supabase directamente en el código fuente (`.js`, `.jsx`, `.sql`, etc.).
- Todo secreto debe ser llamado mediante `process.env.VARIABLE_NAME` (o el equivalente en tu framework).

## 3. Revisión de Commits
- Antes de hacer commit, el agente debe verificar que no está subiendo secretos al repositorio.

## 🔒 Restricciones de Seguridad
- [ ] No hardcodear secretos.
- [ ] Usar `process.env` para variables de entorno.
- [ ] No exponer logs con datos sensibles.