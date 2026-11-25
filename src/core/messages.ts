// Every text the Orca-free core (core/, git/, run/) shows a person or hands to an agent, in both
// languages. Read at call time (`m.merged(source)`), never copied into a module-level constant,
// so a language change takes effect at once. The German texts are the originals: tests and users
// rely on their exact wording.
import { messages, plural } from '../i18n/index.ts'
import type { OperationKind } from '../types.ts'

// Names of what is under way, per language (plain data, not texts read at load time).
const DE_OP: Record<OperationKind, string> = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-Pick' }
const EN_OP: Record<OperationKind, string> = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick' }
const EN_OP_TITLE: Record<OperationKind, string> = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick' }
const DE_DURING: Record<OperationKind, string> = {
  merge: ' Es läuft ein Merge; der Mensch schließt ihn im Merge-&-Review-Panel ab oder bricht ihn dort ab.',
  rebase: ' Es läuft ein Rebase; der Mensch setzt ihn im Merge-&-Review-Panel fort oder bricht ihn dort ab.',
  'cherry-pick': ' Es läuft ein Cherry-Pick; der Mensch setzt ihn im Merge-&-Review-Panel fort oder bricht ihn dort ab.'
}
const EN_DURING: Record<OperationKind, string> = {
  merge: ' A merge is in progress; the human finishes or aborts it in the Merge & Review panel.',
  rebase: ' A rebase is in progress; the human continues or aborts it in the Merge & Review panel.',
  'cherry-pick': ' A cherry-pick is in progress; the human continues or aborts it in the Merge & Review panel.'
}
/** The commit Git is applying, for `git show` in an agent prompt. */
const STEP_HEAD: Record<'rebase' | 'cherry-pick', string> = { rebase: 'REBASE_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD' }

