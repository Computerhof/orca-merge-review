# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) · Versionierung: [SemVer](https://semver.org/lang/de/).
Die Version steht nur in `orca-plugin.json`; `src/version.ts` muss ihr entsprechen (Test erzwingt das).
Breaking Change = Major: Umbenennung eines Requests/Events in `src/protocol.ts`, einer Einstellung, eines Befehls
oder einer Capability-Erweiterung, die Nutzer neu freigeben müssen.

## [Unreleased]

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
