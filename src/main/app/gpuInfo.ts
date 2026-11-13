// GPU detection for the terminal renderer (no-GPU support, part 1: main process).
// Pure rules only: Chromium's feature status plus its device list become 'hardware' | 'software' | 'unknown', so the
// renderer (part 2) can pick xterm's renderer and a reduced-effects mode. The IO lives in index.ts, which reads
// app.getGPUFeatureStatus() and app.getGPUInfo('basic').
import { isRecord } from '../../shared/guards'
import type { GpuInfo } from '../../shared/types'

// The contract types live in shared/types.ts (the renderer reads them); re-exported here so a main-process caller
// only needs this module.
export type { GpuInfo, GpuMode } from '../../shared/types'

/** One entry of the `gpuDevice` array of app.getGPUInfo('basic'). All fields are optional because Electron types the
 *  whole object as `unknown`; Chromium reports decimal vendor/device ids (0x10DE = 4318). */
export interface GpuDevice {
  readonly vendorId?: number
  readonly deviceId?: number
  readonly deviceString?: string
  readonly driverVendor?: string
  /** Chromium marks the adapter that actually renders with `active: true`. */
  readonly active?: boolean
}

export interface GpuClassificationInput {
  /** app.getGPUFeatureStatus(), e.g. { webgl: 'enabled', gpu_compositing: 'disabled_software', ... }. */
  readonly featureStatus: Record<string, string> | null
  /** app.getGPUInfo('basic').gpuDevice, parsed by parseGpuDevices. */
  readonly devices: readonly GpuDevice[]
  /** We (or the user's flag) turned the GPU process off for this run. */
  readonly accelerationDisabled: boolean
}

/** Google SwiftShader: Chromium's CPU rasteriser, the only "GPU" on a PC or VM without one. */
const VENDOR_GOOGLE = 0x1ae0
const VENDOR_MICROSOFT = 0x1414
/** Microsoft Basic Render Driver (WARP), the fallback adapter of a Windows machine without a usable GPU driver. */
const DEVICE_MICROSOFT_BASIC_RENDER = 0x8c

/** Device strings that name a software renderer even when the vendor id is not one of the known ones. */
const SOFTWARE_DEVICE_RE = /swiftshader|basic render|llvmpipe|software/i

/** Vendor names for the renderer text when Chromium gives no deviceString. */
const VENDOR_NAMES: Readonly<Record<number, string>> = {
  0x10de: 'NVIDIA',
  0x1002: 'AMD',
  0x8086: 'Intel',
  0x106b: 'Apple',
  0x5143: 'Qualcomm',
  0x13b5: 'ARM',
  0x15ad: 'VMware',
  0x1af4: 'Red Hat (virtio)',
  0x1414: 'Microsoft',
  0x1ae0: 'SwiftShader'
}

const DISABLED_RENDERER_TEXT = 'Hardware acceleration disabled (software)'
const SWIFTSHADER_RENDERER_TEXT = 'SwiftShader (software)'
const HARDWARE_RENDERER_TEXT = 'Hardware GPU'

/** A known software-only adapter (SwiftShader, WARP, llvmpipe, anything whose name says software). */
export function isSoftwareDevice(device: GpuDevice): boolean {
  if (device.vendorId === VENDOR_GOOGLE) return true
  if (device.vendorId === VENDOR_MICROSOFT && device.deviceId === DEVICE_MICROSOFT_BASIC_RENDER) return true
  return typeof device.deviceString === 'string' && SOFTWARE_DEVICE_RE.test(device.deviceString)
}

type Evidence = 'hardware' | 'software' | 'none'

/** Chromium statuses: enabled (any variant) = the GPU does this work; unavailable / disabled = it is done on the CPU. */
function statusEvidence(value: string | undefined): Evidence {
  if (typeof value !== 'string') return 'none'
  const status = value.trim().toLowerCase()
  if (status === 'enabled' || status === 'enabled_force' || status === 'enabled_on') return 'hardware'
  if (status.startsWith('unavailable') || status.startsWith('disabled')) return 'software'
  return 'none'
}

/** Human text for a device: its driver string, else "<vendor> GPU", else '' when nothing is known. */
function deviceLabel(device: GpuDevice | null | undefined): string {
  const text = device?.deviceString?.trim() ?? ''
  if (text.length > 0) return text
  const vendor = device?.vendorId !== undefined ? VENDOR_NAMES[device.vendorId] : undefined
  return vendor !== undefined ? `${vendor} GPU` : ''
}

