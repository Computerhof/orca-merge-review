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
