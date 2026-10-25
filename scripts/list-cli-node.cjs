const fs = require('fs')
const path = require('path')
const root = 'C:/Users/KhaLT_Lap_CM/AppData/Roaming/npm/node_modules/@opencode/cli/node_modules'
const out = []
for (const dir of fs.readdirSync(root)) {
  const sub = path.join(root, dir)
  let st
  try { st = fs.statSync(sub) } catch { continue }
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(sub)) out.push(dir + '/' + f)
  } else {
    out.push(dir)
  }
}
const hits = out.filter((n) => /\.(js|mjs|cjs)$/.test(n))
console.log('JS files:', hits.length)
console.log(hits.slice(0, 60).join('\n'))
fs.writeFileSync('C:/works/session-deck/session-deck/oclist.txt', hits.join('\n'))
