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
- **Bekannte Einschränkung (Orca 1.4.271):** Mit Claude Code im Modus „bypass permissions“ wurde ein abgelehnter Befehl trotzdem ausgeführt; das Plugin-Log (`orca plugin logs`) zeigt die Ablehnung („guard: refused …“). Ob Orca die Ablehnung in diesem Modus weitergibt, ist ungeklärt. Verlass dich während eines Merges nicht allein auf den Schutz.
- Ob ein Merge läuft, entscheidet der Hook synchron an Gits Markerdateien (`MERGE_HEAD`, `SQUASH_MSG`), ohne Git zu starten.
- Rückgängig ist nur möglich, solange HEAD exakt der eben erzeugte Merge-Commit ist und der Arbeitsbaum sauber ist.

## Unterstützte Versionen

Nur die jeweils neueste Version erhält Sicherheitskorrekturen.
