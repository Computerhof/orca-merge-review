// The texts the plugin hands to agents. Pure functions, so they are tested and reviewed like code.
// Agents read these as instructions: keep them short, concrete and free of anything secret.

export function reviewFeedbackPrompt(input: {
  target: string
  source: string
  path?: string
  note: string
}): string {
  const where = input.path ? ` in \`${input.path}\`` : ''
  return [
    `Review-Anmerkung aus Merge & Review (${input.source} → ${input.target})${where}:`,
    '',
    input.note.trim(),
    '',
    'Bitte umsetzen und committen. Kein Merge, kein Rebase, kein Push.'
  ].join('\n')
}

export function resolveConflictsPrompt(input: {
  target: string
  source: string
  files: readonly string[]
}): string {
  return [
    `In diesem Workspace läuft ein Merge von \`${input.source}\` in \`${input.target}\` mit Konflikten in:`,
    ...input.files.map((f) => `- ${f}`),
    '',
    'Aufgabe: Löse jeden Konflikt so auf, dass beide Absichten erhalten bleiben. Lies dazu die',
    'Commits beider Seiten (`git log --merge`, `git diff`). Prüfe danach mit den Tests des Projekts.',
    '',
    'Regeln:',
    '- Entferne alle Konfliktmarker; markiere gelöste Dateien mit `git add <datei>`.',
    '- Committe NICHT, brich den Merge NICHT ab, kein reset/stash/checkout des ganzen Baums.',
    '- Schreibe am Ende eine kurze Zusammenfassung pro Datei: was du wie entschieden hast.',
    'Der Mensch prüft deine Auflösung in Merge & Review und schließt den Merge selbst ab.'
  ].join('\n')
}

export function mergeWatchPrompt(input: { base: string }): string {
  return [
    `Merge-Wächter (Merge & Review): Prüfe, ob sich \`${input.base}\` noch sauber in diesen Branch mergen lässt.`,
    '',
    `1. \`git fetch --quiet\` (falls ein Remote existiert).`,
    `2. \`git merge-tree --write-tree --name-only HEAD ${input.base}\` (bzw. den Remote-Branch, falls neuer).`,
    '3. Exit 0: antworte nur „sauber“ mit der Zahl neuer Commits auf der Base.',
    '   Exit 1: nenne die betroffenen Dateien und je in einem Satz, welche Commits kollidieren.',
    '',
    'Ändere nichts: kein Merge, kein Commit, kein Checkout, kein Push.'
  ].join('\n')
}

/** K11: tests went red after a merge; the agent finds and fixes the cause on top of the merge. */
export function testFixPrompt(input: {
  target: string
  source: string | null
  command: string
  exitCode: number | null
  tail: readonly string[]
}): string {
  const what = input.source ? `Nach dem Merge von \`${input.source}\` in \`${input.target}\`` : `Auf \`${input.target}\``
  return [
    `${what} schlagen die Tests fehl (Merge & Review): \`${input.command}\` endete mit Exit ${input.exitCode ?? '?'}.`,
    '',
    'Letzte Ausgabe:',
    '```',
    ...input.tail.slice(-40),
    '```',
    '',
    'Aufgabe: Finde die Ursache und behebe sie, bis der Befehl grün ist. Committe die Korrektur als',
    'eigenen Commit mit einer kurzen Begründung.',
    'Regeln: Den Merge nicht rückgängig machen (kein reset, kein revert), kein Push, keine Tests abschalten.'
  ].join('\n')
}

/** Marks text the plugin itself put in front of a prompt, so it is never added twice. */
export const MERGE_HINT_TAG = '[Merge & Review]'

/**
 * One line put in front of any prompt that reaches an agent in a workspace with a running merge.
 * One line on purpose: a prompt typed into a running agent's TUI is submitted on Enter.
 */
export function mergeHintPrompt(input: { source: string; open: number }): string {
  const open = input.open ? `${input.open} Datei(en) haben noch Konflikte. ` : ''
  return (
    `${MERGE_HINT_TAG} In diesem Workspace läuft ein Merge von \`${input.source}\`. ${open}` +
    'Merge nicht abbrechen, nicht committen, kein reset/stash/checkout des ganzen Baums; ' +
    'gelöste Dateien nur mit `git add` markieren. Der Mensch schließt den Merge in Merge & Review ab.'
  )
}
