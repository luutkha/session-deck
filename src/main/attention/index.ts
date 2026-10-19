export {
  createHookServer,
  type HookServer,
  type CreateHookServerOptions
} from './HookServer'

export {
  hookCommand,
  statusLineCommand,
  buildClaudeSettings,
  writeSettingsFile
} from './claudeSettings'

export {
  createIdleDetector,
  type IdleDetector,
  type IdleDetectorOptions,
  type IdleDetectorTimers
} from './IdleDetector'

export {
  createAttentionManager,
  type AttentionManager
} from './AttentionManager'

export {
  createNotifier,
  type Notifier,
  type NotifierDeps
} from './Notifier'

export {
  createAttentionService,
  type AttentionService,
  type AttentionServiceDeps
} from './AttentionService'