/**
 * Classifies this run. Order matters:
 * 1. accelerator off for this run => software (the GPU process never ran, so its status proves nothing);
 * 2. Chromium's feature status is authoritative (webgl / gpu_compositing: enabled = the GPU works, unavailable or
 *    disabled = the CPU does it); enabled + disabled together is a conflict => 'unknown';
 * 3. the device list is only a tiebreaker (a software adapter that is marked active, or the only kind listed, means
 *    software). A Windows PC ALWAYS lists "Microsoft Basic Render Driver" next to its real
 *    adapters (none marked active), so a software adapter counts only when it is the ONLY kind of adapter listed
 *    (SwANGLE on a VM without a GPU reports just SwiftShader, even when webgl says enabled);
 * 4. no usable signal at all => 'unknown' (the renderer then keeps its default).
 */
export function classifyGpu(input: GpuClassificationInput): GpuInfo {
  const featureStatus = input.featureStatus ?? null
  const webgl = typeof featureStatus?.webgl === 'string' ? featureStatus.webgl : ''
  const accelerationDisabled = input.accelerationDisabled === true

  if (accelerationDisabled) {
    return { mode: 'software', renderer: DISABLED_RENDERER_TEXT, accelerationDisabled, webgl }
  }

  const devices = input.devices ?? []
  const hardwareDevices = devices.filter((device) => !isSoftwareDevice(device))
  // Chromium marks the adapter that renders `active`: when that is a software one, software renders even if a real GPU is listed.
  const activeDevice = devices.find((device) => device.active === true)
  const onlySoftwareDevices =
    (devices.length > 0 && hardwareDevices.length === 0) || (activeDevice !== undefined && isSoftwareDevice(activeDevice))
  // The adapter to name: the one Chromium marks active, else the first real one.
  const named = hardwareDevices.find((device) => device.active === true) ?? hardwareDevices[0] ?? null
  const softwareDevice = devices.find(isSoftwareDevice) ?? null

  const webglEvidence = statusEvidence(featureStatus?.webgl)
  const compositingEvidence = statusEvidence(featureStatus?.gpu_compositing)
  const hasHardware = webglEvidence === 'hardware' || compositingEvidence === 'hardware'
  const hasSoftware = webglEvidence === 'software' || compositingEvidence === 'software'

  if (hasHardware && hasSoftware) {
    return { mode: 'unknown', renderer: 'Conflicting GPU status', accelerationDisabled, webgl }
  }
  if (hasSoftware) {
    return { mode: 'software', renderer: deviceLabelOr(softwareDevice, SWIFTSHADER_RENDERER_TEXT), accelerationDisabled, webgl }
  }
  if (hasHardware) {
    if (onlySoftwareDevices) {
      return { mode: 'software', renderer: deviceLabelOr(softwareDevice, SWIFTSHADER_RENDERER_TEXT), accelerationDisabled, webgl }
    }
    return { mode: 'hardware', renderer: deviceLabel(named) || HARDWARE_RENDERER_TEXT, accelerationDisabled, webgl }
  }
  if (onlySoftwareDevices) {
    return { mode: 'software', renderer: deviceLabelOr(softwareDevice, SWIFTSHADER_RENDERER_TEXT), accelerationDisabled, webgl }
  }
  return { mode: 'unknown', renderer: '', accelerationDisabled, webgl }
}

/** "<label> (software)", or the fallback text when the device has no usable label. */
function deviceLabelOr(device: GpuDevice | null, fallback: string): string {
  const label = deviceLabel(device)
  return label.length > 0 ? `${label} (software)` : fallback
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * The `gpuDevice` list of app.getGPUInfo('basic'). Electron types the whole object as `unknown` and the shape differs
 * between platforms and versions, so every field is checked and a missing list is simply empty (never a throw).
 */
export function parseGpuDevices(raw: unknown): readonly GpuDevice[] {
  if (!isRecord(raw) || !Array.isArray(raw.gpuDevice)) return []
  const devices: GpuDevice[] = []
  for (const entry of raw.gpuDevice) {
    if (!isRecord(entry)) continue
    const device: GpuDevice = {
      vendorId: numberField(entry.vendorId),
      deviceId: numberField(entry.deviceId),
      deviceString: stringField(entry.deviceString),
      driverVendor: stringField(entry.driverVendor),
      active: typeof entry.active === 'boolean' ? entry.active : undefined
    }
    // A device with no id and no name cannot be classified: dropping it keeps 'unknown' honest instead of guessing.
    if (device.vendorId === undefined && device.deviceString === undefined) continue
    devices.push(device)
  }
  return devices
}
