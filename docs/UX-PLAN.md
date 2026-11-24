# UX-Plan: Merge & Review (v0.1)

> Stand: 2026-11-23 · Status: **umgesetzt in v0.1.0**; Entscheidungen E1–E3 am 2026-11-23 getroffen

## 1. Wofür (Jobs)

| # | Job | Typischer Orca-Fall |
|---|---|---|
| J1 | **Prüfen, was reinkommt**, bevor gemergt wird (nur lesen, gefahrlos) | Ein Agent hat in seinem Worktree gearbeitet: was hat er geändert? |
| J2 | **Mit Vorhersage mergen**: vorher wissen, ob es Konflikte gibt | Agent-Branch in `main` holen |
| J3 | **Den eigenen Branch aktualisieren** (Base in den Branch holen) | Agent-Worktree ist hinter `main` |
| J4 | **Konflikte geführt auflösen** | J2/J3 endet mit Konflikten |
| J5 | **Jederzeit sicher zurück** | Abbrechen, ohne etwas zu verlieren |

## 2. Grundsätze

1. **Der Zustand bestimmt die Ansicht.** Das Panel kennt drei Modi und zeigt immer nur einen:
   *Vergleichen* → *Konflikte lösen* → *Abschließen*. Es gibt keine Tabs, zwischen denen man suchen muss.
2. **Zuerst lesen, dann schreiben.** Eine Quelle zu wählen vergleicht sofort und ändert nichts. Nur ein einziger
   Knopf ändert das Repo, und der hat eine Bestätigung in zwei Schritten.
3. **Keine Git-Fachsprache, wo es Verwirrung stiftet.** Statt „ours/theirs“ heißt es „**Dein Stand (main)**“ und
   „**Eingehend (feature-x)**“, beide Male mit dem echten Branch-Namen.
4. **Gesperrt heißt erklärt.** Ein deaktivierter Knopf sagt immer, warum, und was zu tun ist
   (z. B. „3 nicht committete Änderungen: erst committen oder stashen“).
5. **Nie Arbeit verlieren.** Nicht committete Änderungen werden für einen Merge geparkt (git stash) und danach
   zurückgeholt; überschneiden sie sich mit dem Merge, bleiben sie geparkt, bis der Mensch entscheidet
   (E7, 2026-11-24). Abbrechen geht immer und ist immer bestätigt.
6. **Orca-Begriffe zuerst.** Als Quelle stehen Orca-**Workspaces** (Name + Branch + Agent-Status) oben,
   danach die übrigen Branches und Remotes.
7. **Jeder Kreis schließt sich (Vorbild Orca).** Kein Zustand endet in einer Sackgasse. Jeder Endpunkt bietet
   den nächsten sinnvollen Schritt an, und ein laufender Merge bleibt sichtbar, auch wenn man woanders
   arbeitet. Konkret: Abschnitt 3a.

## 3a. Kreise schließen: Einbindung in Orca-Workflows

Alle Kreise K1–K9 sind in v0.1.0 umgesetzt. Getestet sind sie mit `orca plugin test` gegen echtes Git
(Worker inkl. Hook). Im laufenden Orca geprüft: Panel, Vergleich, Review-Tab mit Diff. **Noch nicht im
laufenden Orca geprüft:** Status-Leiste, Befehle/Tastenkürzel, Meldungen, Agent-Zustellung, Merge-Wächter
(Cron-Format von `automation.create` unbestätigt).

