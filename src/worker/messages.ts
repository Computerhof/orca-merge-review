// Every text the worker shows a person (status bar, notifications, command results, refusals the
// panel displays), in both languages. The worker's language is what the panel last reported
// (`ui.locale`); read at call time (`m.finished(hash)`), never copied into a module-level
// constant. The German texts are the originals: tests and users rely on their exact wording.
// Texts that come from the Git side (refusals of core/repo.ts, agent prompts) live in core/messages.ts.
import { messages, plural } from '../i18n/index.ts'

export const m = messages({
  de: {
    // ---- worker.ts: notification and command palette results
    agentDone: (source: string) => `Agent in „${source}“ ist fertig. Neu vergleichen?`,
    opened: 'Merge & Review geöffnet.',
    allConflictsResolved: 'Alle Konflikte sind aufgelöst. Jetzt den Merge abschließen.',
    conflictIn: (path: string) => `Konflikt in ${path}`,
    noOtherBase: 'Kein anderer Base-Branch gefunden.',
    compareWith: (base: string) => `Vergleich mit ${base}`,
    mergeFinished: (hash: string) => `Merge abgeschlossen (${hash}).`,

    // ---- handlers.ts: parked changes (stash)
    parkedBack: ' Deine geparkten Änderungen sind zurück.',
    parkedOverlap: ' Deine geparkten Änderungen liegen noch im Stash, weil der Merge dieselben Dateien geändert hat (Panel: „Zurückholen“).',
    parkedConflict: ' Beim Zurückholen deiner geparkten Änderungen gab es Konflikte; sie liegen weiter im Stash.',
    parkedStillThere: 'Es liegen noch geparkte Änderungen von einem früheren Merge im Stash. Erst zurückholen.',
    stashMessage: (source: string) => `Merge & Review: geparkt vor dem Merge von ${source}`,
    parkedReturnLater: (message: string) => `${message} Deine geparkten Änderungen kommen nach dem Abschluss oder Abbruch zurück.`,
    noParked: 'Es gibt keine geparkten Änderungen.',
    finishMergeFirst: 'Erst den laufenden Merge abschließen oder abbrechen.',

    // ---- handlers.ts: merge, tests, agents
    mergeDoneNotice: (note: string) => `Merge abgeschlossen.${note}`,
    nothingToUndo: 'Hier gibt es keinen Merge, der sich rückgängig machen lässt.',
    noteEmpty: 'Die Anmerkung ist leer.',
    noAgentWorkspace: (source: string) => `Zu „${source}“ gibt es keinen Orca-Workspace mit Agent.`,
    allResolvedAlready: 'Alle Konflikte sind schon aufgelöst.',
    noTestCommand: 'Für dieses Projekt ist kein Testbefehl festgelegt.',
    testsTerminalTitle: 'Merge & Review: Tests',
    noRedRun: 'Es gibt keinen roten Testlauf.',
    testCommandOneLine: 'Der Testbefehl muss eine Zeile sein (höchstens 500 Zeichen).',
    typingRefused: (reason: string) =>
      `Orca hat das Eintippen abgelehnt (${reason}). Bitte den Auftrag im Terminal des Agenten selbst abschicken.`,
    watchOnBase: 'Dieser Workspace ist selbst die Base. Der Merge-Wächter gehört in einen Feature-Workspace.',

    // ---- circles.ts
    noWorkspaceForBranch: (source: string) => `Zu „${source}“ gibt es keinen Orca-Workspace.`,

    // ---- workspaces.ts
    noWorkspaceOpen: 'Kein Workspace geöffnet.',
    unknownWorkspace: 'Dieser Workspace ist Orca nicht (mehr) bekannt.',
    remoteWorkspace: 'Dieser Workspace liegt auf einem entfernten Host. Merge & Review arbeitet in v0.1 nur lokal.',
    notAGitRepo: (name: string) => `„${name}“ ist kein Git-Repository.`,

    // ---- watch.ts: the name of the Orca automation
    watchPrefix: 'Merge-Wächter: ',

    // ---- jobs.ts
    noTestCommandSet: 'Für dieses Projekt ist kein Testbefehl festgelegt (Panel: „Tests für dieses Projekt“).',
    testsRunning: (command: string) => `Tests laufen: ${command}`,
    testsGreen: 'Tests grün.',
    testsTimedOut: 'Tests nach 15 Minuten abgebrochen.',
    testsCancelled: 'Tests abgebrochen.',
    testsRed: (exit: number | string) => `Tests rot (Exit ${exit}).`,
    probeRunning: (source: string) => `Probe-Merge von ${source} läuft …`,
    probeRunningWithTests: (source: string) => `Probe-Merge mit Tests von ${source} läuft …`,
    probeResult: (source: string, result: string) => `Probe-Merge von ${source}: ${result}`,
    jobStillRunning: 'Läuft noch. Erst abbrechen.',
    jobAlreadyRunning: 'Hier läuft schon ein Test oder Probe-Merge.',

    // ---- monitor.ts: status bar
    statusProbeRunning: 'Probe-Merge läuft …',
    statusTestsRunning: 'Tests laufen …',
    statusProbeConflicts: 'Probe-Merge: Konflikte',
    statusProbeError: 'Probe-Merge: Fehler',
    statusProbeRed: 'Probe-Merge: rot',
    statusTestsError: 'Tests: Fehler',
    statusTestsRed: 'Tests: rot',
    statusJobTooltip: (message: string) => `${message} Details im Panel Merge & Review.`,
    statusMergeReady: 'Merge bereit zum Abschließen',
    statusConflictsOpen: (n: number) => `Merge: ${n} ${n === 1 ? 'Konflikt' : 'Konflikte'} offen`,
    statusMergeTooltip: (source: string) => `Merge von ${source} läuft. Klicken öffnet Merge & Review.`
  },
  en: {
    // ---- worker.ts
    agentDone: (source: string) => `The agent in “${source}” is done. Compare again?`,
    opened: 'Merge & Review opened.',
    allConflictsResolved: 'All conflicts are resolved. Now finish the merge.',
    conflictIn: (path: string) => `Conflict in ${path}`,
    noOtherBase: 'No other base branch found.',
    compareWith: (base: string) => `Comparison with ${base}`,
    mergeFinished: (hash: string) => `Merge finished (${hash}).`,

    // ---- handlers.ts: parked changes (stash)
    parkedBack: ' Your parked changes are back.',
    parkedOverlap: ' Your parked changes are still in the stash because the merge changed the same files (panel: “Restore”).',
    parkedConflict: ' Restoring your parked changes caused conflicts; they stay in the stash.',
    parkedStillThere: 'Changes parked for an earlier merge are still in the stash. Restore them first.',
    stashMessage: (source: string) => `Merge & Review: parked before merging ${source}`,
    parkedReturnLater: (message: string) => `${message} Your parked changes come back after the merge is finished or aborted.`,
    noParked: 'There are no parked changes.',
    finishMergeFirst: 'Finish or abort the merge in progress first.',

    // ---- handlers.ts: merge, tests, agents
    mergeDoneNotice: (note: string) => `Merge finished.${note}`,
    nothingToUndo: 'There is no merge here that can be undone.',
    noteEmpty: 'The note is empty.',
    noAgentWorkspace: (source: string) => `There is no Orca workspace with an agent for “${source}”.`,
    allResolvedAlready: 'All conflicts are already resolved.',
    noTestCommand: 'No test command is set for this project.',
    testsTerminalTitle: 'Merge & Review: Tests',
    noRedRun: 'There is no failed test run.',
    testCommandOneLine: 'The test command must be a single line (at most 500 characters).',
    typingRefused: (reason: string) =>
      `Orca refused to type the task in (${reason}). Please send it yourself in the agent's terminal.`,
    watchOnBase: 'This workspace is the base itself. The merge watch belongs in a feature workspace.',

    // ---- circles.ts
    noWorkspaceForBranch: (source: string) => `There is no Orca workspace for “${source}”.`,

    // ---- workspaces.ts
    noWorkspaceOpen: 'No workspace is open.',
    unknownWorkspace: 'Orca no longer knows this workspace.',
    remoteWorkspace: 'This workspace is on a remote host. Merge & Review only works locally in v0.1.',
    notAGitRepo: (name: string) => `“${name}” is not a Git repository.`,

    // ---- watch.ts
    watchPrefix: 'Merge watch: ',

    // ---- jobs.ts
    noTestCommandSet: 'No test command is set for this project (panel: “Tests for this project”).',
    testsRunning: (command: string) => `Tests running: ${command}`,
    testsGreen: 'Tests green.',
    testsTimedOut: 'Tests stopped after 15 minutes.',
    testsCancelled: 'Tests cancelled.',
    testsRed: (exit: number | string) => `Tests failed (exit ${exit}).`,
    probeRunning: (source: string) => `Trial merge of ${source} running …`,
    probeRunningWithTests: (source: string) => `Trial merge of ${source} with tests running …`,
    probeResult: (source: string, result: string) => `Trial merge of ${source}: ${result}`,
    jobStillRunning: 'Still running. Cancel it first.',
    jobAlreadyRunning: 'A test run or trial merge is already running here.',

    // ---- monitor.ts
    statusProbeRunning: 'Trial merge running …',
    statusTestsRunning: 'Tests running …',
    statusProbeConflicts: 'Trial merge: conflicts',
    statusProbeError: 'Trial merge: error',
    statusProbeRed: 'Trial merge: failed',
    statusTestsError: 'Tests: error',
    statusTestsRed: 'Tests: failed',
    statusJobTooltip: (message: string) => `${message} Details in the Merge & Review panel.`,
    statusMergeReady: 'Merge ready to finish',
    statusConflictsOpen: (n: number) => `Merge: ${plural(n, 'conflict', 'conflicts')} open`,
    statusMergeTooltip: (source: string) => `Merge of ${source} in progress. Click to open Merge & Review.`
  }
})
