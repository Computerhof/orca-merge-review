# Mitmachen

Danke fürs Mithelfen! Ein Pull Request, ein Thema.

## Einrichten

```sh
npm install                      # Dev-Tools (TypeScript, Node-Typen); setzt core.hooksPath=.githooks
orca plugin types .              # erzeugt .orca/types (nicht committen)
orca plugin dev watch . --check  # lädt das Plugin in Orca; Speichern lädt neu
```

Beobachtet mit Orca 1.4.271 bis 1.4.273: Nach jeder Änderung im Plugin-Ordner verlangt ein Entwicklungsordner
mit `trusted-worker` erneut eine Freigabe (Status `pending`), auch ohne neue Rechte. Das gilt auch für git-ignorierte
Dateien wie `TASKS.md` oder `scratch/`. Prüfe die angezeigte Rechteliste und gib dann mit dem Fingerabdruck frei,
den Orca ausgibt: `orca plugin enable local.merge-review --approve <fingerprint>`.

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

Die Historie ist öffentlich. Commits tragen deshalb nur eine GitHub-noreply-Adresse:

```sh
git config user.email "<id>+<login>@users.noreply.github.com"
```

Der Pre-commit-Hook (`scripts/check-private.mjs`) blockiert Secrets, persönliche Pfade und jede Commit-Adresse,
die keine noreply-Adresse ist. Eigene Marker (Namen, Firmen-Domains) kommen in `.private-patterns`; die Datei ist
git-ignoriert, eine Regex pro Zeile. `TASKS.md`, `.env*`, `.claude/` und `.orca/` gehören nie ins Repo.

Die CI wiederholt das für Commits, die ohne Hook entstanden sind (`--commits <base>..<head>`): Autor, Committer
und `Co-authored-by` müssen noreply sein (Personen, Bots wie `dependabot[bot]`, `noreply@github.com`,
`noreply@anthropic.com`), und Namen sowie Commit-Texte dürfen keine Secrets oder persönlichen Pfade enthalten.
