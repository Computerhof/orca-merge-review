// Every text of the sidebar panel, German and English. `m.key` answers in the language the panel
// set at start (`setLocale` in `setup`). Read at render time, never copy into module constants.
import { messages, plural } from './i18n/index.ts'

export const m = messages({
  de: {
    // --- loading and generic
    loading: 'Lade …',
    loadingRepository: 'Lade Repository …',
    loadAgain: 'Erneut laden',
    noWorkspace: 'Kein Workspace geöffnet.',
    opening: 'Öffne …',
    switching: 'Wechsle …',
    comparing: 'Vergleiche …',
    saving: 'Speichere …',
    sending: 'Sende …',
    removing: 'Entferne …',
    marking: 'Markiere …',
    cancel: 'Abbrechen',
    dismiss: 'Ausblenden',
    remove: 'Entfernen',
    save: 'Speichern',
    none: 'Keine',

    // --- agent
    agentWorking: 'Agent arbeitet',
    agentPermission: 'Agent wartet auf Freigabe',
    agentDone: 'Agent fertig',
    agentActive: 'Agent aktiv',
    agentInactive: 'Agent ruht',
    agentShortWorking: 'arbeitet',
    agentShortPermission: 'wartet auf Freigabe',
    agentShortDone: 'fertig',
    agentShortActive: 'aktiv',
    agentShortInactive: 'ruht',
    goToAgent: 'Zum Agenten',
    openWorkspace: 'Workspace öffnen',

    // --- source picker
    tagBase: ' (Base)',
    tagWorkspace: ' (Workspace)',
    tagRemote: ' (Remote)',
    source: 'Quelle',
    sourcePlaceholder: 'Branch oder Workspace wählen',
    sourceAgentDone: 'Agent der Quelle ist fertig',
    compareAgain: 'Neu vergleichen',

    // --- header
    detachedHead: 'HEAD (losgelöst)',
    mergeRunning: 'Merge läuft',
    rebaseRunning: 'Rebase läuft',
    pickRunning: 'Cherry-Pick läuft',
    changedCount: (n: number) => `${n} geändert`,
    clean: 'sauber',
    reload: 'Neu laden',
    openWideTab: 'Breiten Tab öffnen',

    // --- prediction
    alreadyIncluded: 'Schon enthalten',
    nothingToMerge: 'Nichts zu mergen.',
    fastForwardPossible: 'Fast-forward möglich',
    fastForwardBody: 'Kein Merge-Commit nötig, keine Konflikte.',
    noCommonHistory: 'Keine gemeinsame Historie',
    noCommonHistoryBody: 'Die beiden Branches haben keinen gemeinsamen Vorfahren. Git verweigert diesen Merge.',
    noPrediction: 'Keine Vorhersage',
    noPredictionBody: 'Git ist zu alt für merge-tree (ab 2.38).',
    predictedClean: 'Konfliktfrei vorhergesagt',
    conflictFilesExpected: (n: number) => `${n} Konflikt-Datei(en) erwartet`,

    // --- compare summary
    incomingSummary: (ahead: number, files: number, added: number, deleted: number) =>
      `${ahead} Commit(s) kommen rein · ${files} Datei(en) · +${added} −${deleted}`,
    branchAhead: (branch: string | null, behind: number, src: string) => `${branch} ist ${behind} Commit(s) weiter als ${src}.`,

    // --- last merge, undo
    lastMergeTitle: (source: string) => `${source} übernommen`,
    commitsDot: (n: number) => `${n} Commit(s) · `,
    undoHeadBack: (before: string) => `HEAD zurück auf ${before}?`,
    undoYes: 'Ja, rückgängig',
    undoNo: 'Nein',
    undoMerge: 'Merge rückgängig',
    undoing: 'Mache rückgängig …',
    mergeUndone: 'Merge rückgängig gemacht.',

    // --- uncommitted changes
    dirtyTitle: (n: number) => `${n} nicht committete Änderung(en)`,
    dirtyBody: 'Ein Merge würde sie gefährden. Committe sie, oder lass sie beim Merge parken: Sie kommen danach automatisch zurück.',
    showSourceControl: 'Quellcodeverwaltung zeigen',

    // --- parked changes
    parkedTitle: (n: number) => `${n} geparkte Änderung(en) liegen im Stash`,
    parkedBody: (source: string) =>
      `Geparkt für den Merge von ${source}. Der Merge hat dieselben Dateien geändert; beim Zurückholen können Konfliktmarker entstehen, die du dann auflöst.`,
    restoring: 'Hole zurück …',
    restoreParked: 'Zurückholen',
    restoredWithConflicts: 'Zurückgeholt mit Konflikten: die Dateien enthalten Konfliktmarker. Der Stash bleibt zur Sicherheit erhalten.',
    restoredClean: 'Geparkte Änderungen sind zurück.',

    // --- stalled agent
    stalledTitle: 'Der gestartete Agent hat seinen Auftrag nicht bekommen',
    stalledBody: 'Orca hat den Start-Auftrag nicht abgeschickt; der Agent wartet leer. Merge & Review kann ihn jetzt eintippen.',
    typeTask: 'Auftrag eintippen',
    typingTask: 'Tippe Auftrag …',
    taskSent: 'Auftrag an den Agenten geschickt.',

    // --- jobs (probe merge, tests)
    startedAgo: 'gestartet ',
    cancelling: 'Breche ab …',
    jobConflictsBody: 'Dein Arbeitsbaum ist unverändert. Ein echter Merge stoppt bei diesen Dateien.',
    mergeForReal: 'Jetzt echt mergen',
    lastOutput: 'Letzte Ausgabe',
    startingAgent: 'Starte Agent …',
    agentStartedFix: 'Agent gestartet: er sucht die Ursache und committet eine Korrektur.',
    agentFixes: 'Agent repariert',
    openingTerminal: 'Öffne Terminal …',
    showInTerminal: 'Im Terminal ansehen',
    startingTests: 'Starte Tests …',
    retry: 'Erneut',
    orUndoAbove: 'Oder oben „Merge rückgängig“, wenn der Merge selbst das Problem ist.',

    // --- project overview
    overviewTitle: (ready: number, conflicts: number) =>
      `Workspaces des Projekts · ${ready} bereit` + (conflicts ? ` · ${conflicts} mit Konflikten` : ''),
    overviewDescription: (base: string) => `Gegen ${base} geprüft (merge-tree, ändert nichts).`,
    overviewLabel: 'Workspaces des Projekts (Enter oder Doppelklick vergleicht)',
    colWorkspace: 'Workspace',
    colAgent: 'Agent',
    colAheadBehind: 'vor/hinter',
    colPrediction: 'Vorhersage',

    // --- details: what comes in
    reviewInWideTab: 'Im breiten Tab prüfen',
    commitsTitleLatest: (shown: number, total: number) => `Commits (neueste ${shown} von ${total})`,
    commitsTitle: (n: number) => `Commits (${n})`,
    incomingCommits: 'Eingehende Commits',
    colCommit: 'Commit',
    colMessage: 'Nachricht',
    colWhen: 'Wann',
    filesTitle: (n: number) => `Dateien (${n})`,
    changedFiles: 'Geänderte Dateien (Enter oder Doppelklick öffnet den Diff)',
    colKind: 'Art',
    colFile: 'Datei',
    binary: 'binär',

    // --- details: note to the agent
    noteTitle: 'Anmerkung an den Agenten der Quelle',
    noteFile: 'Datei (optional)',
    noteGeneral: 'Allgemein',
    noteLabel: 'Anmerkung',
    notePlaceholder: 'Was soll der Agent ändern?',
    sendToAgent: 'An Agent senden',
    noteSent: (how: 'sent' | 'resumed' | 'launched') =>
      `Anmerkung ${
        how === 'sent'
          ? 'an den laufenden Agenten geschickt'
          : how === 'resumed'
            ? 'an die fortgesetzte Session übergeben'
            : 'an einen neuen Agenten übergeben'
      }. Sobald er fertig ist, meldet sich das Panel.`,

    // --- details: merge
    modeLabel: 'Art',
    modeNoFf: 'Merge-Commit (Historie bleibt sichtbar)',
    modeFf: 'Fast-forward, wenn möglich',
    modeFfOnly: 'Nur Fast-forward',
    modeSquash: 'Squash (ein Commit)',
    commitMessage: 'Commit-Nachricht (optional)',
    commitMessageDefault: 'Standard von Git',
    commitMessagePrepared: 'Von Git vorbereitet',
    blockedDetached: 'HEAD ist losgelöst: erst einen Branch auschecken.',
    blockedParked: 'Erst die geparkten Änderungen vom letzten Merge zurückholen (Karte oben).',
    probeTooltip: (source: string, testCommand: string | null) =>
      `Merged ${source} in einem temporären Worktree${testCommand ? ` und führt dort „${testCommand}“ aus` : ''}. Hier ändert sich nichts.`,
    probing: 'Starte Probe-Merge …',
    probeWithTests: 'Probe-Merge mit Tests',
    probe: 'Probe-Merge',
    confirmMergeTitle: (source: string, branch: string | null) => `${source} → ${branch} mergen?`,
    confirmSummary: (ahead: number, files: number, conflictFiles: number | null, agentWorking: boolean) =>
      `${ahead} Commit(s), ${files} Datei(en)` +
      (conflictFiles !== null ? `, ${conflictFiles} Konflikt-Datei(en) erwartet` : '') +
      (agentWorking ? '. Achtung: der Agent der Quelle arbeitet noch.' : '.'),
    confirmParkNote: (n: number) => `Vorher werden ${n} geänderte Datei(en) geparkt (git stash) und nach dem Merge zurückgeholt.`,
    yesParkAndMerge: 'Ja, parken und mergen',
    yesMerge: 'Ja, mergen',
    parkAndMerge: (source: string) => `Änderungen parken und ${source} mergen`,
    mergeInto: (source: string, branch: string | null) => `${source} → ${branch} mergen`,
    parkingAndMerging: 'Parke Änderungen und merge …',
    merging: 'Merge läuft …',

    // --- details: rebase (E9/E10)
    rebaseOnto: (source: string) => `Auf ${source} aktualisieren (Rebase)`,
    parkAndRebase: (source: string) => `Änderungen parken und auf ${source} aktualisieren (Rebase)`,
    rebaseNothing: (source: string) => `Nichts zu aktualisieren: ${source} hat keine Commits, die hier fehlen.`,
    rebaseOnBase: (base: string) => `${base} ist der Basis-Branch: hier mergen statt rebasen (ein Rebase würde ${base} neu schreiben).`,
    guardObservesTitle: 'Agenten-Schutz unter Windows nur protokollierend',
    guardObservesBody:
      'Orca gibt die Ablehnung unter Windows derzeit nicht an Claude Code weiter (Orca-Issue #49004): Befehle wie „git merge --abort“ würden trotzdem laufen. Agenten in diesem Workspace bis zum Abschluss besser nicht arbeiten lassen.',
    confirmRebaseTitle: (branch: string | null, source: string) => `${branch} auf ${source} aktualisieren?`,
    confirmRebaseSummary: (commits: number, branch: string | null, source: string, agentWorking: boolean) =>
      (commits
        ? `${commits} Commit(s) von ${branch} werden neu geschrieben (neue Hashes) und auf ${source} gesetzt.`
        : `${branch} hat keine eigenen Commits und rückt nur auf ${source} vor.`) +
      (agentWorking ? ' Achtung: der Agent der Quelle arbeitet noch.' : ''),
    confirmRebasePushed: (pushed: number, upstream: string | null) =>
      `${pushed} davon schon gepusht${upstream ? ` (auf ${upstream})` : ''}: danach ist ein Force-Push nötig; Merge & Review pusht nie.`,
    confirmParkNoteRebase: (n: number) => `Vorher werden ${n} geänderte Datei(en) geparkt (git stash) und nach dem Rebase zurückgeholt.`,
    yesRebase: (park: boolean, pushed: boolean) => `Ja, ${pushed ? 'trotzdem ' : ''}${park ? 'parken und ' : ''}aktualisieren`,
    rebasing: 'Rebase läuft …',
    parkingAndRebasing: 'Parke Änderungen und rebase …',

    // --- details: cherry-pick (E11)
    pickCommits: (n: number) => `${n} Commit(s) übernehmen (Cherry-Pick)`,
    parkAndPick: (n: number) => `Änderungen parken und ${n} Commit(s) übernehmen (Cherry-Pick)`,
    confirmPickTitle: (n: number, branch: string | null) => `${n} Commit(s) auf ${branch} übernehmen?`,
    confirmPickBody: (commits: string, branch: string | null, agentWorking: boolean) =>
      `${commits} werden in Historien-Reihenfolge auf ${branch} angewendet, mit Herkunftsvermerk (-x).` +
      (agentWorking ? ' Achtung: der Agent der Quelle arbeitet noch.' : ''),
    confirmParkNotePick: (n: number) => `Vorher werden ${n} geänderte Datei(en) geparkt (git stash) und danach zurückgeholt.`,
    yesPick: (park: boolean): string => (park ? 'Ja, parken und übernehmen' : 'Ja, übernehmen'),
    picking: 'Cherry-Pick läuft …',
    parkingAndPicking: 'Parke Änderungen und übernehme …',

    // --- tests
    thisProject: 'dieses Projekt',
    testsTitle: (project: string, command: string) => `Tests für ${project}: ${command}`,
    testsTitleNone: (project: string) => `Tests für ${project}: keine`,
    testsDescription: 'Gilt für alle Workspaces dieses Projekts. Läuft nach jedem Merge und beim Probe-Merge.',
    testCommand: 'Testbefehl',
    testCommandPlaceholder: 'z. B. npm test',
    useSuggestion: (command: string) => `Vorschlag übernehmen: ${command}`,
    runNow: 'Jetzt ausführen',
    testCommandSaved: (project: string, command: string) => `Testbefehl für ${project}: ${command}`,
    testCommandRemoved: (project: string) => `Kein Testbefehl mehr für ${project}.`,

    // --- merge watcher
    watchTitle: 'Merge-Wächter (Orca-Automation)',
    watchDescription: 'Prüft regelmäßig per Agent, ob die Base noch sauber hereinpasst.',
    watchActive: (schedule: string) => `Aktiv (${schedule})`,
    watchSetUp: 'Einrichten',
    nextRun: 'Nächster Lauf ',

    // --- resolve
    allResolved: 'Alle Konflikte gelöst',
    mergeInProgress: (source: string, branch: string | null) => `Merge ${source} → ${branch} läuft`,
    reviewAndFinish: 'Prüfen und abschließen.',
    stillWithMarkers: (open: number, total: number) => `${open} von ${total} Datei(en) noch mit Konfliktmarkern.`,
    progress: 'Fortschritt',
    conflictFiles: 'Konflikt-Dateien',
    noMarkersLeft: 'keine Marker mehr',
    view: 'Ansehen',
    markResolved: 'Als gelöst markieren',
    openClickToOpen: 'offen: klicken öffnet den Konflikt',
    openNextConflict: 'Nächsten Konflikt öffnen',
    resolveTooltip: 'Startet einen Agenten mit fertigem Auftrag. Er committet nicht, du prüfst und schließt ab.',
    agentStartedResolve: 'Agent gestartet. Das Panel aktualisiert sich, während er arbeitet.',
    agentResolves: 'Agent löst Konflikte',
    finishing: 'Schließe ab …',
    mergeCompleted: 'Merge abgeschlossen.',
    completeMerge: 'Merge abschließen',
    abortTitle: 'Merge wirklich abbrechen?',
    abortBody: 'Alle Auflösungen gehen verloren; der Branch steht wieder wie vor dem Merge.',
    yesAbort: 'Ja, abbrechen',
    keepResolving: 'Weiter auflösen',
    abortMerge: 'Merge abbrechen',
    aborting: 'Breche ab …',
    mergeAborted: 'Merge abgebrochen.',

    // --- resolve: rebase and cherry-pick (E9, E11)
    rebaseInProgress: (branch: string | null, onto: string, step: string) =>
      branch ? `Rebase von ${branch} auf ${onto} läuft${step}` : `Rebase auf ${onto} läuft${step}`,
    pickInProgress: (step: string) => `Cherry-Pick läuft${step}`,
    stepOf: (current: number, total: number, commit: string) => ` · Commit ${current} von ${total}` + (commit ? ` (${commit})` : ''),
    stepCommit: (commit: string) => ` (${commit})`,
    stepResolved: 'Alle Konflikte dieses Commits gelöst. „Weiter“ wendet den nächsten Commit an oder schließt ab.',
    continueOp: 'Weiter',
    continueBlocked: 'Erst alle Konflikte lösen und als gelöst markieren.',
    continuing: 'Mache weiter …',
    nextCommitConflicts: (n: number) => `Der nächste Commit hat Konflikte in ${n} Datei(en). Lösen, dann wieder „Weiter“.`,
    skipCommit: 'Commit überspringen',
    skipTitle: (commit: string) => `${commit} überspringen?`,
    skipBody: 'Dieser Commit wird nicht übernommen; seine Änderungen fehlen danach. Auflösungen in diesem Commit gehen verloren.',
    thisCommit: 'Diesen Commit',
    yesSkip: 'Ja, überspringen',
    skipping: 'Überspringe …',
    abortRebaseTitle: 'Rebase wirklich abbrechen?',
    abortRebaseBody: 'Alle Auflösungen gehen verloren; der Branch steht wieder wie vor dem Rebase.',
    abortRebase: 'Rebase abbrechen',
    rebaseAborted: 'Rebase abgebrochen.',
    abortPickTitle: 'Cherry-Pick wirklich abbrechen?',
    abortPickBody: 'Alle Auflösungen gehen verloren; der Branch steht wieder wie vor dem Cherry-Pick.',
    abortPick: 'Cherry-Pick abbrechen',
    pickAborted: 'Cherry-Pick abgebrochen.',

    // --- notices from worker events
    autoResolved: (path: string) => `${path} ohne Konfliktmarker gespeichert und als gelöst markiert.`
  },
  en: {
    // --- loading and generic
    loading: 'Loading …',
    loadingRepository: 'Loading repository …',
    loadAgain: 'Load again',
    noWorkspace: 'No workspace open.',
    opening: 'Opening …',
    switching: 'Switching …',
    comparing: 'Comparing …',
    saving: 'Saving …',
    sending: 'Sending …',
    removing: 'Removing …',
    marking: 'Marking …',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    remove: 'Remove',
    save: 'Save',
    none: 'None',

    // --- agent
    agentWorking: 'Agent working',
    agentPermission: 'Agent waiting for approval',
    agentDone: 'Agent done',
    agentActive: 'Agent active',
    agentInactive: 'Agent idle',
    agentShortWorking: 'working',
    agentShortPermission: 'waiting for approval',
    agentShortDone: 'done',
    agentShortActive: 'active',
    agentShortInactive: 'idle',
    goToAgent: 'Go to agent',
    openWorkspace: 'Open workspace',

    // --- source picker
    tagBase: ' (base)',
    tagWorkspace: ' (workspace)',
    tagRemote: ' (remote)',
    source: 'Source',
    sourcePlaceholder: 'Choose a branch or workspace',
    sourceAgentDone: 'The source agent is done',
    compareAgain: 'Compare again',

    // --- header
    detachedHead: 'HEAD (detached)',
    mergeRunning: 'Merge in progress',
    rebaseRunning: 'Rebase in progress',
    pickRunning: 'Cherry-pick in progress',
    changedCount: (n: number) => `${n} changed`,
    clean: 'clean',
    reload: 'Reload',
    openWideTab: 'Open in wide tab',

    // --- prediction
    alreadyIncluded: 'Already included',
    nothingToMerge: 'Nothing to merge.',
    fastForwardPossible: 'Fast-forward possible',
    fastForwardBody: 'No merge commit needed, no conflicts.',
    noCommonHistory: 'No common history',
    noCommonHistoryBody: 'The two branches have no common ancestor. Git refuses this merge.',
    noPrediction: 'No prediction',
    noPredictionBody: 'Git is too old for merge-tree (needs 2.38).',
    predictedClean: 'Predicted conflict-free',
    conflictFilesExpected: (n: number) => `${plural(n, 'conflicting file', 'conflicting files')} expected`,

    // --- compare summary
    incomingSummary: (ahead: number, files: number, added: number, deleted: number) =>
      `${plural(ahead, 'commit', 'commits')} incoming · ${plural(files, 'file', 'files')} · +${added} −${deleted}`,
    branchAhead: (branch: string | null, behind: number, src: string) =>
      `${branch} is ${plural(behind, 'commit', 'commits')} ahead of ${src}.`,

    // --- last merge, undo
    lastMergeTitle: (source: string) => `${source} merged`,
    commitsDot: (n: number) => `${plural(n, 'commit', 'commits')} · `,
    undoHeadBack: (before: string) => `Reset HEAD to ${before}?`,
    undoYes: 'Yes, undo',
    undoNo: 'No',
    undoMerge: 'Undo merge',
    undoing: 'Undoing …',
    mergeUndone: 'Merge undone.',

    // --- uncommitted changes
    dirtyTitle: (n: number) => plural(n, 'uncommitted change', 'uncommitted changes'),
    dirtyBody: 'A merge would put them at risk. Commit them, or let the merge park them: they come back automatically afterwards.',
    showSourceControl: 'Show source control',

    // --- parked changes
    parkedTitle: (n: number) => `${plural(n, 'parked change is', 'parked changes are')} in the stash`,
    parkedBody: (source: string) =>
      `Parked for the merge of ${source}. The merge changed the same files; restoring them can produce conflict markers, which you then resolve.`,
    restoring: 'Restoring …',
    restoreParked: 'Restore',
    restoredWithConflicts: 'Restored with conflicts: the files contain conflict markers. The stash is kept for safety.',
    restoredClean: 'Parked changes are back.',

    // --- stalled agent
    stalledTitle: 'The started agent never got its task',
    stalledBody: 'Orca did not send the start prompt; the agent is waiting idle. Merge & Review can type it in now.',
    typeTask: 'Type the task',
    typingTask: 'Typing task …',
    taskSent: 'Task sent to the agent.',

    // --- jobs (probe merge, tests)
    startedAgo: 'started ',
    cancelling: 'Cancelling …',
    jobConflictsBody: 'Your working tree is unchanged. A real merge would stop at these files.',
    mergeForReal: 'Merge for real',
    lastOutput: 'Last output',
    startingAgent: 'Starting agent …',
    agentStartedFix: 'Agent started: it looks for the cause and commits a fix.',
    agentFixes: 'Agent fixes it',
    openingTerminal: 'Opening terminal …',
    showInTerminal: 'Show in terminal',
    startingTests: 'Starting tests …',
    retry: 'Retry',
    orUndoAbove: 'Or use “Undo merge” above if the merge itself is the problem.',

    // --- project overview
    overviewTitle: (ready: number, conflicts: number) =>
      `Project workspaces · ${ready} ready` + (conflicts ? ` · ${conflicts} with conflicts` : ''),
    overviewDescription: (base: string) => `Checked against ${base} (merge-tree, changes nothing).`,
    overviewLabel: 'Project workspaces (Enter or double-click compares)',
    colWorkspace: 'Workspace',
    colAgent: 'Agent',
    colAheadBehind: 'ahead/behind',
    colPrediction: 'Prediction',

    // --- details: what comes in
    reviewInWideTab: 'Review in wide tab',
    commitsTitleLatest: (shown: number, total: number) => `Commits (latest ${shown} of ${total})`,
    commitsTitle: (n: number) => `Commits (${n})`,
    incomingCommits: 'Incoming commits',
    colCommit: 'Commit',
    colMessage: 'Message',
    colWhen: 'When',
    filesTitle: (n: number) => `Files (${n})`,
    changedFiles: 'Changed files (Enter or double-click opens the diff)',
    colKind: 'Change',
    colFile: 'File',
    binary: 'binary',

    // --- details: note to the agent
    noteTitle: 'Note to the source agent',
    noteFile: 'File (optional)',
    noteGeneral: 'General',
    noteLabel: 'Note',
    notePlaceholder: 'What should the agent change?',
    sendToAgent: 'Send to agent',
    noteSent: (how: 'sent' | 'resumed' | 'launched') =>
      `Note ${
        how === 'sent'
          ? 'sent to the running agent'
          : how === 'resumed'
            ? 'handed to the resumed session'
            : 'handed to a new agent'
      }. The panel will tell you when it is done.`,

    // --- details: merge
    modeLabel: 'Mode',
    modeNoFf: 'Merge commit (keeps history visible)',
    modeFf: 'Fast-forward if possible',
    modeFfOnly: 'Fast-forward only',
    modeSquash: 'Squash (single commit)',
    commitMessage: 'Commit message (optional)',
    commitMessageDefault: 'Git default',
    commitMessagePrepared: 'Prepared by Git',
    blockedDetached: 'HEAD is detached: check out a branch first.',
    blockedParked: 'Restore the changes parked by the last merge first (card above).',
    probeTooltip: (source: string, testCommand: string | null) =>
      `Merges ${source} in a temporary worktree${testCommand ? ` and runs “${testCommand}” there` : ''}. Nothing changes here.`,
    probing: 'Starting trial merge …',
    probeWithTests: 'Trial merge with tests',
    probe: 'Trial merge',
    confirmMergeTitle: (source: string, branch: string | null) => `Merge ${source} into ${branch}?`,
    confirmSummary: (ahead: number, files: number, conflictFiles: number | null, agentWorking: boolean) =>
      `${plural(ahead, 'commit', 'commits')}, ${plural(files, 'file', 'files')}` +
      (conflictFiles !== null ? `, ${plural(conflictFiles, 'conflicting file', 'conflicting files')} expected` : '') +
      (agentWorking ? '. Note: the source agent is still working.' : '.'),
    confirmParkNote: (n: number) =>
      `First, ${plural(n, 'changed file', 'changed files')} will be parked (git stash) and restored after the merge.`,
    yesParkAndMerge: 'Yes, park and merge',
    yesMerge: 'Yes, merge',
    parkAndMerge: (source: string) => `Park changes and merge ${source}`,
    mergeInto: (source: string, branch: string | null) => `Merge ${source} into ${branch}`,
    parkingAndMerging: 'Parking changes and merging …',
    merging: 'Merging …',

    // --- details: rebase (E9/E10)
    rebaseOnto: (source: string) => `Update onto ${source} (rebase)`,
    parkAndRebase: (source: string) => `Park changes and update onto ${source} (rebase)`,
    rebaseNothing: (source: string) => `Nothing to update: ${source} has no commits missing here.`,
    rebaseOnBase: (base: string) => `${base} is the base branch: merge here instead of rebasing (a rebase would rewrite ${base}).`,
    guardObservesTitle: 'Agent guard only logs on Windows',
    guardObservesBody:
      'On Windows Orca does not pass the refusal on to Claude Code yet (Orca issue #49004): commands like "git merge --abort" would still run. Better keep agents in this workspace idle until this is finished.',
    confirmRebaseTitle: (branch: string | null, source: string) => `Update ${branch} onto ${source}?`,
    confirmRebaseSummary: (commits: number, branch: string | null, source: string, agentWorking: boolean) =>
      (commits
        ? `${plural(commits, 'commit', 'commits')} of ${branch} will be rewritten (new hashes) and placed on top of ${source}.`
        : `${branch} has no commits of its own and only moves forward to ${source}.`) +
      (agentWorking ? ' Note: the source agent is still working.' : ''),
    confirmRebasePushed: (pushed: number, upstream: string | null) =>
      `${pushed} of them already pushed${upstream ? ` (to ${upstream})` : ''}: a force push is needed afterwards; Merge & Review never pushes.`,
    confirmParkNoteRebase: (n: number) =>
      `First, ${plural(n, 'changed file', 'changed files')} will be parked (git stash) and restored after the rebase.`,
    yesRebase: (park: boolean, pushed: boolean) => `Yes, ${park ? 'park and ' : ''}update${pushed ? ' anyway' : ''}`,
    rebasing: 'Rebasing …',
    parkingAndRebasing: 'Parking changes and rebasing …',

    // --- details: cherry-pick (E11)
    pickCommits: (n: number) => `Apply ${plural(n, 'commit', 'commits')} (cherry-pick)`,
    parkAndPick: (n: number) => `Park changes and apply ${plural(n, 'commit', 'commits')} (cherry-pick)`,
    confirmPickTitle: (n: number, branch: string | null) => `Apply ${plural(n, 'commit', 'commits')} to ${branch}?`,
    confirmPickBody: (commits: string, branch: string | null, agentWorking: boolean) =>
      `${commits} will be applied to ${branch} in history order, with a note of their origin (-x).` +
      (agentWorking ? ' Note: the source agent is still working.' : ''),
    confirmParkNotePick: (n: number) =>
      `First, ${plural(n, 'changed file', 'changed files')} will be parked (git stash) and restored afterwards.`,
    yesPick: (park: boolean) => (park ? 'Yes, park and apply' : 'Yes, apply'),
    picking: 'Cherry-picking …',
    parkingAndPicking: 'Parking changes and cherry-picking …',

    // --- tests
    thisProject: 'this project',
    testsTitle: (project: string, command: string) => `Tests for ${project}: ${command}`,
    testsTitleNone: (project: string) => `Tests for ${project}: none`,
    testsDescription: 'Applies to all workspaces of this project. Runs after every merge and in the trial merge.',
    testCommand: 'Test command',
    testCommandPlaceholder: 'e.g. npm test',
    useSuggestion: (command: string) => `Use suggestion: ${command}`,
    runNow: 'Run now',
    testCommandSaved: (project: string, command: string) => `Test command for ${project}: ${command}`,
    testCommandRemoved: (project: string) => `No test command for ${project} anymore.`,

    // --- merge watcher
    watchTitle: 'Merge watcher (Orca automation)',
    watchDescription: 'Regularly checks, using an agent, that the base still merges cleanly.',
    watchActive: (schedule: string) => `Active (${schedule})`,
    watchSetUp: 'Set up',
    nextRun: 'Next run ',

    // --- resolve
    allResolved: 'All conflicts resolved',
    mergeInProgress: (source: string, branch: string | null) => `Merging ${source} into ${branch}`,
    reviewAndFinish: 'Review and finish.',
    stillWithMarkers: (open: number, total: number) => `${open} of ${plural(total, 'file', 'files')} still contain conflict markers.`,
    progress: 'Progress',
    conflictFiles: 'Conflicted files',
    noMarkersLeft: 'no markers left',
    view: 'View',
    markResolved: 'Mark as resolved',
    openClickToOpen: 'open: click to open the conflict',
    openNextConflict: 'Open next conflict',
    resolveTooltip: 'Starts an agent with a ready-made task. It does not commit; you review and finish.',
    agentStartedResolve: 'Agent started. The panel updates while it works.',
    agentResolves: 'Agent resolves conflicts',
    finishing: 'Finishing …',
    mergeCompleted: 'Merge completed.',
    completeMerge: 'Complete merge',
    abortTitle: 'Really abort the merge?',
    abortBody: 'All resolutions will be lost; the branch goes back to how it was before the merge.',
    yesAbort: 'Yes, abort',
    keepResolving: 'Keep resolving',
    abortMerge: 'Abort merge',
    aborting: 'Aborting …',
    mergeAborted: 'Merge aborted.',

    // --- resolve: rebase and cherry-pick (E9, E11)
    rebaseInProgress: (branch: string | null, onto: string, step: string) =>
      branch ? `Rebasing ${branch} onto ${onto}${step}` : `Rebasing onto ${onto}${step}`,
    pickInProgress: (step: string) => `Cherry-pick in progress${step}`,
    stepOf: (current: number, total: number, commit: string) => ` · commit ${current} of ${total}` + (commit ? ` (${commit})` : ''),
    stepCommit: (commit: string) => ` (${commit})`,
    stepResolved: 'All conflicts of this commit resolved. “Continue” applies the next commit or finishes.',
    continueOp: 'Continue',
    continueBlocked: 'Resolve all conflicts and mark them as resolved first.',
    continuing: 'Continuing …',
    nextCommitConflicts: (n: number) =>
      `The next commit has conflicts in ${plural(n, 'file', 'files')}. Resolve them, then “Continue” again.`,
    skipCommit: 'Skip commit',
    skipTitle: (commit: string) => `Skip ${commit}?`,
    skipBody: 'This commit is not applied; its changes will be missing afterwards. Resolutions in this commit are lost.',
    thisCommit: 'this commit',
    yesSkip: 'Yes, skip',
    skipping: 'Skipping …',
    abortRebaseTitle: 'Really abort the rebase?',
    abortRebaseBody: 'All resolutions will be lost; the branch goes back to how it was before the rebase.',
    abortRebase: 'Abort rebase',
    rebaseAborted: 'Rebase aborted.',
    abortPickTitle: 'Really abort the cherry-pick?',
    abortPickBody: 'All resolutions will be lost; the branch goes back to how it was before the cherry-pick.',
    abortPick: 'Abort cherry-pick',
    pickAborted: 'Cherry-pick aborted.',

    // --- notices from worker events
    autoResolved: (path: string) => `${path} saved without conflict markers and marked as resolved.`
  }
})
