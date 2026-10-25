// Prints author name/email of recent commits.
const { execFileSync } = require('node:child_process')
const out = execFileSync('git', ['-C', require('node:path').join(__dirname, '..'), 'log', '-5', '--format=%an|%ae'], { encoding: 'utf8' })
console.log(out)