export const m = messages({
  de: {
    // ---- repo.ts: the label of a squash merge in progress, refusals, outcomes
    squashLabel: 'Squash-Merge',
    invalidBranchName: (ref: string) => `Ungültiger Branch-Name: "${ref}"`,
    notBranchOrCommit: (name: string) => `"${name}" ist kein Branch oder Commit in diesem Repository.`,
    mergeAlreadyRunning: 'Es läuft schon ein Merge. Erst abschließen oder abbrechen.',
    dirtyTree: (n: number) => `Der Arbeitsbaum hat ${n} nicht committete Änderung(en). Erst committen oder stashen.`,
    detachedHead: 'HEAD ist von keinem Branch ausgecheckt (detached). Erst einen Branch auschecken.',
    conflictFiles: (n: number) => `${n} Datei(en) mit Konflikten. Im Bereich „Konflikte“ auflösen.`,
    mergeNotPossible: (detail: string) => `Merge nicht möglich: ${detail}`,
    alreadyUpToDate: 'Schon aktuell, nichts zu mergen.',
    squashNoChanges: 'Squash brachte keine Änderungen.',
    squashCommitMessage: (source: string) => `Squash-Merge von ${source}`,
    squashed: (source: string) => `${source} als ein Commit übernommen.`,
    merged: (source: string) => `${source} gemergt.`,
    noMergeRunning: 'Es läuft kein Merge.',
    mergeRunningUseAbort: 'Es läuft ein Merge. Dafür „Merge abbrechen“ nutzen.',
    branchChangedSinceMerge: 'Seit dem Merge hat sich der Branch verändert. Rückgängig ist nicht mehr sicher möglich.',
    dirtyTreeShort: 'Der Arbeitsbaum hat nicht committete Änderungen. Erst committen oder stashen.',
    unresolvedFiles: (n: number, list: string) => `Noch ${n} ungelöste Datei(en): ${list}`,
    nothingToPark: 'Es gibt keine Änderungen zu parken.',
    noOpenConflict: (rel: string) => `"${rel}" hat keinen offenen Konflikt.`,
    notInWorkingTree: (rel: string) => `"${rel}" gibt es im Arbeitsbaum nicht.`,
    changedMeanwhile: (rel: string) => `"${rel}" hat sich inzwischen geändert. Die Ansicht wurde neu geladen; bitte erneut wählen.`,
    stillHasMarkers: (rel: string) => `"${rel}" enthält noch Konfliktmarker.`,
    invalidPath: (path: string) => `Ungültiger Pfad: "${path}"`,

    // ---- repo.ts: rebase and cherry-pick (E9–E12)
    opName: (kind: OperationKind) => DE_OP[kind],
    operationRunning: (kind: OperationKind) => `Es läuft schon ein ${DE_OP[kind]}. Erst fortsetzen oder abbrechen.`,
    operationRunningUseAbort: (kind: OperationKind) => `Es läuft ein ${DE_OP[kind]}. Dafür „Abbrechen“ nutzen.`,
    useContinue: (kind: OperationKind) => `Es läuft ein ${DE_OP[kind]}, kein Merge. Mit „Weiter“ geht es zum nächsten Commit.`,
    mergeUseFinish: 'Es läuft ein Merge. Dafür „Merge abschließen“ nutzen.',
    noStepOperation: 'Es läuft kein Rebase und kein Cherry-Pick.',
    operationNotPossible: (kind: OperationKind, detail: string) => `${DE_OP[kind]} nicht möglich: ${detail}`,
    opStopped: (kind: OperationKind, detail: string) => `${DE_OP[kind]} angehalten: ${detail}`,
    opEmpty: (kind: OperationKind) =>
      `Der Commit ist nach der Auflösung leer: Seine Änderung ist schon da. „Commit überspringen“ wählen oder den ${DE_OP[kind]} abbrechen.`,
    rebased: (onto: string) => `Rebase auf ${onto} abgeschlossen.`,
    rebaseUpToDate: (onto: string) => `Schon aktuell: Der Branch baut bereits auf ${onto} auf.`,
    picked: (n: number) => `${n} Commit(s) per Cherry-Pick übernommen.`,
    pickFinished: 'Cherry-Pick abgeschlossen.',
    commitSkipped: 'Commit übersprungen.',
    pickNothing: 'Keine Commits ausgewählt.',
    pickMergeCommit: (short: string) => `${short} ist ein Merge-Commit. Cherry-Pick übernimmt nur einfache Commits.`,
    pickAlreadyContained: (short: string) => `${short} ist schon im aktuellen Branch enthalten.`,

    // ---- conflicts.ts
    noBaseSection: 'Diese Datei enthält keinen Basis-Abschnitt (diff3).',
    conflictGone: (n: number) => `Konflikt ${n} gibt es in dieser Datei nicht (mehr).`,

    // ---- git/runner.ts, run/command.ts
    outputTooLarge: (cmd: string) => `git ${cmd}: Ausgabe zu groß (über 32 MB)`,
    tookTooLong: (cmd: string) => `git ${cmd} hat zu lange gebraucht und wurde abgebrochen`,
    gitNotStarted: (reason: string) => `git konnte nicht gestartet werden: ${reason}`,
    gitFailed: (cmd: string, code: number, detail: string) => `git ${cmd} fehlgeschlagen (Exit ${code}): ${detail}`,
    commandNotStarted: (reason: string) => `Konnte nicht starten: ${reason}`,

    // ---- run/probe.ts
    probeConflicts: (n: number) => `${n} Datei(en) mit Konflikten.`,
    probeClean: 'Merge geht sauber durch.',
    probePassed: 'Merge sauber, Tests grün.',
    probeTimedOut: 'Tests nach dem Zeitlimit abgebrochen.',
    probeCancelled: 'Abgebrochen.',
    probeRed: (exit: number | string) => `Tests rot (Exit ${exit}).`,

    // ---- gitGuard.ts: why an agent's Git call is refused (the agent reads it)
    guardBlocked: (why: string, during: OperationKind | null) =>
      `Merge & Review hat diesen Befehl blockiert: ${why}.${during ? DE_DURING[during] : ''}`,
    guardResetHard: (kind: OperationKind) => `git reset --hard verwirft den ${DE_OP[kind]} und alle Auflösungen`,
    guardResetMerge: (kind: OperationKind) => `git reset --merge bricht den ${DE_OP[kind]} ab`,
    guardMergeAbort: 'git merge --abort bricht den Merge ab',
    guardCheckoutForce: 'git checkout --force verwirft Auflösungen',
    guardWholeTree: 'Zurücksetzen des ganzen Arbeitsbaums verwirft Auflösungen',
    guardSwitchBranch: (kind: OperationKind) => `Branch-Wechsel mitten im ${DE_OP[kind]}`,
    guardCleanForce: 'git clean -f löscht Dateien',
    guardStash: (kind: OperationKind) => `git stash während eines ${DE_OP[kind]}s verliert den ${DE_OP[kind]}-Zustand`,
    guardRebase: (kind: OperationKind) => `Rebase mitten im ${DE_OP[kind]}`,
    guardCherryPick: (kind: OperationKind) => `Cherry-Pick mitten im ${DE_OP[kind]}`,
    guardOpControl: (command: string, kind: OperationKind) => `${command} greift in den laufenden ${DE_OP[kind]} ein`,
    guardForcePush: 'Force-Push überschreibt fremde Arbeit',

    // ---- prompts.ts: texts for agents
    feedbackHead: (source: string, target: string, where: string) =>
      `Review-Anmerkung aus Merge & Review (${source} → ${target})${where}:`,
    feedbackTail: 'Bitte umsetzen und committen. Kein Merge, kein Rebase, kein Push.',
    resolveIntro: (source: string, target: string) =>
      `In diesem Workspace läuft ein Merge von \`${source}\` in \`${target}\` mit Konflikten in:`,
    resolveTask: [
      'Aufgabe: Löse jeden Konflikt so auf, dass beide Absichten erhalten bleiben. Lies dazu die',
      'Commits beider Seiten (`git log --merge`, `git diff`). Prüfe danach mit den Tests des Projekts.',
      '',
      'Regeln:',
      '- Entferne alle Konfliktmarker; markiere gelöste Dateien mit `git add <datei>`.',
      '- Committe NICHT, brich den Merge NICHT ab, kein reset/stash/checkout des ganzen Baums.',
      '- Schreibe am Ende eine kurze Zusammenfassung pro Datei: was du wie entschieden hast.',
      'Der Mensch prüft deine Auflösung in Merge & Review und schließt den Merge selbst ab.'
    ].join('\n'),
    resolveStep: (current: number, total: number, commit: string) => ` (Commit ${current} von ${total}: ${commit})`,
    resolveIntroRebase: (onto: string, branch: string, step: string) =>
      `In diesem Workspace läuft ein Rebase von \`${branch}\` auf \`${onto}\`${step}, mit Konflikten in:`,
    resolveIntroPick: (commit: string, target: string, step: string) =>
      `In diesem Workspace läuft ein Cherry-Pick von \`${commit}\` auf \`${target}\`${step}, mit Konflikten in:`,
    resolveTaskStep: (kind: 'rebase' | 'cherry-pick') =>
      [
        'Aufgabe: Löse jeden Konflikt so auf, dass beide Absichten erhalten bleiben. Lies dazu den Commit, der gerade',
        `angewendet wird (\`git show ${STEP_HEAD[kind]}\`), und \`git diff\`. Prüfe danach mit den Tests des Projekts.`,
        ...(kind === 'rebase'
          ? ['Achtung: Beim Rebase steht „ours“/HEAD für die Basis, auf die rebased wird, und „theirs“ für den gerade angewendeten Commit.']
          : []),
        '',
        'Regeln:',
        '- Entferne alle Konfliktmarker; markiere gelöste Dateien mit `git add <datei>`.',
        `- Committe NICHT, setze den ${DE_OP[kind]} NICHT fort, überspringe und brich nichts ab (kein --continue/--skip/--abort),`,
        '  kein reset/stash/checkout des ganzen Baums.',
        '- Schreibe am Ende eine kurze Zusammenfassung pro Datei: was du wie entschieden hast.',
        `Der Mensch prüft deine Auflösung in Merge & Review und setzt den ${DE_OP[kind]} selbst fort.`
      ].join('\n'),
    watchLines: (base: string) =>
      [
        `Merge-Wächter (Merge & Review): Prüfe, ob sich \`${base}\` noch sauber in diesen Branch mergen lässt.`,
        '',
        `1. \`git fetch --quiet\` (falls ein Remote existiert).`,
        `2. \`git merge-tree --write-tree --name-only HEAD ${base}\` (bzw. den Remote-Branch, falls neuer).`,
        '3. Exit 0: antworte nur „sauber“ mit der Zahl neuer Commits auf der Base.',
        '   Exit 1: nenne die betroffenen Dateien und je in einem Satz, welche Commits kollidieren.',
        '',
        'Ändere nichts: kein Merge, kein Commit, kein Checkout, kein Push.'
      ].join('\n'),
    testFixAfterMerge: (source: string, target: string) => `Nach dem Merge von \`${source}\` in \`${target}\``,
    testFixOn: (target: string) => `Auf \`${target}\``,
    testFixHead: (what: string, command: string, exit: number | string) =>
      `${what} schlagen die Tests fehl (Merge & Review): \`${command}\` endete mit Exit ${exit}.`,
    testFixOutput: 'Letzte Ausgabe:',
    testFixTask: [
      'Aufgabe: Finde die Ursache und behebe sie, bis der Befehl grün ist. Committe die Korrektur als',
      'eigenen Commit mit einer kurzen Begründung.',
      'Regeln: Den Merge nicht rückgängig machen (kein reset, kein revert), kein Push, keine Tests abschalten.'
    ].join('\n'),
    hintOpen: (n: number) => `${n} Datei(en) haben noch Konflikte. `,
    hint: (tag: string, source: string, open: string) =>
      `${tag} In diesem Workspace läuft ein Merge von \`${source}\`. ${open}` +
      'Merge nicht abbrechen, nicht committen, kein reset/stash/checkout des ganzen Baums; ' +
      'gelöste Dateien nur mit `git add` markieren. Der Mensch schließt den Merge in Merge & Review ab.',
    hintStep: (tag: string, kind: 'rebase' | 'cherry-pick', source: string, open: string) =>
      `${tag} In diesem Workspace läuft ein ${DE_OP[kind]} ${kind === 'rebase' ? 'auf' : 'von'} \`${source}\`. ${open}` +
      `${DE_OP[kind]} nicht fortsetzen, nicht überspringen, nicht abbrechen (kein --continue/--skip/--abort), nicht committen, ` +
      'kein reset/stash/checkout des ganzen Baums; gelöste Dateien nur mit `git add` markieren. ' +
      `Der Mensch setzt den ${DE_OP[kind]} in Merge & Review fort.`,

    // ---- readiness.ts
    readyFastForward: '✓ Fast-forward',
    readyClean: '✓ konfliktfrei',
    readyConflicts: (n: number) => `⚠ ${n} Konflikt-Datei(en)`,
    readyUnrelated: 'keine gemeinsame Historie',
    readyUnknown: 'keine Vorhersage',
    readyIncluded: 'schon enthalten',

    // ---- reviewExport.ts: the Markdown export
    predUpToDate: 'Schon enthalten, nichts zu mergen.',
    predFastForward: 'Fast-forward möglich, keine Konflikte.',
    predUnrelated: 'Keine gemeinsame Historie; Git verweigert den Merge.',
    predUnknown: 'Keine Vorhersage (Git zu alt für merge-tree).',
    predClean: 'Konfliktfrei vorhergesagt.',
    predConflicts: (n: number, list: string) => `${n} Konflikt-Datei(en) erwartet: ${list}`,
    exportTitle: (source: string, target: string) => `# Review: ${source} → ${target}`,
    exportAsOf: (when: string) => `- Stand: ${when} UTC`,
    exportCounts: (commits: number, files: number, added: number, deleted: number) =>
      `- ${commits} Commit(s) kommen rein, ${files} Datei(en), +${added} −${deleted}`,
    exportBehind: (target: string, behind: number) => `; ${target} ist ${behind} Commit(s) weiter`,
    exportPrediction: (text: string) => `- Vorhersage: ${text}`,
    exportNotes: '## Anmerkungen',
    exportCommitsPartial: (shown: number, total: number) => `## Commits (neueste ${shown} von ${total})`,
    exportCommits: (total: number) => `## Commits (${total})`,
    exportFiles: (n: number) => `## Dateien (${n})`,
    exportTableHead: '| Art | Datei | ± |',
    exportBinary: 'binär',
    exportCreatedWith: (version: string) => `_Erstellt mit Merge & Review ${version}_`,
    exportSentToAgent: '_(an den Agenten gesendet)_',

    // ---- testDetect.ts: why a test command is suggested
    becausePackageScript: (name: string) => `package.json hat das Skript „${name}“`,
    becauseCargo: 'Rust-Projekt (Cargo.toml)',
    becauseGo: 'Go-Modul (go.mod)',
    becauseDeno: 'Deno-Projekt',
    becausePytestConfig: 'pytest-Konfiguration',
    becausePyproject: 'pyproject.toml nennt pytest',
    becauseDotnet: '.NET-Projekt',
    becauseMake: 'Makefile hat ein test-Ziel',
    becauseGradle: 'Gradle-Wrapper',
    becauseMaven: 'Maven-Projekt (pom.xml)'
  },
  en: {
    // ---- repo.ts
    squashLabel: 'Squash merge',
    invalidBranchName: (ref: string) => `Invalid branch name: "${ref}"`,
    notBranchOrCommit: (name: string) => `"${name}" is not a branch or commit in this repository.`,
    mergeAlreadyRunning: 'A merge is already in progress. Finish or abort it first.',
    dirtyTree: (n: number) => `The working tree has ${plural(n, 'uncommitted change', 'uncommitted changes')}. Commit or stash them first.`,
    detachedHead: 'HEAD is detached (no branch is checked out). Check out a branch first.',
    conflictFiles: (n: number) => `${plural(n, 'file', 'files')} with conflicts. Resolve them in the “Conflicts” section.`,
    mergeNotPossible: (detail: string) => `Merge not possible: ${detail}`,
    alreadyUpToDate: 'Already up to date, nothing to merge.',
    squashNoChanges: 'The squash brought no changes.',
    squashCommitMessage: (source: string) => `Squash merge of ${source}`,
    squashed: (source: string) => `${source} taken over as one commit.`,
    merged: (source: string) => `${source} merged.`,
    noMergeRunning: 'No merge is in progress.',
    mergeRunningUseAbort: 'A merge is in progress. Use “Abort merge” for that.',
    branchChangedSinceMerge: 'The branch has changed since the merge. Undoing it is no longer safe.',
    dirtyTreeShort: 'The working tree has uncommitted changes. Commit or stash them first.',
    unresolvedFiles: (n: number, list: string) => `${plural(n, 'file is', 'files are')} still unresolved: ${list}`,
    nothingToPark: 'There are no changes to park.',
    noOpenConflict: (rel: string) => `"${rel}" has no open conflict.`,
    notInWorkingTree: (rel: string) => `"${rel}" does not exist in the working tree.`,
    changedMeanwhile: (rel: string) => `"${rel}" has changed in the meantime. The view was reloaded; please choose again.`,
    stillHasMarkers: (rel: string) => `"${rel}" still contains conflict markers.`,
    invalidPath: (path: string) => `Invalid path: "${path}"`,

    // ---- repo.ts: rebase and cherry-pick
    opName: (kind: OperationKind) => EN_OP[kind],
    operationRunning: (kind: OperationKind) => `A ${EN_OP[kind]} is already in progress. Continue or abort it first.`,
    operationRunningUseAbort: (kind: OperationKind) => `A ${EN_OP[kind]} is in progress. Use “Abort” for that.`,
    useContinue: (kind: OperationKind) => `A ${EN_OP[kind]} is in progress, not a merge. “Continue” moves on to the next commit.`,
    mergeUseFinish: 'A merge is in progress. Use “Finish merge” for that.',
    noStepOperation: 'No rebase or cherry-pick is in progress.',
    operationNotPossible: (kind: OperationKind, detail: string) => `${EN_OP_TITLE[kind]} not possible: ${detail}`,
    opStopped: (kind: OperationKind, detail: string) => `${EN_OP_TITLE[kind]} stopped: ${detail}`,
    opEmpty: (kind: OperationKind) =>
      `The commit is empty after the resolution: its change is already there. Choose “Skip commit” or abort the ${EN_OP[kind]}.`,
    rebased: (onto: string) => `Rebased onto ${onto}.`,
    rebaseUpToDate: (onto: string) => `Already up to date: the branch is already based on ${onto}.`,
    picked: (n: number) => `${plural(n, 'commit', 'commits')} taken over by cherry-pick.`,
    pickFinished: 'Cherry-pick finished.',
    commitSkipped: 'Commit skipped.',
    pickNothing: 'No commits selected.',
    pickMergeCommit: (short: string) => `${short} is a merge commit. Cherry-pick only takes plain commits.`,
    pickAlreadyContained: (short: string) => `${short} is already in the current branch.`,

    // ---- conflicts.ts
    noBaseSection: 'This file has no base section (diff3).',
    conflictGone: (n: number) => `Conflict ${n} no longer exists in this file.`,

    // ---- git/runner.ts, run/command.ts
    outputTooLarge: (cmd: string) => `git ${cmd}: output too large (over 32 MB)`,
    tookTooLong: (cmd: string) => `git ${cmd} took too long and was stopped`,
    gitNotStarted: (reason: string) => `git could not be started: ${reason}`,
    gitFailed: (cmd: string, code: number, detail: string) => `git ${cmd} failed (exit ${code}): ${detail}`,
    commandNotStarted: (reason: string) => `Could not start: ${reason}`,

    // ---- run/probe.ts
    probeConflicts: (n: number) => `${plural(n, 'file', 'files')} with conflicts.`,
    probeClean: 'The merge goes through cleanly.',
    probePassed: 'Merge clean, tests green.',
    probeTimedOut: 'Tests stopped after the time limit.',
    probeCancelled: 'Cancelled.',
    probeRed: (exit: number | string) => `Tests failed (exit ${exit}).`,

    // ---- gitGuard.ts
    guardBlocked: (why: string, during: OperationKind | null) =>
      `Merge & Review blocked this command: ${why}.${during ? EN_DURING[during] : ''}`,
    guardResetHard: (kind: OperationKind) => `git reset --hard discards the ${EN_OP[kind]} and every resolution`,
    guardResetMerge: (kind: OperationKind) => `git reset --merge aborts the ${EN_OP[kind]}`,
    guardMergeAbort: 'git merge --abort aborts the merge',
    guardCheckoutForce: 'git checkout --force discards resolutions',
    guardWholeTree: 'Resetting the whole working tree discards resolutions',
    guardSwitchBranch: (kind: OperationKind) => `Switching branches in the middle of a ${EN_OP[kind]}`,
    guardCleanForce: 'git clean -f deletes files',
    guardStash: (kind: OperationKind) => `git stash during a ${EN_OP[kind]} loses the ${EN_OP[kind]} state`,
    guardRebase: (kind: OperationKind) => `Rebasing in the middle of a ${EN_OP[kind]}`,
    guardCherryPick: (kind: OperationKind) => `Cherry-picking in the middle of a ${EN_OP[kind]}`,
    guardOpControl: (command: string, kind: OperationKind) => `${command} interferes with the ${EN_OP[kind]} in progress`,
    guardForcePush: "Force-pushing overwrites other people's work",

    // ---- prompts.ts
    feedbackHead: (source: string, target: string, where: string) =>
      `Review note from Merge & Review (${source} → ${target})${where}:`,
    feedbackTail: 'Please implement it and commit. No merge, no rebase, no push.',
    resolveIntro: (source: string, target: string) =>
      `A merge of \`${source}\` into \`${target}\` is in progress in this workspace, with conflicts in:`,
    resolveTask: [
      'Task: Resolve every conflict so that both intentions are kept. Read the commits',
      'of both sides (`git log --merge`, `git diff`). Then check with the project\'s tests.',
      '',
      'Rules:',
      '- Remove all conflict markers; mark resolved files with `git add <file>`.',
      '- Do NOT commit, do NOT abort the merge, no reset/stash/checkout of the whole tree.',
      '- At the end, write a short summary per file: what you decided and how.',
      'The human reviews your resolution in Merge & Review and finishes the merge themselves.'
    ].join('\n'),
    resolveStep: (current: number, total: number, commit: string) => ` (commit ${current} of ${total}: ${commit})`,
    resolveIntroRebase: (onto: string, branch: string, step: string) =>
      `A rebase of \`${branch}\` onto \`${onto}\`${step} is in progress in this workspace, with conflicts in:`,
    resolveIntroPick: (commit: string, target: string, step: string) =>
      `A cherry-pick of \`${commit}\` onto \`${target}\`${step} is in progress in this workspace, with conflicts in:`,
    resolveTaskStep: (kind: 'rebase' | 'cherry-pick') =>
      [
        'Task: Resolve every conflict so that both intentions are kept. Read the commit being',
        `applied (\`git show ${STEP_HEAD[kind]}\`) and \`git diff\`. Then check with the project's tests.`,
        ...(kind === 'rebase'
          ? ['Note: during a rebase, "ours"/HEAD is the base being rebased onto and "theirs" the commit being applied.']
          : []),
        '',
        'Rules:',
        '- Remove all conflict markers; mark resolved files with `git add <file>`.',
        `- Do NOT commit, do NOT continue, skip or abort the ${EN_OP[kind]} (no --continue/--skip/--abort),`,
        '  no reset/stash/checkout of the whole tree.',
        '- At the end, write a short summary per file: what you decided and how.',
        `The human reviews your resolution in Merge & Review and continues the ${EN_OP[kind]} themselves.`
      ].join('\n'),
    watchLines: (base: string) => [
      `Merge watch (Merge & Review): Check whether \`${base}\` still merges cleanly into this branch.`,
      '',
      `1. \`git fetch --quiet\` (if a remote exists).`,
      `2. \`git merge-tree --write-tree --name-only HEAD ${base}\` (or the remote branch, if it is newer).`,
      '3. Exit 0: answer only "clean" with the number of new commits on the base.',
      '   Exit 1: name the affected files and, in one sentence each, which commits collide.',
      '',
      'Change nothing: no merge, no commit, no checkout, no push.'
    ].join('\n'),
    testFixAfterMerge: (source: string, target: string) => `After merging \`${source}\` into \`${target}\``,
    testFixOn: (target: string) => `On \`${target}\``,
    testFixHead: (what: string, command: string, exit: number | string) =>
      `${what}, the tests fail (Merge & Review): \`${command}\` ended with exit ${exit}.`,
    testFixOutput: 'Last output:',
    testFixTask: [
      'Task: Find the cause and fix it until the command is green. Commit the fix as its',
      'own commit with a short explanation.',
      'Rules: Do not undo the merge (no reset, no revert), no push, do not switch tests off.'
    ].join('\n'),
    hintOpen: (n: number) => `${plural(n, 'file still has', 'files still have')} conflicts. `,
    hint: (tag: string, source: string, open: string) =>
      `${tag} A merge of \`${source}\` is in progress in this workspace. ${open}` +
      'Do not abort the merge, do not commit, no reset/stash/checkout of the whole tree; ' +
      'mark resolved files only with `git add`. The human finishes the merge in Merge & Review.',
    hintStep: (tag: string, kind: 'rebase' | 'cherry-pick', source: string, open: string) =>
      `${tag} A ${EN_OP[kind]} ${kind === 'rebase' ? 'onto' : 'of'} \`${source}\` is in progress in this workspace. ${open}` +
      `Do not continue, skip or abort the ${EN_OP[kind]} (no --continue/--skip/--abort), do not commit, ` +
      'no reset/stash/checkout of the whole tree; mark resolved files only with `git add`. ' +
      `The human continues the ${EN_OP[kind]} in Merge & Review.`,

    // ---- readiness.ts
    readyFastForward: '✓ Fast-forward',
    readyClean: '✓ conflict-free',
    readyConflicts: (n: number) => `⚠ ${plural(n, 'conflicting file', 'conflicting files')}`,
    readyUnrelated: 'no common history',
    readyUnknown: 'no prediction',
    readyIncluded: 'already included',

    // ---- reviewExport.ts
    predUpToDate: 'Already included, nothing to merge.',
    predFastForward: 'Fast-forward possible, no conflicts.',
    predUnrelated: 'No common history; Git refuses the merge.',
    predUnknown: 'No prediction (Git too old for merge-tree).',
    predClean: 'Predicted conflict-free.',
    predConflicts: (n: number, list: string) => `${plural(n, 'conflicting file', 'conflicting files')} expected: ${list}`,
    exportTitle: (source: string, target: string) => `# Review: ${source} → ${target}`,
    exportAsOf: (when: string) => `- As of: ${when} UTC`,
    exportCounts: (commits: number, files: number, added: number, deleted: number) =>
      `- ${plural(commits, 'commit', 'commits')} coming in, ${plural(files, 'file', 'files')}, +${added} −${deleted}`,
    exportBehind: (target: string, behind: number) => `; ${target} is ${plural(behind, 'commit', 'commits')} ahead`,
    exportPrediction: (text: string) => `- Prediction: ${text}`,
    exportNotes: '## Notes',
    exportCommitsPartial: (shown: number, total: number) => `## Commits (latest ${shown} of ${total})`,
    exportCommits: (total: number) => `## Commits (${total})`,
    exportFiles: (n: number) => `## Files (${n})`,
    exportTableHead: '| Type | File | ± |',
    exportBinary: 'binary',
    exportCreatedWith: (version: string) => `_Created with Merge & Review ${version}_`,
    exportSentToAgent: '_(sent to the agent)_',

    // ---- testDetect.ts
    becausePackageScript: (name: string) => `package.json has the script “${name}”`,
    becauseCargo: 'Rust project (Cargo.toml)',
    becauseGo: 'Go module (go.mod)',
    becauseDeno: 'Deno project',
    becausePytestConfig: 'pytest configuration',
    becausePyproject: 'pyproject.toml mentions pytest',
    becauseDotnet: '.NET project',
    becauseMake: 'Makefile has a test target',
    becauseGradle: 'Gradle wrapper',
    becauseMaven: 'Maven project (pom.xml)'
  }
})
