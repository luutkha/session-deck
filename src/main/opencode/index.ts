import { PLUGIN_DIR_NAME, buildOpencodePluginSource } from './pluginSource'
import { applyConfigPatch, opencodePluginEnv, OPENCODE_PLUGIN_ENV_VAR } from './pluginEnv'
import {
  getOpencodeInfo,
  opencodeSupportsStandalone,
  parseOpencodeVersion,
  parseSupportsStandalone,
  probeOpencode,
  recheckOpencode,
  warmOpencodeProbe
} from './capabilities'
import { writeOpencodePlugin } from './writePlugin'

export {
  PLUGIN_DIR_NAME,
  applyConfigPatch,
  buildOpencodePluginSource,
  getOpencodeInfo,
  opencodePluginEnv,
  opencodeSupportsStandalone,
  OPENCODE_PLUGIN_ENV_VAR,
  parseOpencodeVersion,
  parseSupportsStandalone,
  probeOpencode,
  recheckOpencode,
  warmOpencodeProbe,
  writeOpencodePlugin
}
