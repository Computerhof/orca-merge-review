// Styles for the review tab, built only from Orca's theme variables so light and dark both work.
export const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--orca-background); color: var(--orca-foreground);
  font-family: var(--orca-font-sans, system-ui, sans-serif); font-size: 13px; }
.app { display: flex; flex-direction: column; height: 100vh; }
.top { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--orca-border); }
.title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spacer { flex: 1; }
.muted { color: var(--orca-muted-foreground); }
.small { font-size: 11px; }
.pad { padding: 8px 12px; }
.badge { padding: 1px 8px; border-radius: 999px; background: var(--orca-muted); font-size: 11px; white-space: nowrap; }
.badge.ok { background: color-mix(in srgb, #2e9e5b 22%, transparent); }
.badge.warn { background: color-mix(in srgb, #d9a400 28%, transparent); }
.btn { font: inherit; padding: 4px 10px; border-radius: var(--orca-radius, 6px); cursor: pointer;
  border: 1px solid var(--orca-input); background: var(--orca-secondary); color: var(--orca-secondary-foreground); }
.btn:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.btn:focus-visible, .file:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.btn.primary { background: var(--orca-primary); color: var(--orca-primary-foreground); border-color: transparent; }
.btn.danger { background: var(--orca-destructive); color: var(--orca-destructive-foreground); border-color: transparent; }
main { flex: 1; min-height: 0; }
main.empty, .empty { display: grid; place-items: center; color: var(--orca-muted-foreground); padding: 24px; }
.split { display: grid; grid-template-columns: minmax(200px, 280px) 1fr; }
.files { overflow: auto; border-right: 1px solid var(--orca-border); padding-bottom: 12px; }
.group { padding: 10px 12px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--orca-muted-foreground); }
.file { display: flex; gap: 6px; align-items: baseline; width: 100%; padding: 3px 12px; border: 0; background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
.file:hover { background: var(--orca-accent); }
.file.current { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.file .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.mark { font-family: var(--orca-font-mono, monospace); width: 1.4em; }
.mark.warn { color: #d9a400; } .mark.ok { color: #2e9e5b; }
.commit { padding: 2px 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
code, pre, .code, .no { font-family: var(--orca-font-mono, ui-monospace, monospace); font-size: 12px; }
.content { overflow: auto; min-width: 0; }
.notice { margin: 10px 12px 0; padding: 8px 10px; border-radius: var(--orca-radius, 6px); background: var(--orca-muted); }
.notice.ok { background: color-mix(in srgb, #2e9e5b 18%, transparent); }
.notice.warn { background: color-mix(in srgb, #d9a400 20%, transparent); }
.notice.err { background: color-mix(in srgb, var(--orca-destructive) 25%, transparent); }
.filehead { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 8px 12px; background: var(--orca-card); border-bottom: 1px solid var(--orca-border); }
table.sbs { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.sbs td { padding: 0 6px; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
table.sbs td.no { width: 4.5em; text-align: right; color: var(--orca-muted-foreground); user-select: none; cursor: pointer; }
table.sbs td.code { width: calc(50% - 4.5em); }
td.code.old { background: color-mix(in srgb, #d2453a 10%, transparent); }
td.code.new { background: color-mix(in srgb, #2e9e5b 10%, transparent); }
tr.context td.code { background: none; }
td.code.void { background: var(--orca-muted); opacity: .5; }
tr.hunk td { padding: 4px 8px; color: var(--orca-muted-foreground); background: var(--orca-muted); }
.note { padding: 12px; border-top: 1px solid var(--orca-border); }
.note textarea { width: 100%; font: inherit; padding: 6px; border-radius: var(--orca-radius, 6px);
  border: 1px solid var(--orca-input); background: var(--orca-background); color: inherit; }
.row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.conflict { padding-bottom: 16px; }
.hunk-card { margin: 12px; border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px); background: var(--orca-card); padding: 10px; }
.hunk-title { font-weight: 600; margin-bottom: 8px; }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sides.three { grid-template-columns: 1fr 1fr 1fr; }
.side { border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px); overflow: hidden; min-width: 0; }
.side .label { padding: 4px 8px; font-size: 11px; color: var(--orca-muted-foreground); border-bottom: 1px solid var(--orca-border); }
.side pre { margin: 0; padding: 8px; overflow: auto; max-height: 360px; white-space: pre; }
.side.ours .label { background: color-mix(in srgb, #3b82f6 14%, transparent); }
.side.theirs .label { background: color-mix(in srgb, #a855f7 14%, transparent); }
.side.base .label { background: var(--orca-muted); }
footer { padding: 4px 12px; border-top: 1px solid var(--orca-border); }
`
