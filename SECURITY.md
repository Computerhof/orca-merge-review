# Sicherheit

## Lücke melden

Bitte **nicht** als öffentliches Issue. Nutze GitHubs *Private Vulnerability Reporting*
(Reiter „Security“ → „Report a vulnerability“). Wir antworten in der Regel innerhalb einer Woche.

## Was das Plugin darf

Das Plugin läuft in Orca als `trusted-worker`: ein Node-Prozess mit den Rechten deines Benutzerkontos.
Es führt `git` aus (immer ohne Shell, Argumente direkt an den Prozess) und kann mit deiner Freigabe Agenten
starten, in Agent-Terminals schreiben und Orca-Automationen anlegen. Die Liste der Rechte steht in der README.

## Schutzmaßnahmen im Code

- Branch-Namen werden mit `git rev-parse --verify --end-of-options` geprüft; Werte, die wie Optionen aussehen, werden abgelehnt.
- Dateioperationen bei Konflikten gelten nur für Dateien, die Git tatsächlich als ungemergt führt; Pfade mit `..`, absolute Pfade und NUL-Zeichen werden abgelehnt.
- Der Review-Tab setzt Dateiinhalte, Commit-Nachrichten und Branch-Namen ausschließlich als Text ins DOM (kein `innerHTML`).
- Der Agenten-Schutz ist eine **Leitplanke, keine Sicherheitsgrenze**: Er liest den Befehl wie eine Shell und erkennt typische zerstörerische Git-Befehle, ein entschlossener Prozess kann ihn umgehen (Skripte, Aliase, andere Werkzeuge als die Shell). Fällt der Worker aus, lässt Orca den Befehl durch (`onError: pass`), damit Agenten nicht blockiert werden.
- **Unter Windows blockiert der Schutz nicht (Orca 1.4.271 bis mindestens 1.4.274).** Orcas Hook-Programm
  (`orca-agent-hook.exe`) beantwortet Claude Codes `PreToolUse` unter Windows immer mit `{}`, ohne die Entscheidung
  des Plugins; Orca hat Windows bewusst als „observe-only“ gebaut (stablyai/orca#37303). Belegt am 2026-11-25: Das
  Plugin lehnte `git merge --abort` ab (Log „guard: refused …“), 13 ms später antwortete Orca Claude Code mit `{}`,
  der Befehl lief. Feature-Wunsch bei Orca: stablyai/orca#49004; Nacharbeit hier: Issue #10. Das Panel weist unter
  Windows während eines Merges, Rebase oder Cherry-Pick darauf hin. Unter macOS und Linux wartet Claude Code auf
  die Entscheidung. Verlass dich während eines Vorgangs nie allein auf den Schutz.
- Ob ein Merge läuft, entscheidet der Hook synchron an Gits Markerdateien (`MERGE_HEAD`, `SQUASH_MSG`), ohne Git zu starten.
- Der **Testbefehl** wird pro Orca-Projekt im Panel festgelegt und im Plugin-Speicher auf deinem Rechner abgelegt,
  nie im Repo; ein fremder Branch kann ihn also nicht einschleusen. Den Vorschlag aus den Projektdateien übernimmt
  das Plugin nur auf deinen Klick. Der Worker führt den Befehl über die System-Shell aus, wie du ihn tippen würdest,
  im Workspace bzw. im Temp-Worktree des Probe-Merges. Nichts aus Git oder von einem Agenten wird eingesetzt.
  Ohne Festlegung läuft nichts. Beachte: Tests führen den Code des gemergten Branches aus.
- Der **Probe-Merge** legt einen Worktree im Temp-Ordner an (`git worktree add --detach`), merged dort ohne die
  Git-Hooks des Repos und entfernt ihn danach (`git worktree remove`, `prune`). Ein verlinktes `node_modules`
  entfernt das Plugin vorher selbst, damit kein rekursives Löschen den echten Ordner erreicht (getestet).
- Rückgängig ist nur möglich, solange HEAD exakt der eben erzeugte Merge-Commit ist und der Arbeitsbaum sauber ist.

## Unterstützte Versionen

Nur die jeweils neueste Version erhält Sicherheitskorrekturen.
