// Texts of the wide review tab in both languages (see ../i18n/index.ts). `m.key` answers in the
// language current at the moment of reading, so never keep a text in a module-level constant.
import { messages } from '../i18n/index.ts'

export const m = messages({
  de: {
    // header
    loading: 'lädt …',
    loadingBody: 'Lade …',
    noData: 'Keine Daten.',
    exportMarkdown: 'Als Markdown speichern',
    exportMarkdownTip: 'Vergleich, Commits, Dateien und Anmerkungen, z. B. für einen PR-Text',
    reload: 'Neu laden',
    openCount: (n: number) => `${n} offen`,
    readyToFinish: 'bereit zum Abschließen',
    alreadyIncluded: 'schon enthalten',
    fastForward: 'Fast-forward',
    conflictFilesExpected: (n: number) => `${n} Konflikt-Datei(en) erwartet`,
    conflictFree: 'konfliktfrei',
    readyToContinue: 'bereit für „Weiter“',
    // rebase and cherry-pick (E9, E11): same words as the panel
    rebaseTitle: (branch: string | null, onto: string, step: string) =>
      branch ? `Rebase von ${branch} auf ${onto} läuft${step}` : `Rebase auf ${onto} läuft${step}`,
    pickTitle: (step: string) => `Cherry-Pick läuft${step}`,
    stepOf: (current: number, total: number, commit: string) => ` · Commit ${current} von ${total}` + (commit ? ` (${commit})` : ''),
    stepCommit: (commit: string) => ` (${commit})`,

    // sidebar
    showMoreConflicts: (next: number, rest: number) => `Weitere ${next} von ${rest} Konflikten zeigen`,
    showMoreFiles: (next: number, rest: number) => `Weitere ${next} von ${rest} Dateien zeigen`,
    showMoreRows: (next: number, rest: number) => `Weitere ${next} von ${rest} Zeilen zeigen`,
    conflictsGroup: (n: number) => `Konflikte (${n})`,
    allResolved: 'Alle gelöst. Abschließen im Panel oder mit „Merge & Review: Merge abschließen“.',
    allResolvedStep: 'Alle gelöst. Im Panel mit „Weiter“ den nächsten Commit anwenden.',
    pickSource: 'Quelle im Panel wählen.',
    filesGroup: (n: number) => `Dateien (${n})`,
    commitsGroup: (n: number) => `Commits (${n})`,
    binaryDelta: 'bin',
    pickFile: 'Datei links wählen.',
    pickSourceInPanel: 'Im Panel eine Quelle wählen; der Tab folgt.',
    noChanges: 'Keine Änderungen.',

    // diff
    truncated: ' (gekürzt)',
    lineNoTip: 'Klicken: Anmerkung zu dieser Zeile',
    linePrefix: (n: number) => `Zeile ${n}: `,
    notePlaceholderAgent: 'Anmerkung an den Agenten der Quelle … (Klick auf eine Zeilennummer fügt sie ein)',
    notePlaceholderReview:
      'Review-Notiz zu dieser Datei … (Klick auf eine Zeilennummer fügt sie ein; „Als Markdown speichern“ nimmt sie mit)',
    sendToAgent: 'An Agent senden',

    // conflicts
    editInEditor: 'Im Editor bearbeiten',
    wholeFile: (name: string) => `Ganze Datei: ${name}`,
    markResolved: 'Als gelöst markieren',
    markResolvedTip: 'Erst alle Blöcke auflösen',
    deletedOnChangedOn: (deleted: string, changed: string) => `Auf ${deleted} gelöscht, auf ${changed} geändert.`,
    binaryWholeSide: 'Binärdatei: nur eine ganze Seite übernehmen.',
    noMarkersLeftReview: 'Keine Konfliktmarker mehr. Prüfen und als gelöst markieren.',
    emptySide: '(leer)',
    conflictOf: (n: number, total: number) => `Konflikt ${n} von ${total}`,
    yourSide: (name: string) => `Dein Stand (${name})`,
    commonBase: 'Gemeinsame Basis',
    incomingSide: (name: string) => `Eingehend (${name})`,
    // During a rebase Git's "ours" is the base rebased onto, "theirs" the branch's own commit being replayed.
    rebaseBaseSide: (name: string) => `Neue Basis (${name})`,
    rebaseCommitSide: (name: string) => `Dein Commit (${name})`,
    rebaseMine: 'Neue Basis (1)',
    rebaseTheirs: 'Dein Commit (2)',
    mine: 'Meins (1)',
    incoming: 'Eingehend (2)',
    both: 'Beide (3)',
    base: 'Basis',

    // footer
    keysHelp: (version: string) =>
      `Merge & Review ${version} · Tasten: 1 Meins · 2 Eingehend · 3 Beide (erster offener Block) · n nächste Datei`,

    // notices
    noMarkersLeftAsk: 'Keine Marker mehr in dieser Datei. Als gelöst markieren?',
    fileResolved: (path: string) => `${path} ist gelöst.`,
    tookOurs: (path: string) => `${path}: dein Stand übernommen.`,
    tookTheirs: (path: string) => `${path}: eingehende Fassung übernommen.`,
    tookBase: (path: string, name: string) => `${path}: Fassung der neuen Basis (${name}) übernommen.`,
    tookCommit: (path: string) => `${path}: Fassung deines Commits übernommen.`,
    noteSent: 'An den laufenden Agenten geschickt.',
    noteResumed: 'Session fortgesetzt, Anmerkung folgt, sobald der Agent bereit ist.',
    noteStartedAgent: 'Neuen Agenten mit der Anmerkung gestartet.',
    reviewSaved: 'Review als Markdown gespeichert.',
    invalidTicket: 'Diese Datei ist kein gültiger Merge-&-Review-Verweis.'
  },
  en: {
    // header
    loading: 'loading …',
    loadingBody: 'Loading …',
    noData: 'No data.',
    exportMarkdown: 'Save as Markdown',
    exportMarkdownTip: 'Comparison, commits, files and notes, e.g. for a PR description',
    reload: 'Reload',
    openCount: (n: number) => `${n} open`,
    readyToFinish: 'ready to finish',
    alreadyIncluded: 'already included',
    fastForward: 'Fast-forward',
    conflictFilesExpected: (n: number) => `${n} conflicting file(s) expected`,
    conflictFree: 'conflict-free',
    readyToContinue: 'ready to continue',
    // rebase and cherry-pick (E9, E11): same words as the panel
    rebaseTitle: (branch: string | null, onto: string, step: string) =>
      branch ? `Rebasing ${branch} onto ${onto}${step}` : `Rebasing onto ${onto}${step}`,
    pickTitle: (step: string) => `Cherry-pick in progress${step}`,
    stepOf: (current: number, total: number, commit: string) => ` · commit ${current} of ${total}` + (commit ? ` (${commit})` : ''),
    stepCommit: (commit: string) => ` (${commit})`,

    // sidebar
    showMoreConflicts: (next: number, rest: number) => `Show next ${next} of ${rest} conflicts`,
    showMoreFiles: (next: number, rest: number) => `Show next ${next} of ${rest} files`,
    showMoreRows: (next: number, rest: number) => `Show next ${next} of ${rest} lines`,
    conflictsGroup: (n: number) => `Conflicts (${n})`,
    allResolved: 'All resolved. Finish in the panel or with “Merge & Review: Finish merge”.',
    allResolvedStep: 'All resolved. Press “Continue” in the panel to apply the next commit.',
    pickSource: 'Choose a source in the panel.',
    filesGroup: (n: number) => `Files (${n})`,
    commitsGroup: (n: number) => `Commits (${n})`,
    binaryDelta: 'bin',
    pickFile: 'Choose a file on the left.',
    pickSourceInPanel: 'Choose a source in the panel; the tab follows.',
    noChanges: 'No changes.',

    // diff
    truncated: ' (truncated)',
    lineNoTip: 'Click: add a note on this line',
    linePrefix: (n: number) => `Line ${n}: `,
    notePlaceholderAgent: "Note for the source's agent … (clicking a line number inserts it)",
    notePlaceholderReview:
      'Review note on this file … (clicking a line number inserts it; “Save as Markdown” includes it)',
    sendToAgent: 'Send to agent',

    // conflicts
    editInEditor: 'Edit in editor',
    wholeFile: (name: string) => `Whole file: ${name}`,
    markResolved: 'Mark as resolved',
    markResolvedTip: 'Resolve all blocks first',
    deletedOnChangedOn: (deleted: string, changed: string) => `Deleted on ${deleted}, changed on ${changed}.`,
    binaryWholeSide: 'Binary file: take one whole side only.',
    noMarkersLeftReview: 'No conflict markers left. Review and mark as resolved.',
    emptySide: '(empty)',
    conflictOf: (n: number, total: number) => `Conflict ${n} of ${total}`,
    yourSide: (name: string) => `Your side (${name})`,
    commonBase: 'Common base',
    incomingSide: (name: string) => `Incoming (${name})`,
    // During a rebase Git's "ours" is the base rebased onto, "theirs" the branch's own commit being replayed.
    rebaseBaseSide: (name: string) => `New base (${name})`,
    rebaseCommitSide: (name: string) => `Your commit (${name})`,
    rebaseMine: 'New base (1)',
    rebaseTheirs: 'Your commit (2)',
    mine: 'Mine (1)',
    incoming: 'Incoming (2)',
    both: 'Both (3)',
    base: 'Base',

    // footer
    keysHelp: (version: string) =>
      `Merge & Review ${version} · Keys: 1 mine · 2 incoming · 3 both (first open block) · n next file`,

    // notices
    noMarkersLeftAsk: 'No markers left in this file. Mark as resolved?',
    fileResolved: (path: string) => `${path} is resolved.`,
    tookOurs: (path: string) => `${path}: your side taken.`,
    tookTheirs: (path: string) => `${path}: incoming version taken.`,
    tookBase: (path: string, name: string) => `${path}: version of the new base (${name}) taken.`,
    tookCommit: (path: string) => `${path}: version of your commit taken.`,
    noteSent: 'Sent to the running agent.',
    noteResumed: 'Session resumed; the note follows as soon as the agent is ready.',
    noteStartedAgent: 'Started a new agent with the note.',
    reviewSaved: 'Review saved as Markdown.',
    invalidTicket: 'This file is not a valid Merge & Review link.'
  }
})
