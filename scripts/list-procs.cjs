// Lists opencode.exe / node.exe / electron.exe with pid, start time, command line (short).
const { execSync } = require('node:child_process')
const out = execSync(
  'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @(\'opencode.exe\',\'node.exe\',\'electron.exe\') } | Select-Object ProcessId,CreationDate,Name,CommandLine | ConvertTo-Json -Depth 2"',
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }
)
const list = JSON.parse(out.trim() || '[]')
for (const p of Array.isArray(list) ? list : [list]) {
  console.log(p.ProcessId, p.CreationDate, p.Name, String(p.CommandLine ?? '').slice(0, 160))
}
