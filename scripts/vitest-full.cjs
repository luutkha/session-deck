// Runs the full unit suite synchronously (launched detached via run-e2e-detached.cjs so a server restart
// cannot abort it). Log: scripts/vitest-full-last.log
require('node:child_process').execSync('npx vitest run', { stdio: 'inherit', cwd: require('node:path').join(__dirname, '..') })
