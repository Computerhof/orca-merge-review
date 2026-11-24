# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) · Versionierung: [SemVer](https://semver.org/lang/de/).
Die Version steht nur in `orca-plugin.json`; `src/version.ts` muss ihr entsprechen (Test erzwingt das).
Breaking Change = Major: Umbenennung eines Requests/Events in `src/protocol.ts`, einer Einstellung, eines Befehls
oder einer Capability-Erweiterung, die Nutzer neu freigeben müssen.

## [Unreleased]

## [0.1.1] - 2026-11-24

### Behoben
- **Agenten-Schutz griff während eines Merges nie:** Orca nennt Workspaces in Hooks mit seiner eigenen Kennung
  (`repoId::Pfad`), nicht mit der aus `workspace.list`. Das Plugin ordnet beide jetzt zu und prüft den
  Merge-Zustand direkt an Gits Markerdateien (`MERGE_HEAD`, `SQUASH_MSG`), auch in Workspaces, die das Plugin
  noch nie angesehen hat und in verlinkten Worktrees.
- Agenten-Schutz liest Befehle wie eine Shell: Text in Anführungszeichen (`git commit -m "… git rebase …"`) wird
  nicht mehr blockiert; `git -C . reset --hard`, `git.exe`, volle Pfade, `bash -c "…"`, `git push origin +main`,
  `git push -fu` und `git merge --quit` werden erkannt.
- Dateipfade gelten für Git wörtlich (`--literal-pathspecs`): „Als gelöst markieren“ für `src/[id].ts` fasst
  `src/i.ts` nicht mehr mit an.
- Dateien, die kein UTF-8 sind (z. B. Windows-1252), behalten beim Auflösen eines Blocks alle übrigen Bytes.
- Ungetrackte Dateien sperren den Merge-Knopf nicht mehr (Git meldet selbst, wenn eine im Weg ist).
- Umbenannte Dateien zeigen im Review-Tab den echten Diff statt „neue Datei“.
- „Fast-forward, wenn möglich“ übergibt `--ff`, unabhängig von `merge.ff` in der Git-Konfiguration.
- Commit-Anzahl stimmt auch über 200 Commits (Liste zeigt die neuesten 200).
- Branches ohne gemeinsame Historie werden als solche gemeldet statt „Git ist zu alt“.
- Review-Tab: schnelle Dateiwechsel und Tasten während laufender Anfragen zeigen oder lösen nichts Falsches mehr;
  ein Block, den ein Agent inzwischen geändert hat, wird nicht blind überschrieben (`expect`).
- Side-by-Side-Diff ohne leere Zusatzzeile am Ende; leere Konfliktseiten behalten CRLF.
- Merge und Commit dürfen bis 15 Minuten laufen (lange Git-Hooks); klarere Meldung bei zu großer Ausgabe oder Zeitüberschreitung.
- Requests ohne Eingabe (`plugin.request(name)`) stürzen nicht mehr ab.

### Geändert
- Weniger Git-Aufrufe: eine Ref-Liste pro Zustandsabfrage, ein `rev-list --left-right --count` pro Vergleich,
  die Status-Leiste fragt nur noch den Merge-Zustand ab, und Panel/Tab laden nach eigenen Aktionen und beim
  Workspace-Wechsel nicht mehr doppelt.
- Das Panel vergleicht neu, wenn sich der eigene Branch bewegt hat (z. B. nach einem Commit eines Agenten).
- Protokoll (abwärtskompatibel): `repo.fileDiff` nimmt optional `from`, `conflict.resolveHunk` optional
  `expect`; `RepoState.head`, `Comparison.ahead`, `MergePreview.unrelated` sind neu.

### Bekannt
- Mit Orca 1.4.271 und Claude Code im Modus „bypass permissions“ wurde ein vom Plugin abgelehntes Git-Kommando
  trotzdem ausgeführt (zweimal beobachtet; das Plugin-Log zeigt die Ablehnung). Ursache liegt außerhalb des
  Plugins und ist ungeklärt. Siehe SECURITY.md.

## [0.1.0] - 2026-11-23

### Hinzugefügt
- Seitenleisten-Panel mit drei Modi (Vergleichen · Konflikte lösen · Abschließen).
- Vergleich mit Orca-Workspaces desselben Projekts (inkl. Agent-Status), Branches und Remotes; Base vorausgewählt.
- Konfliktvorhersage per `git merge-tree --write-tree` (ohne Arbeitsbaum oder Refs zu ändern).
- Breiter Review-Tab (Custom Editor `*.mergereview`): Side-by-Side-Diff und Konfliktansicht mit Basis (diff3).
- Merge (Merge-Commit, Fast-forward, nur Fast-forward, Squash) mit Bestätigung in zwei Schritten; Abbrechen; Abschließen; Rückgängig direkt nach dem Merge.
- Konflikte pro Block lösen (Meins/Eingehend/Beide/Basis), ganze Datei von einer Seite, als gelöst markieren.
- Agenten: Anmerkung an den Agenten des Quell-Workspace (laufend, fortgesetzt oder neu); Agent löst Konflikte.
- Agenten-Schutz (Hook `agent.tool.before`): blockiert zerstörerische Git-Befehle während eines Merges und Force-Push.
- Merge-Wächter als Orca-Automation (optional).
- Status-Leiste, Paletten-Befehle mit Tastenkürzeln, Meldungen, Einstellungen.
- Repo-Hygiene: CI (Ubuntu + Windows), CodeQL, Dependency-Review, Secret-Scan, Dependabot, Privacy-Guard als Pre-commit-Hook.
