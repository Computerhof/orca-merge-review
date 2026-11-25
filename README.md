# Merge & Review für Orca

Branches und Agent-Workspaces **prüfen, bevor sie gemergt werden**, Konflikte **vorhersagen**, mergen,
Konflikte **Block für Block in einem breiten Tab auflösen** und Reviews oder Konflikte **an Agenten
übergeben**, alles in [Orca](https://github.com/stablyai/orca).

> *English:* An Orca plugin to review branches and agent workspaces before merging, predict conflicts
> with `git merge-tree`, merge, resolve conflicts block by block in a wide tab, and hand review notes
> or conflicts to Orca agents. The UI follows Orca's language: German or English (everything else
> falls back to English). Command and setting names in Orca's palette and settings stay German, as Orca
> cannot translate a plugin manifest yet.

Version: siehe `orca-plugin.json` (wird unten im Panel und im Tab angezeigt) · Änderungen: [CHANGELOG.md](CHANGELOG.md)

## Was es kann

| Bereich | Funktion |
|---|---|
| **Vergleichen** | Quelle wählen: Orca-Workspaces desselben Projekts (mit Agent-Status), Branches, Remotes. Die Base ist vorausgewählt. Zeigt eingehende Commits, geänderte Dateien (+/−) und wie weit das Ziel voraus ist. |
| **Übersicht** | Auf dem Base-Workspace (z. B. `main`): alle Workspaces des Projekts mit Agent-Status, Commits vor/hinter und Vorhersage, bereite zuerst. Ein Doppelklick vergleicht. |
| **Vorhersage** | `git merge-tree --write-tree` sagt Konflikte voraus, ohne Arbeitsbaum oder Refs anzufassen: konfliktfrei, Fast-forward, schon enthalten oder *N Konflikt-Dateien*. |
| **Review-Tab** | Breiter Editor-Tab: Dateiliste links, Side-by-Side-Diff rechts. Ein Klick auf eine Zeilennummer fügt sie in eine Anmerkung an den Agenten ein. |
| **Mergen** | Merge-Commit, Fast-forward, nur Fast-forward oder Squash. Bestätigung in zwei Schritten, die Commits, Dateien, erwartete Konflikte und einen noch arbeitenden Agenten nennt. Nicht committete Änderungen werden dabei geparkt (git stash) und danach zurückgeholt; hat der Merge dieselben Dateien geändert, bleiben sie geparkt, bis du „Zurückholen“ wählst. Gesperrt (mit Begründung) bei losgelöstem HEAD. |
| **Rebase** | „Auf <Quelle> aktualisieren (Rebase)“ setzt den aktuellen Branch auf die Quelle (nicht interaktiv). Die Bestätigung nennt, wie viele Commits neu geschrieben werden, und warnt, wenn welche schon gepusht sind (danach wäre ein Force-Push nötig; das Plugin pusht nie). Nicht auf dem Basis-Branch. Konflikte Commit für Commit, dann „Weiter“, „Commit überspringen“ oder „Rebase abbrechen“. |
| **Cherry-Pick** | Eingehende Commits in der Liste auswählen und „N Commit(s) übernehmen (Cherry-Pick)“: in Historien-Reihenfolge, mit Herkunftsvermerk (`-x`). Konflikte wie beim Rebase. |
| **Konflikte** | Pro Block *Dein Stand / Gemeinsame Basis / Eingehend*, mit diff3 als Standard. Übernehmen: Meins, Eingehend, Beide, Basis (Tasten 1/2/3, `n` = nächste Datei). Ganze Datei von einer Seite, im normalen Editor bearbeiten, als gelöst markieren, abschließen oder abbrechen. |
| **Probe-Merge** | Merged die Quelle in einem versteckten Temp-Worktree (mit Tests, wenn ein Testbefehl gesetzt ist). Dein Arbeitsbaum bleibt unberührt, der Temp-Worktree wird danach entfernt. |
| **Tests nach dem Merge** | Testbefehl pro Orca-Projekt, im Panel unter „Tests für <Projekt>“ (mit Vorschlag aus package.json, Cargo.toml, go.mod, …). Läuft nach jedem Merge im Hintergrund; bei Rot zeigt das Panel die Ausgabe und bietet „Agent repariert“, „Im Terminal ansehen“ und Rückgängig an. |
| **Rückgängig** | Direkt nach einem Merge, Rebase oder Cherry-Pick aus dem Plugin, nur solange seitdem nichts passiert ist. |
| **Agenten** | *Zum Agenten*: fokussiert das Terminal des Agenten einer Quelle. *Anmerkung an Agent*: geht an den laufenden Agenten des Quell-Workspace; sonst wird seine letzte Session fortgesetzt, sonst ein neuer Agent gestartet. *Agent löst Konflikte*: startet einen Agenten mit fertigem Auftrag; er committet nicht, du schließt ab. |
| **Agenten-Schutz** | Während eines Merges, Rebase oder Cherry-Pick lehnt ein Hook zerstörerische Git-Befehle von Agenten ab (`reset --hard`, `merge`/`rebase`/`cherry-pick --abort`/`--continue`/`--skip`, `stash`, Branch-Wechsel, …), Force-Push immer. Prompts an Agenten in einem solchen Workspace bekommen einen kurzen Hinweis vorangestellt. Abschaltbar. Eine Leitplanke, keine Sicherheitsgrenze. **Unter Windows blockiert Orca derzeit nicht:** Orca gibt die Ablehnung dort nicht an Claude Code weiter (Orca-PR #37303, Feature-Wunsch stablyai/orca#49004); das Plugin protokolliert sie nur und zeigt im Panel einen Hinweis. Unter macOS und Linux blockiert Claude Code. Siehe [SECURITY.md](SECURITY.md). |
| **Speichern = gelöst** | Speicherst du eine Konfliktdatei im Orca-Editor ohne Konfliktmarker, wird sie automatisch als gelöst markiert (abschaltbar). |
| **Export** | Der Review-Tab speichert Vergleich, Commits, Dateien und deine Notizen als Markdown, z. B. für einen PR-Text. |
| **Merge-Wächter** | Optionale Orca-Automation: ein Agent prüft nach Zeitplan, ob die Base noch sauber hereinpasst, und ändert dabei nichts. |
| **Überall sichtbar** | Status-Leiste „Merge: 2 Konflikte offen“ (Klick → nächster Konflikt). Befehle in der Palette. Meldung, wenn der Agent einer verglichenen Quelle fertig ist. Panel und Tab aktualisieren sich nach eigenen Aktionen, Git-Befehlen von Agenten, Speichern und Workspace-Wechsel. |

Befehle: `Merge & Review: Übersicht öffnen` (Strg/Cmd+Alt+M), `…: Nächsten Konflikt öffnen` (Strg/Cmd+Alt+J),
`…: Mit Base vergleichen`, `…: Merge abschließen` (setzt einen Rebase oder Cherry-Pick fort).

Den Hintergrund zum Bedienkonzept beschreibt [docs/UX-PLAN.md](docs/UX-PLAN.md), den Aufbau [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Voraussetzungen

- Orca ≥ 1.4.259 (Desktop-App)
- Git ≥ 2.38 auf dem Orca-Rechner (für die Konfliktvorhersage; ältere Versionen funktionieren ohne Vorhersage)
- Lokale Workspaces. SSH- und Remote-Workspaces werden in v0.1 mit Hinweis abgelehnt.

## Installieren

```sh
orca plugin install https://github.com/Computerhof/orca-merge-review
```

Orca zeigt vor der Freigabe, welche Rechte das Plugin bekommt, und warum es sie braucht:

| Recht | Wofür |
|---|---|
| Worker (`trusted-worker`) | Git lokal ausführen; den eingestellten Testbefehl ausführen |
| `workspace:read` / `workspace:write` | Workspaces und Pfade finden, Review-Tab und Dateien öffnen |
| `agent:read` | Melden, wenn der Agent einer Quelle fertig ist |
| `agent:launch`, `terminal:send` | Anmerkungen an Agenten, Agent für Konflikte und rote Tests, Sessions fortsetzen; tippt auf Knopfdruck den eigenen Auftrag nach, wenn Orca ihn beim Start nicht abschickt |
| `history:read` | Die letzte Agent-Session eines Workspace finden (nur Titel/Metadaten) |
| `automation:read` / `automation:write` | Merge-Wächter anlegen, pausieren, entfernen |
| `notifications:show`, `storage:own`, `settings:own` | Meldungen, eigene Merkliste, Einstellungen |

Einstellungen (Orca → Settings → Plugins → Merge & Review): Standard-Merge-Art, diff3, Agent,
Agenten-Schutz (mit Prompt-Hinweis), Speichern = gelöst, Meldungen, Zeitplan des Merge-Wächters. Der Testbefehl
ist projektbezogen und steht deshalb im Panel, nicht in den Einstellungen.

### Wo die Hilfsdatei liegt

Ein Custom-Editor-Tab öffnet sich in Orca nur für eine Datei. Das Plugin schreibt deshalb einen kleinen Verweis
`review.mergereview` nach `.git/merge-review/`. In verlinkten Worktrees, in denen `.git` eine Datei ist, landet er
in `.merge-review/`, und das Plugin trägt `/.merge-review/` in die **lokale** Exclude-Datei des Repos ein
(`.git/info/exclude`, wird nie committet).

## Entwickeln

```sh
npm install                       # Dev-Tools; aktiviert die Git-Hooks (.githooks)
orca plugin dev watch . --check   # lädt den Ordner in Orca, zeigt Logs und Reloads
npm run check                     # Typecheck, Kern-Tests (echtes Git im Temp-Ordner), Privacy-Guard
orca plugin test . && orca plugin check .   # Worker- und Panel-Tests im Orca-Runtime
```

Beiträge: siehe [CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitsmeldungen: [SECURITY.md](SECURITY.md).

## Lizenz

[MIT](LICENSE)