| Kreis | Auslöser | Was das Plugin tut | Orca-Mittel |
|---|---|---|---|
| **K1 Review → Feedback → Agent** | Beim Durchsehen eines Agent-Workspace fällt etwas auf | „An Agent zurückgeben“ an einer Datei bzw. einem Diff: schickt Datei, Stelle und Anmerkung als Text an den Agenten *dieses* Workspace. Danach wartet das Panel, siehe K2 | `agents.list` (Terminal des Agenten), `terminal.sendText` |
| **K2 Agent fertig → neu prüfen** | Agent im Quell-Workspace wechselt auf `done` | Vergleich wird als veraltet markiert: „Agent fertig, neu vergleichen“ (ein Klick), dazu eine Meldung, wenn das Panel zu ist | Event `agent.status.changed`, `notifications.show` |
| **K3 Nicht mergen, während der Agent arbeitet** | Quelle hat einen Agenten im Zustand `working`/`blocked` | Hinweis vor dem Merge, die Bestätigung nennt es ausdrücklich | `workspace.list` mit `includeStatus` |
| **K4 Merge bleibt sichtbar** | Merge läuft mit Konflikten, man wechselt Workspace oder Tab | Status-Leiste: „⚠ Merge: 2 Konflikte offen“. Klick öffnet Panel bzw. nächsten Konflikt. Nach Abschluss verschwindet der Eintrag | `contributes.statusBarItems`, `statusBar.update` |
| **K5 Hand-Edit → Panel aktuell** | Konfliktdatei im normalen Orca-Editor bearbeitet und gespeichert | Panel und Tab prüfen die Datei neu und bieten „Als gelöst markieren“ an, sobald keine Marker mehr da sind | Hook `editor.save.before` (nur Beobachten, nie Ablehnen) |
| **K6 Konflikt an Agent geben** | Konflikte sind zu viele oder zu fachlich | „Agent löst Konflikte“: startet einen Agenten im Ziel-Workspace mit einem fertigen Auftrag (Dateien, Quelle, Regel: keine Marker übrig lassen, nichts committen). Das Panel verfolgt den Fortschritt, die Abnahme bleibt beim Menschen (Modus C) | `agent.launch`, danach K2 |
| **K7 Nach dem Merge** | Merge abgeschlossen | Erfolgskarte: „Rückgängig“ (E3), „Workspace der Quelle öffnen“, Hinweis, dass der Quell-Workspace jetzt entfernt werden kann | `workspace.open` |
| **K8 Von überall erreichbar** | Tastatur bzw. Palette | Befehle „Merge & Review: Vergleichen…“, „…: Nächster Konflikt“, „…: Merge abschließen“ | `contributes.commands`, `keybindings` |
| **K9 Workspace-Wechsel** | Fokus wechselt | Panel folgt dem fokussierten Workspace sofort, ohne Neuladen von Hand | Event `workspace.changed` |

**Grenzen (aus der Doku, nicht ausprobiert):**
- Ein Plugin kann keinen Workspace entfernen. Für K7 bleibt es beim Hinweis; Entfernen geht über Orcas
  eigenes Menü.
- `editor.save.before` läuft *vor* dem Speichern. Das Panel prüft die Datei deshalb erst kurz danach neu.
  Ob das Timing zuverlässig ist, muss der Spike zeigen.
- Mehr Bausteine heißen mehr Rechte beim Freigeben: `workspace:read`, `workspace:write`,
  `agent:read`, `agent:launch`, `terminal:send`, `notifications:show`, `storage:own`.
  Chris hat am 2026-11-23 entschieden: volle Orca-Anbindung in v0.1, alle Rechte.
- K1 erweitert: Läuft kein Agent im Quell-Workspace, wird seine letzte Session fortgesetzt (`history:read`,
  `agent.resume`). Erst wenn es keine gibt, startet ein neuer Agent.
- `editor.save.before` liefert den gespeicherten Text mit; das Panel prüft die Datei 400 ms später neu.

## 3. Modi und Bildschirme (Seitenleiste)

