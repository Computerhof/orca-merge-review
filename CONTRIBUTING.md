# Mitmachen

Danke fürs Mithelfen! Ein Pull Request, ein Thema.

## Einrichten

```sh
npm install                      # Dev-Tools (TypeScript, Node-Typen); setzt core.hooksPath=.githooks
orca plugin types .              # erzeugt .orca/types (nicht committen)
orca plugin dev watch . --check  # lädt das Plugin in Orca; Speichern lädt neu
```

Beobachtet mit Orca 1.4.271: Nach Code-Änderungen verlangt ein Entwicklungsordner mit `trusted-worker`
erneut eine Freigabe (`approval_required`), auch ohne neue Rechte. Prüfe die angezeigte Rechteliste und
starte dann neu mit `--approve <fingerprint>`.

## Vor jedem PR

```sh
npm run check                              # Typecheck (Kern + Plugin), Kern-Tests, Privacy-Guard
orca plugin test . && orca plugin check .  # Worker-/Panel-Tests und Render-Szenarien im Orca-Runtime
```

CI prüft Typecheck, Kern-Tests (Ubuntu und Windows), den Privacy-Guard, Secrets, CodeQL und neue Abhängigkeiten.
Das Orca-Runtime gibt es in CI nicht. `orca plugin test/check` laufen deshalb lokal und gehören in jeden PR.

## Aufbau und Regeln

- `src/core/` und `src/git/` kennen Orca nicht. Dort liegt alle Git-Logik, rein und getestet gegen echte Repositories (`test/*.spec.ts`).
- `src/worker/` ist die Orca-Seite: dünne Handler, Hooks, Events, Befehle.
- `src/protocol.ts` ist der Vertrag zwischen Panel, Tab und Worker. Eine Änderung dort ist ein Breaking Change (CHANGELOG, Major).
- Optionale Request-Felder nie als `undefined` senden (Orca lehnt sie ab): `defined()` aus `src/defined.ts`.
- Untrusted Inhalte (Dateien, Commits, Branch-Namen) im Review-Tab nur über `textContent`.
- Commit-Präfixe: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- Verhalten geändert → README, CHANGELOG und `docs/` im selben PR.

## Privates bleibt privat

Der Pre-commit-Hook (`scripts/check-private.mjs`) blockiert Secrets, persönliche Pfade und eine private
Commit-Identität. Eigene Marker (Namen, Firmen-Domains) kommen in `.private-patterns`; die Datei ist git-ignoriert,
eine Regex pro Zeile. `TASKS.md`, `.env*`, `.claude/` und `.orca/` gehören nie ins Repo.
