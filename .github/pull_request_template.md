## Was und warum

<!-- Ein Thema pro PR. -->

## Checkliste

- [ ] `npm run check` grün (Typecheck, Tests, Privacy-Guard)
- [ ] `orca plugin test . && orca plugin check .` grün
- [ ] Verhalten, Protokoll (`src/protocol.ts`), Einstellungen oder Rechte geändert → README / CHANGELOG / `docs/` im selben PR
- [ ] Neue Capability im Manifest → im PR begründet (Nutzer müssen sie neu freigeben)
- [ ] Keine Secrets, keine persönlichen Pfade, keine internen Namen