### Modus A: Vergleichen (kein Merge läuft)
```
┌ Merge & Review ─────────────── ⟳ ┐
│ main · ● sauber                   │  Kopf: Ziel-Branch + Zustand
│ Quelle  [▾ agent-login (Workspace)]│  Vorauswahl: Base-Ref bzw. letzter
│ ┌───────────────────────────────┐ │
│ │ 3 Commits · 12 Dateien +240 −31│ │  Zusammenfassung
│ │ ✓ Konfliktfrei vorhergesagt    │ │  oder ⚠ 2 Konflikte erwartet / ⇢ Fast-forward / = schon enthalten
│ └───────────────────────────────┘ │
│ ▸ Commits (3)                     │  aufklappbar
│ ▾ Dateien (12)                    │  Klick → Diff (siehe Entscheidung E1)
│   M src/auth.ts       +40 −3  ⚠   │  ⚠ = hier wird ein Konflikt erwartet
│ ───────────────────────────────── │
│ Art  (•) Merge-Commit ( ) FF ( ) Squash
│ [ agent-login → main mergen ]     │  Schritt 1 → Schritt 2 „Wirklich? 3 Commits, 12 Dateien“
└───────────────────────────────────┘
```

### Modus B: Konflikte lösen (Merge läuft, ungelöste Dateien)
```
│ ⚠ Merge agent-login → main läuft  │
│ ▓▓▓▓░░░░ 2 von 5 Dateien gelöst    │
│ ● src/auth.ts      2 Konflikte    │  offen
│ ◐ src/api.ts       bereit         │  keine Marker mehr → „Als gelöst markieren“
│ ✓ README.md        gelöst         │
│ ── src/auth.ts · Konflikt 1 von 2 ‹ › ──
│ Dein Stand (main)        [code]   │
│ Eingehend (agent-login)  [code]   │
│ ▸ Gemeinsame Basis (falls diff3)  │
│ [Meins] [Eingehend] [Beide] [✎ Im Editor]
│ ⋯ Ganze Datei: Meins / Eingehend  │
│ [Merge abbrechen]  (gefährlich, bestätigt)
```
Nach dem letzten Block einer Datei springt das Panel zur nächsten offenen Datei. „Als gelöst markieren“
erscheint als nächster Schritt.

### Modus C: Abschließen (alles gelöst)
```
│ ✓ Alle 5 Dateien gelöst            │
│ Nachricht [Merge branch 'agent-login'] │
│ [ Merge abschließen ]   [Abbrechen] │
```
Danach eine Erfolgsmeldung („3 Commits übernommen“) und zurück zu Modus A.

## 4. Entscheidungen (2026-11-23)

- **E1 → breiter Editor-Tab.** Die Seitenleiste dient nur zur Navigation (Modus A/B/C wie oben, ohne Code-Blöcke).
  Diff (side-by-side) und Konflikte (Dein Stand | Eingehend, Basis aufklappbar) erscheinen in einem
  eigenen Editor-Tab. Technik: ein Custom Editor für `*.mergereview`. Der Worker schreibt eine kleine
  Hilfsdatei (nur ein Verweis wie `{ "view": "diff", "source": "…", "path": "…" }`) und öffnet sie mit
  `editor.open`. Der Tab lädt die Inhalte über `plugin.request` vom Worker.
  **Unbestätigt:** ob `editor.open` eine Datei unter `.git/` öffnet. Ausweichweg: Ordner `.merge-review/`
  im Workspace, eingetragen in `.git/info/exclude`. Ein Spike klärt das als Erstes.
- **E2 → nur in den aktuellen Workspace.** Gemergt wird immer *Quelle → Branch des geöffneten Workspace*.
  Die Quelle ist vorausgewählt: im Feature-Workspace die Base-Ref (Branch aktualisieren), sonst der
  zuletzt gewählte Workspace.
- **E3 → „Merge rückgängig“ in v0.1.** Nur direkt nach einem Merge aus diesem Panel sichtbar und nur bei
  sauberem Arbeitsbaum. Bestätigung in zwei Schritten, die zeigt, was verworfen wird
  („3 Commits, HEAD zurück auf abc1234“). Technik: `git reset --merge ORIG_HEAD`, nachdem geprüft
  wurde, dass HEAD noch der eben erzeugte Commit ist.

## 5. Nicht in v0.1
Rebase, Cherry-Pick, Stash-Verwaltung, Push/PR, SSH-/Remote-Hosts (Git läuft lokal).

