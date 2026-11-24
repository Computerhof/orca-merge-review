# Architektur

```
orca-plugin.json        Manifest: Panel, Custom Editor, Befehle, Tastenkürzel, Status-Leiste,
                        Events, Hooks, Einstellungen, Capabilities. Einzige Quelle der Version.
src/
  types.ts              Reine Datentypen (kein Orca-Import): Kern, Worker, Panel, Tab
  protocol.ts           Vertrag Panel/Tab ↔ Worker (Requests, Events) per declare module 'orca'
  core/                 ── kennt Orca nicht; läuft in CI mit reinem Node ──
    repo.ts             Git-Operationen: Zustand, Vergleich, merge-tree-Vorschau, Merge,
                        Abbruch, Abschluss, Undo, Konflikte (über GitRunner + FileAccess)
    conflicts.ts        Konfliktmarker lesen/auflösen (merge, diff3), Zeilenenden bleiben erhalten
    diffview.ts         Unified Patch → Side-by-Side-Zeilen
    gitGuard.ts         Agent-Toolaufruf → „zerstört das einen laufenden Merge?“ (synchron)
    prompts.ts          Texte für Agenten (Review-Anmerkung, Konfliktauftrag, Merge-Wächter, Merge-Hinweis)
    reviewExport.ts     Review als Markdown (Vergleich, Commits, Dateien, Notizen)
    readiness.ts        K10: Wie bereit ist ein Workspace? (Sortierung, Beschriftung)
  git/                  ── austauschbare Anbindung ──
    runner.ts           GitRunner-Schnittstelle + LocalGitRunner (execFile, keine Shell)
    files.ts            FileAccess auf das lokale Dateisystem (UTF-8, sonst verlustfrei latin1)
    mergeMarkers.ts     „Läuft hier ein Merge?“ synchron aus MERGE_HEAD/SQUASH_MSG, für Hooks
  worker.ts             Nur Verdrahtung: Handler, Events, Hooks, Befehle
  worker/
    workspaces.ts       Orca-Workspace → Repo; Quellen (Geschwister-Workspaces, Branches, Remotes)
    handlers.ts         Request-Handler (dünn, UserError → Meldung im Panel)
    monitor.ts          Merge-Zustand pro Workspace (Cache für Hook und Status-Leiste)
    reviewTab.ts        Hilfsdatei schreiben + editor.open
    agents.ts           Anmerkung zustellen (laufend → fortsetzen → neu), Warteschlange
    watch.ts            Merge-Wächter als Orca-Automation
    circles.ts          K13 Speichern = gelöst, K14 Merge-Hinweis im Prompt, K15 Zum Agenten
    overview.ts         K10: alle Workspaces des Projekts gegen die Base (gecacht pro Commit-Paar)
    memory.ts           Plugin-Speicher: letzte Quelle, Undo-Daten, beobachtete Quellen
    settings.ts         Einstellungen, synchron lesbar
  panel.tsx             Seitenleiste (Orca-Komponenten), Modi A/B/C
  editor/review.ts      Breiter Tab (Custom Editor, DOM), styles.ts
  testing/fixture.ts    Echte Temp-Repos für orca plugin test/check
test/*.spec.ts          Kern-Tests mit node:test gegen echtes Git (CI)
src/*.test.ts(x)        Worker-/Panel-Tests im Orca-Runtime (lokal)
scripts/check-private.mjs  Privacy-/Secret-Guard (Hook + CI)
```

## Datenfluss

1. Panel/Tab → `plugin.request(name, input)` → Worker-Handler → `Workspaces.resolve()` (Orca-Workspace → Pfad) → `Repo` (Git).
2. Nach jeder schreibenden Aktion plant der `Monitor` eine Auffrischung: Er aktualisiert die Status-Leiste und sendet `repo.changed` an alle offenen Panels und Tabs.
3. Auffrischung auch bei Workspace-Fokus (`workspace.changed`), Git-Befehlen von Agenten (`agent.tool.after`), Speichern während eines Merges (`editor.save.before`) und alle 20 s für den fokussierten Workspace.
4. Der Hook `agent.tool.before` entscheidet synchron (Orca gibt Hooks 2 s): Er bildet Orcas Hook-Kennung
   (`repoId::Pfad`) über die zuletzt geladene Workspace-Liste auf die `workspace.list`-ID ab und prüft Gits
   Markerdateien direkt im Arbeitsbaum, ohne Git zu starten.
5. Git läuft immer mit `--literal-pathspecs`; Pfade aus dem Panel sind nie Muster.

## Austauschbarkeit

Git läuft hinter `GitRunner`, Dateien hinter `FileAccess`. Eine Anbindung für SSH-Hosts wäre eine neue
Implementierung beider Schnittstellen. `Workspaces.resolve()` wählt sie anhand von `hostId`; Kern und Panel
bleiben unverändert.
