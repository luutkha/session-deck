/** One extra coding-agent CLI that SessionDeck can launch in a terminal (D92). */
export interface CliAgentDef {
  readonly id: string
  readonly label: string
  readonly badge: string
  readonly command: string
  readonly args: readonly string[]
  readonly yoloArgs: readonly string[]
  readonly yoloEnv: Readonly<Record<string, string>>
  readonly installHint: string
}

/**
 * Extra CLI agents, copied from Orca's TUI agent catalog. Claude, Cursor and both
 * OpenCode variants are excluded because SessionDeck already launches them natively.
 */
export const CLI_AGENTS: readonly CliAgentDef[] = [
  {
    id: 'codex',
    label: 'Codex',
    badge: 'CDX',
    command: 'codex',
    args: [],
    yoloArgs: ['--dangerously-bypass-approvals-and-sandbox'],
    yoloEnv: {},
    installHint: 'Install Codex: curl -fsSL https://chatgpt.com/codex/install.sh | sh'
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    badge: 'CPL',
    command: 'copilot',
    args: [],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install GitHub Copilot: curl -fsSL https://gh.io/copilot-install | bash'
  },
  {
    id: 'grok',
    label: 'Grok',
    badge: 'GRK',
    command: 'grok',
    args: [],
    yoloArgs: ['--permission-mode', 'bypassPermissions'],
    yoloEnv: {},
    installHint: 'Install the grok CLI and make sure it is on PATH.'
  },
  {
    id: 'qwen-code',
    label: 'Qwen Code',
    badge: 'QWN',
    command: 'qwen',
    args: [],
    yoloArgs: ['--approval-mode', 'yolo'],
    yoloEnv: {},
    installHint:
      'Install Qwen Code: curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash'
  },
  {
    id: 'kimi',
    label: 'Kimi',
    badge: 'KIM',
    command: 'kimi',
    args: [],
    yoloArgs: ['--auto'],
    yoloEnv: {},
    installHint: 'Install Kimi: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash'
  },
  {
    id: 'droid',
    label: 'Droid',
    badge: 'DRD',
    command: 'droid',
    args: [],
    yoloArgs: ['--auto', 'high'],
    yoloEnv: {},
    installHint: 'Install Droid: curl -fsSL https://app.factory.ai/cli | sh'
  },
  {
    id: 'devin',
    label: 'Devin',
    badge: 'DVN',
    command: 'devin',
    args: [],
    yoloArgs: ['--permission-mode', 'bypass', '--respect-workspace-trust', 'false'],
    yoloEnv: {},
    installHint: 'Install Devin: curl -fsSL https://cli.devin.ai/install.sh | bash'
  },
  {
    id: 'kiro',
    label: 'Kiro',
    badge: 'KIR',
    command: 'kiro-cli',
    args: ['chat', '--tui'],
    yoloArgs: ['--trust-all-tools'],
    yoloEnv: {},
    installHint: 'Install Kiro: curl -fsSL https://cli.kiro.dev/install | bash'
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    badge: 'AGY',
    command: 'agy',
    args: [],
    yoloArgs: ['--dangerously-skip-permissions'],
    yoloEnv: {},
    installHint: 'Install the agy CLI and make sure it is on PATH.'
  },
  {
    id: 'aider',
    label: 'Aider',
    badge: 'AID',
    command: 'aider',
    args: [],
    yoloArgs: ['--yes-always'],
    yoloEnv: {},
    installHint: 'Install the aider CLI and make sure it is on PATH.'
  },
  {
    id: 'amp',
    label: 'Amp',
    badge: 'AMP',
    command: 'amp',
    args: [],
    yoloArgs: ['--dangerously-allow-all'],
    yoloEnv: {},
    installHint: 'Install the amp CLI and make sure it is on PATH.'
  },
  {
    id: 'ante',
    label: 'Ante',
    badge: 'ANT',
    command: 'ante',
    args: [],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install the ante CLI and make sure it is on PATH.'
  },
  {
    id: 'aug',
    label: 'Auggie',
    badge: 'AUG',
    command: 'auggie',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install Auggie: npm install -g @augmentcode/auggie'
  },
  {
    id: 'autohand',
    label: 'Autohand Code',
    badge: 'AUH',
    command: 'autohand',
    args: [],
    yoloArgs: ['--unrestricted'],
    yoloEnv: {},
    installHint: 'Install the autohand CLI and make sure it is on PATH.'
  },
  {
    id: 'cline',
    label: 'Cline',
    badge: 'CLN',
    command: 'cline',
    args: [],
    yoloArgs: ['--auto-approve', 'true'],
    yoloEnv: {},
    installHint: 'Install Cline: npm install -g cline'
  },
  {
    id: 'codebuddy',
    label: 'CodeBuddy',
    badge: 'CBD',
    command: 'codebuddy',
    args: [],
    yoloArgs: ['--dangerously-skip-permissions'],
    yoloEnv: {},
    installHint: 'Install CodeBuddy: npm install -g @tencent-ai/codebuddy-code'
  },
  {
    id: 'codebuff',
    label: 'Codebuff',
    badge: 'CBF',
    command: 'codebuff',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the codebuff CLI and make sure it is on PATH.'
  },
  {
    id: 'command-code',
    label: 'Command Code',
    badge: 'CMD',
    command: 'command-code',
    args: ['--trust'],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install the command-code CLI and make sure it is on PATH.'
  },
  {
    id: 'continue',
    label: 'Continue',
    badge: 'CNU',
    command: 'cn',
    args: [],
    yoloArgs: ['--allow', '*'],
    yoloEnv: {},
    installHint: 'Install the cn CLI and make sure it is on PATH.'
  },
  {
    id: 'crush',
    label: 'Charm',
    badge: 'CRS',
    command: 'crush',
    args: [],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install the crush CLI and make sure it is on PATH.'
  },
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    badge: 'DSH',
    command: 'dsh-tui',
    args: ['.'],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the dsh-tui CLI and make sure it is on PATH.'
  },
  {
    id: 'freebuff',
    label: 'Freebuff',
    badge: 'FBF',
    command: 'freebuff',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the freebuff CLI and make sure it is on PATH.'
  },
  {
    id: 'goose',
    label: 'Goose',
    badge: 'GOS',
    command: 'goose',
    args: [],
    yoloArgs: [],
    yoloEnv: { GOOSE_MODE: 'auto' },
    installHint:
      'Install Goose: curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash'
  },
  {
    id: 'hermes',
    label: 'Hermes Agent',
    badge: 'HRM',
    command: 'hermes',
    args: ['--tui'],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install Hermes Agent: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
  },
  {
    id: 'jcode',
    label: 'Jcode',
    badge: 'JCD',
    command: 'jcode',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the jcode CLI and make sure it is on PATH.'
  },
  {
    id: 'kilo',
    label: 'Kilocode',
    badge: 'KIL',
    command: 'kilo',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install Kilocode: curl -fsSL https://kilo.ai/cli/install | bash'
  },
  {
    id: 'mimo-code',
    label: 'MiMo Code',
    badge: 'MIM',
    command: 'mimo',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install MiMo Code: curl -fsSL https://mimo.xiaomi.com/install | bash'
  },
  {
    id: 'mistral-vibe',
    label: 'Mistral Vibe',
    badge: 'MSV',
    command: 'vibe',
    args: [],
    yoloArgs: ['--agent', 'auto-approve'],
    yoloEnv: {},
    installHint: 'Install the vibe CLI and make sure it is on PATH.'
  },
  {
    id: 'muse',
    label: 'Muse',
    badge: 'MUS',
    command: 'muse',
    args: ['--trust-workspace'],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install the muse CLI and make sure it is on PATH.'
  },
  {
    id: 'omp',
    label: 'OMP',
    badge: 'OMP',
    command: 'omp',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the omp CLI and make sure it is on PATH.'
  },
  {
    id: 'openclaude',
    label: 'OpenClaude',
    badge: 'OPC',
    command: 'openclaude',
    args: [],
    yoloArgs: ['--dangerously-skip-permissions'],
    yoloEnv: {},
    installHint: 'Install the openclaude CLI and make sure it is on PATH.'
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    badge: 'OPL',
    command: 'openclaw',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the openclaw CLI and make sure it is on PATH.'
  },
  {
    id: 'pi',
    label: 'Pi',
    badge: 'PI',
    command: 'pi',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the pi CLI and make sure it is on PATH.'
  },
  {
    id: 'prime-agent',
    label: 'Prime Agent',
    badge: 'PRA',
    command: 'prime-agent',
    args: [],
    yoloArgs: [],
    yoloEnv: {},
    installHint: 'Install the prime-agent CLI and make sure it is on PATH.'
  },
  {
    id: 'qoder',
    label: 'Qoder CLI',
    badge: 'QDR',
    command: 'qodercli',
    args: [],
    yoloArgs: ['--dangerously-skip-permissions'],
    yoloEnv: {},
    installHint: 'Install the qodercli CLI and make sure it is on PATH.'
  },
  {
    id: 'qoder-cn',
    label: 'Qoder CLI China',
    badge: 'QCN',
    command: 'qoderclicn',
    args: [],
    yoloArgs: ['--dangerously-skip-permissions'],
    yoloEnv: {},
    installHint: 'Install the qoderclicn CLI and make sure it is on PATH.'
  },
  {
    id: 'rovo',
    label: 'Rovo Dev',
    badge: 'RVO',
    command: 'acli',
    args: ['rovodev', 'run'],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install the acli CLI and make sure it is on PATH.'
  },
  {
    id: 'trae',
    label: 'Trae',
    badge: 'TRA',
    command: 'traecli',
    args: [],
    yoloArgs: ['--yolo'],
    yoloEnv: {},
    installHint: 'Install the traecli CLI and make sure it is on PATH.'
  },
  {
    id: 'zcode',
    label: 'ZCode',
    badge: 'ZCD',
    command: 'zcode',
    args: [],
    yoloArgs: ['--mode', 'yolo'],
    yoloEnv: {},
    installHint: 'Install the zcode CLI and make sure it is on PATH.'
  }
]

/** Look up one CLI agent by its stable Orca id, or undefined when the id is unknown. */
export function cliAgentById(id: string | undefined): CliAgentDef | undefined {
  return CLI_AGENTS.find((def) => def.id === id)
}

/** True when the value names an agent in the registry (not a native SessionDeck agent). */
export function isCliAgentId(id: unknown): id is string {
  return typeof id === 'string' && CLI_AGENTS.some((def) => def.id === id)
}

/** The full argv tail for a launch: fixed command arguments followed by the yolo arguments. */
export function cliLaunchArgs(def: CliAgentDef): readonly string[] {
  return [...def.args, ...def.yoloArgs]
}
