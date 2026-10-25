const fs = require('fs')
const p = 'C:/Users/KhaLT_Lap_CM/AppData/Roaming/npm/node_modules/@opencode/cli/bin/opencode.exe'
const buf = fs.readFileSync(p)
const text = buf.toString('latin1')
const names = new Set()
for (const m of text.matchAll(/OPENCODE_[A-Z0-9_]+/g)) names.add(m[0])
console.log([...names].sort().join('\n'))
