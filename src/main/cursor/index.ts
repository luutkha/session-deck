// Public surface of the Cursor CLI integration (D81): binary detection, the hook bridge script and hooks.json.
export {
  CURSOR_INSTALL_HINT,
  detectCursorCommand,
  resetCursorCommandCache,
  setCursorCommandRunnerForTests,
  type CursorCommand,
  type CursorCommandRunner
} from './command'

export {
  CURSOR_HOOK_MARKER,
  CURSOR_HOOK_SCRIPT,
  CURSOR_HOOK_SCRIPT_FILE,
  writeCursorHookScript
} from './hookScript'

export {
  CURSOR_HOOK_EVENTS,
  CURSOR_HOOK_TIMEOUT_SECONDS,
  CURSOR_HOOKS_FILE,
  cursorConfigDir,
  cursorHookCommand,
  installCursorHooks,
  mergeCursorHooks,
  type CursorHookCommands,
  type CursorHookEvent
} from './hooksFile'
