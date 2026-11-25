// Did an agent receive the prompt it was launched with? Orca sends a launch prompt "once the
// agent is ready", but an agent started from a plugin can sit at an empty input box (seen with
// Orca 1.4.273: Claude Code started in auto mode, the prompt never came). An agent that got its
// prompt starts working on it, and Orca reports that with `agent.status.changed`.

/** Agent states that mean it is busy with a prompt. */
export const isWorkState = (state: string) => state === 'working' || state === 'blocked'

/** How long a launched agent may take to start working before the panel says it got nothing. */
export const LAUNCH_DEADLINE_MS = 30_000
