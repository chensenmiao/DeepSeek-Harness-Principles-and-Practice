/**
 * dsh-open-editor — Host (node) half.
 *
 * Registers the `/open-editor` slash command. The browser button (lib/client.js)
 * triggers it through the existing `commands` Remote namespace. The handler
 * resolves the calling session's working directory (`agent.session.header.cwd`)
 * and launches the user's `code` CLI (VS Code / Qoder / Cursor — whatever
 * `code` resolves to on PATH) in that directory.
 *
 * Launch strategy that actually works across platforms:
 *   - Resolve the executable with `subprocess.resolveExecutable`.
 *   - Windows resolves `code` to a `.cmd`/`.bat` shim, which cannot be spawned
 *     directly (EINVAL); route those through `cmd.exe /d /c` so the CLI runs.
 *   - Spawn non-blocking (we never await editor exit), so the web GUI never
 *     blocks on the editor process.
 */

/** Spawn `code <target>`, wrapping .cmd/.bat shims through cmd.exe (Windows). */
function launchEditor(subprocess, target) {
  return subprocess.resolveExecutable('code')
    .then((code) => {
      const lower = String(code).toLowerCase()
      const isCmdShim = lower.endsWith('.cmd') || lower.endsWith('.bat')
      const argv = isCmdShim
        ? ['cmd.exe', '/d', '/c', code, target]
        : [code, target]
      try {
        const handle = subprocess.spawn({
          argv,
          cwd: target,
          stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
          graceMs: 5000,
        })
        return { ok: true, pid: handle.pid }
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
    })
    .catch((err) => ({ ok: false, error: String(err && err.message ? err.message : err) }))
}

/** Cordis plugin identity. */
export const name = 'dsh-open-editor'
/** Hard dependencies: wait for `commands` (and `subprocess`) before apply runs. */
export const inject = ['commands', 'subprocess']

/** Register the `/open-editor` command. */
export function apply(ctx) {
  ctx.commands.register({
    name: 'open-editor',
    description: 'Open the session working directory in your local editor (VS Code / Qoder / code CLI)',
    handler: async (invocation) => {
      const target = invocation.agent?.session?.header?.cwd
      if (!target) {
        return { kind: 'error', text: 'open-editor: no session working directory to open' }
      }
      const result = await launchEditor(ctx.subprocess, target)
      if (!result.ok) {
        return { kind: 'error', text: `open-editor: ${result.error}` }
      }
      return { kind: 'success', text: `Editor opened in ${target}` }
    },
  })
}

export default { name, inject, apply }
