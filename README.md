# Merge & Review für Orca

Branches und Agent-Workspaces **prüfen, bevor sie gemergt werden**, Konflikte **vorhersagen**, mergen,
Konflikte **Block für Block in einem breiten Tab auflösen** und Reviews oder Konflikte **an Agenten
übergeben**, alles in [Orca](https://github.com/stablyai/orca).

> *English:* An Orca plugin to review branches and agent workspaces before merging, predict conflicts
> with `git merge-tree`, merge, resolve conflicts block by block in a wide tab, and hand review notes
> or conflicts to Orca agents. The UI is German for now.

Version: siehe `orca-plugin.json` (wird unten im Panel und im Tab angezeigt) · Änderungen: [CHANGELOG.md](CHANGELOG.md)

## Was es kann

| Bereich | Funktion |
|---|---|
| **Vergleichen** | Quelle wählen: Orca-Workspaces desselben Projekts (mit Agent-Status), Branches, Remotes. Die Base ist vorausgewählt. Zeigt eingehende Commits, geänderte Dateien (+/−) und wie weit das Ziel voraus ist. |
| **Vorhersage** | `git merge-tree --write-tree` sagt Konflikte voraus, ohne Arbeitsbaum oder Refs anzufassen: konfliktfrei, Fast-forward, schon enthalten oder *N Konflikt-Dateien*. |
| **Review-Tab** | Breiter Editor-Tab: Dateiliste links, Side-by-Side-Diff rechts. Ein Klick auf eine Zeilennummer fügt sie in eine Anmerkung an den Agenten ein. |
| **Mergen** | Merge-Commit, Fast-forward, nur Fast-forward oder Squash. Bestätigung in zwei Schritten, die Commits, Dateien, erwartete Konflikte und einen noch arbeitenden Agenten nennt. Gesperrt (mit Begründung) bei schmutzigem Arbeitsbaum oder losgelöstem HEAD. |
| **Konflikte** | Pro Block *Dein Stand / Gemeinsame Basis / Eingehend*, mit diff3 als Standard. Übernehmen: Meins, Eingehend, Beide, Basis (Tasten 1/2/3, `n` = nächste Datei). Ganze Datei von einer Seite, im normalen Editor bearbeiten, als gelöst markieren, abschließen oder abbrechen. |
| **Rückgängig** | Direkt nach einem Merge aus dem Plugin, nur solange seitdem nichts passiert ist. |
| **Agenten** | *Zum Agenten*: fokussiert das Terminal des Agenten einer Quelle. *Anmerkung an Agent*: geht an den laufenden Agenten des Quell-Workspace; sonst wird seine letzte Session fortgesetzt, sonst ein neuer Agent gestartet. *Agent löst Konflikte*: startet einen Agenten mit fertigem Auftrag; er committet nicht, du schließt ab. |
| **Agenten-Schutz** | Während eines Merges blockiert ein Hook zerstörerische Git-Befehle von Agenten (`reset --hard`, `merge --abort`, `stash`, Branch-Wechsel, …), Force-Push immer. Prompts an Agenten in einem Workspace mit laufendem Merge bekommen einen kurzen Hinweis vorangestellt. Abschaltbar. Eine Leitplanke, keine Sicherheitsgrenze; zur bekannten Einschränkung mit Claude Code im Bypass-Modus siehe [SECURITY.md](SECURITY.md). |
| **Speichern = gelöst** | Speicherst du eine Konfliktdatei im Orca-Editor ohne Konfliktmarker, wird sie automatisch als gelöst markiert (abschaltbar). |
| **Export** | Der Review-Tab speichert Vergleich, Commits, Dateien und deine Notizen als Markdown, z. B. für einen PR-Text. |
| **Merge-Wächter** | Optionale Orca-Automation: ein Agent prüft nach Zeitplan, ob die Base noch sauber hereinpasst, und ändert dabei nichts. |
| **Überall sichtbar** | Status-Leiste „Merge: 2 Konflikte offen“ (Klick → nächster Konflikt). Befehle in der Palette. Meldung, wenn der Agent einer verglichenen Quelle fertig ist. Panel und Tab aktualisieren sich nach eigenen Aktionen, Git-Befehlen von Agenten, Speichern und Workspace-Wechsel. |

Befehle: `Merge & Review: Übersicht öffnen` (Strg/Cmd+Alt+M), `…: Nächsten Konflikt öffnen` (Strg/Cmd+Alt+J),
`…: Mit Base vergleichen`, `…: Merge abschließen`.

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
| Worker (`trusted-worker`) | Git lokal ausführen |
| `workspace:read` / `workspace:write` | Workspaces und Pfade finden, Review-Tab und Dateien öffnen |
| `agent:read` | Melden, wenn der Agent einer Quelle fertig ist |
| `agent:launch`, `terminal:send` | Anmerkungen an Agenten, Agent für Konflikte, Sessions fortsetzen |
| `history:read` | Die letzte Agent-Session eines Workspace finden (nur Titel/Metadaten) |
| `automation:read` / `automation:write` | Merge-Wächter anlegen, pausieren, entfernen |
| `notifications:show`, `storage:own`, `settings:own` | Meldungen, eigene Merkliste, Einstellungen |

Einstellungen (Orca → Settings → Plugins → Merge & Review): Standard-Merge-Art, diff3, Agent,
Agenten-Schutz (mit Prompt-Hinweis), Speichern = gelöst, Meldungen, Zeitplan des Merge-Wächters.

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
