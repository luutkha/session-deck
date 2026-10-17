import { appendFileSync } from 'node:fs'
export const SpikePlugin = async ({ directory }) => {
  const log = (x) => appendFileSync(process.env.SPIKE_LOG, JSON.stringify(x) + '\n')
  log({ loaded: true, directory, tag: process.env.SESSIONDECK_SESSION_ID })
  return { event: async ({ event }) => { log({ type: event.type, props: event.properties ?? null }) } }
}