## 6. v0.2: Entscheidungen und Kreise (2026-11-24)

Chris hat alle vorgeschlagenen Features gewählt, dazu drei Richtungsentscheidungen:
**E4** Probe-Merge in einem versteckten Temp-Worktree, den das Plugin selbst anlegt und wieder entfernt
(kein Orca-Workspace, denn die Plugin-API kann Workspaces nicht entfernen). **E5** Tests laufen im Worker
(Exit-Code sicher), ein Knopf zeigt sie zusätzlich in einem Orca-Terminal. **E8 (2026-11-24, ersetzt die globale Einstellung):** Der Testbefehl gilt pro Orca-Projekt und wird im Panel
festgelegt; das Plugin schlägt einen vor, übernimmt ihn aber nur auf Klick. **E6** Markerfrei gespeicherte
Konfliktdateien werden automatisch als gelöst markiert, mit Hinweis; abschaltbar.

| Kreis | Auslöser | Was das Plugin tut | Orca-Mittel |
|---|---|---|---|
| **K10 Was ist bereit?** | Panel auf dem Base-Workspace (z. B. `main`) | Liste „Bereit zum Mergen“: alle Workspaces des Projekts mit Agent-Status, Commits vor/hinter der Base und Vorhersage (konfliktfrei / N Konflikte / schon enthalten). Klick wählt die Quelle und vergleicht | `workspace.list` mit Status, `merge-tree` je Workspace |
| **K11 Merge → Tests** | Merge, Fast-forward, Squash oder Abschluss erfolgreich, Testbefehl gesetzt | Status-Leiste „Tests laufen …“, danach grün/rot. Rot: Karte mit den letzten Zeilen und „Agent repariert“, „Rückgängig“, „Im Terminal ansehen“ | Worker-Prozess, `terminal.create`, `agent.launch`, `statusBar.update` |
| **K12 Erst proben** | „Probe-Merge“ vor dem echten Merge | Temp-Worktree vom aktuellen Stand, dort mergen (und testen), Ergebnis als Karte; der Arbeitsbaum bleibt unberührt. Danach „Jetzt echt mergen“ | `git worktree add/remove` im Temp-Ordner |
| **K13 Speichern = gelöst** | Konfliktdatei im Orca-Editor ohne Marker gespeichert | Datei wird als gelöst markiert (`git add`), Panel zeigt einen Hinweis, Status-Leiste zählt herunter | Hook `editor.save.before` |
| **K14 Merge-Hinweis an Agenten** | Prompt an einen Agenten in einem Workspace mit laufendem Merge | Orca stellt dem Prompt einen kurzen Hinweis voran: Merge läuft, nicht abbrechen, nicht committen. Ergänzt den Agenten-Schutz | Hook `agent.prompt.before`, `terminal.list` |
| **K15 Zum Agenten** | Agent-Badge einer Quelle | „Zum Agenten“ fokussiert das Terminal des Agenten, sonst öffnet es den Workspace | `agents.list`, `terminal.focus`, `workspace.open` |

**Umsetzungsstand (v0.2.0, 2026-11-24):** K10–K15 und die kleineren Ergänzungen sind umgesetzt und mit
`orca plugin test` (Mock-Host, echtes Git) sowie Kern-Tests in CI abgedeckt. Live in Orca geprüft: Übersicht
(`overview.list`), Probe-Merge im Temp-Worktree inkl. Aufräumen, Hook `agent.prompt.before` ohne Merge.
**Noch nicht live geprüft:** Speichern = gelöst mit echtem Editor-Speichern, Merge-Hinweis an einen echten Agenten,
„Zum Agenten“, Tests nach einem echten Merge, Export-Dialog.

Kleinere Ergänzungen: Der Review-Tab übernimmt Schrift und Größe von Orcas Editor
(`editor.readTypography`). Notizen im Tab bleiben pro Datei erhalten und lassen sich mit Vergleich, Commits
und Dateien als Markdown speichern (`files.saveAs`), z. B. für einen PR-Text.
