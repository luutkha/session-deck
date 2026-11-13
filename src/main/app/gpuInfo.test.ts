import { describe, expect, it } from 'vitest'
import type { GpuDevice } from './gpuInfo'
import { classifyGpu, isSoftwareDevice, parseGpuDevices } from './gpuInfo'

/** What Chromium reports on a healthy machine with a GPU. */
function enabledStatus(extra: Record<string, string> = {}): Record<string, string> {
  return { webgl: 'enabled', webgl2: 'enabled', gpu_compositing: 'enabled', rasterization: 'enabled', ...extra }
}

const nvidia: GpuDevice = {
  vendorId: 0x10de,
  deviceId: 0x1c29,
  deviceString: 'ANGLE (NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
  driverVendor: 'NVIDIA',
  active: true
}
const swiftShader: GpuDevice = { vendorId: 0x1ae0, deviceString: 'Google SwiftShader', active: true }
const basicRender: GpuDevice = { vendorId: 0x1414, deviceId: 0x8c, deviceString: 'Microsoft Basic Render Driver', active: true }
const vmware: GpuDevice = { vendorId: 0x15ad, deviceString: 'VMware SVGA 3D', active: true }

describe('classifyGpu: real hardware', () => {
  it('calls an NVIDIA adapter with WebGL enabled hardware', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [nvidia], accelerationDisabled: false })
    expect(info.mode).toBe('hardware')
    expect(info.renderer).toBe('ANGLE (NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)')
    expect(info.accelerationDisabled).toBe(false)
    expect(info.webgl).toBe('enabled')
  })

  it('accepts the enabled_on / enabled_force statuses (AMD, Intel)', () => {
    const amd: GpuDevice = { vendorId: 0x1002, deviceString: 'AMD Radeon RX 6600', active: true }
    const intel: GpuDevice = { vendorId: 0x8086, deviceString: 'Intel UHD Graphics 620', active: true }
    expect(classifyGpu({ featureStatus: { webgl: 'enabled_force' }, devices: [amd], accelerationDisabled: false }).mode).toBe('hardware')
    expect(classifyGpu({ featureStatus: { webgl: 'enabled_on' }, devices: [intel], accelerationDisabled: false }).mode).toBe('hardware')
  })

  it('works from the compositing status when webgl is not reported', () => {
    expect(classifyGpu({ featureStatus: { gpu_compositing: 'enabled' }, devices: [nvidia], accelerationDisabled: false }).mode).toBe('hardware')
  })

  it('builds the renderer text from the vendor when the driver string is missing', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [{ vendorId: 0x10de, active: true }], accelerationDisabled: false })
    expect(info.mode).toBe('hardware')
    expect(info.renderer).toBe('NVIDIA GPU')
  })

  it('still says hardware when WebGL works but the device list is empty', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [], accelerationDisabled: false })
    expect(info.mode).toBe('hardware')
    expect(info.renderer).toBe('Hardware GPU')
  })
})

describe('classifyGpu: software rendering', () => {
  it('calls Google SwiftShader software even though WebGL reports enabled (SwANGLE)', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [swiftShader], accelerationDisabled: false })
    expect(info.mode).toBe('software')
    expect(info.renderer).toBe('Google SwiftShader (software)')
  })

  it('calls the Microsoft Basic Render Driver software', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [basicRender], accelerationDisabled: false })
    expect(info.mode).toBe('software')
    expect(info.renderer).toBe('Microsoft Basic Render Driver (software)')
  })

  it('calls llvmpipe / anything named "software" software', () => {
    expect(classifyGpu({ featureStatus: enabledStatus(), devices: [{ deviceString: 'llvmpipe (LLVM 15.0.7)' }], accelerationDisabled: false }).mode).toBe('software')
    expect(classifyGpu({ featureStatus: enabledStatus(), devices: [{ deviceString: 'Microsoft Basic Render Driver' }], accelerationDisabled: false }).mode).toBe('software')
    expect(classifyGpu({ featureStatus: enabledStatus(), devices: [{ deviceString: 'Software Rasterizer' }], accelerationDisabled: false }).mode).toBe('software')
  })

  it('calls webgl "unavailable_software" software and names SwiftShader', () => {
    const info = classifyGpu({ featureStatus: { webgl: 'unavailable_software', gpu_compositing: 'disabled_software' }, devices: [], accelerationDisabled: false })
    expect(info.mode).toBe('software')
    expect(info.renderer).toBe('SwiftShader (software)')
    expect(info.webgl).toBe('unavailable_software')
  })

  it('treats disabled_off and unavailable_off as software', () => {
    expect(classifyGpu({ featureStatus: { webgl: 'disabled_off' }, devices: [nvidia], accelerationDisabled: false }).mode).toBe('software')
    expect(classifyGpu({ featureStatus: { webgl: 'unavailable_off' }, devices: [], accelerationDisabled: false }).mode).toBe('software')
  })

  it('calls a blocklisted real GPU (WebGL unavailable) software', () => {
    expect(classifyGpu({ featureStatus: { webgl: 'unavailable_software' }, devices: [nvidia], accelerationDisabled: false }).mode).toBe('software')
  })

  it('a disabled accelerator is software even when the status and devices look fine', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [nvidia], accelerationDisabled: true })
    expect(info.mode).toBe('software')
    expect(info.accelerationDisabled).toBe(true)
    expect(info.renderer).toBe('Hardware acceleration disabled (software)')
    expect(info.webgl).toBe('enabled')
  })
})

describe('classifyGpu: VMs and virtual adapters', () => {
  it('calls a VM with working virtual 3D (VMware SVGA) hardware', () => {
    const info = classifyGpu({ featureStatus: enabledStatus(), devices: [vmware], accelerationDisabled: false })
    expect(info.mode).toBe('hardware')
    expect(info.renderer).toBe('VMware SVGA 3D')
  })

  it('ignores an inactive software fallback next to an active virtual adapter', () => {
    const devices: GpuDevice[] = [vmware, { ...basicRender, active: false }]
    expect(classifyGpu({ featureStatus: enabledStatus(), devices, accelerationDisabled: false }).mode).toBe('hardware')
  })

  it('follows the active adapter when a software device is the one rendering', () => {
    const devices: GpuDevice[] = [{ ...nvidia, active: false }, swiftShader]
    expect(classifyGpu({ featureStatus: enabledStatus(), devices, accelerationDisabled: false }).mode).toBe('software')
  })
})

describe('classifyGpu: unknown and conflicting input', () => {
  it('is unknown for null input', () => {
    const info = classifyGpu({ featureStatus: null, devices: [], accelerationDisabled: false })
    expect(info).toEqual({ mode: 'unknown', renderer: '', accelerationDisabled: false, webgl: '' })
  })

  it('is unknown for an empty feature status', () => {
    expect(classifyGpu({ featureStatus: {}, devices: [], accelerationDisabled: false }).mode).toBe('unknown')
  })

  it('is unknown when a real device is listed but nothing says WebGL works', () => {
    expect(classifyGpu({ featureStatus: null, devices: [nvidia], accelerationDisabled: false }).mode).toBe('unknown')
  })

  it('is unknown when enabled and disabled evidence conflict', () => {
    const info = classifyGpu({
      featureStatus: { webgl: 'enabled', gpu_compositing: 'disabled_software' },
      devices: [nvidia],
      accelerationDisabled: false
    })
    expect(info.mode).toBe('unknown')
    expect(info.renderer).toBe('Conflicting GPU status')
  })

  it('ignores status values it does not know', () => {
    expect(classifyGpu({ featureStatus: { webgl: 'something_new' }, devices: [], accelerationDisabled: false }).mode).toBe('unknown')
  })
})

describe('isSoftwareDevice', () => {
  it('recognises the known software adapters and nothing else', () => {
    expect(isSoftwareDevice({ vendorId: 0x1ae0 })).toBe(true)
    expect(isSoftwareDevice({ vendorId: 0x1414, deviceId: 0x8c })).toBe(true)
    expect(isSoftwareDevice({ deviceString: 'SwiftShader Device (Subzero)' })).toBe(true)
    expect(isSoftwareDevice({ vendorId: 0x1414, deviceId: 0x5353 })).toBe(false)
    expect(isSoftwareDevice(nvidia)).toBe(false)
    expect(isSoftwareDevice({})).toBe(false)
  })
})

describe('parseGpuDevices', () => {
  it('reads the documented basic response', () => {
    const devices = parseGpuDevices({
      gpuDevice: [
        {
          active: true,
          vendorId: 0x10de,
          deviceId: 0x1c29,
          deviceString: 'ANGLE (NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
          driverVendor: 'NVIDIA',
          driverVersion: '27.21.14.5709'
        }
      ],
      machineModelName: ''
    })
    expect(devices).toEqual([
      {
        active: true,
        vendorId: 0x10de,
        deviceId: 0x1c29,
        deviceString: 'ANGLE (NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
        driverVendor: 'NVIDIA'
      }
    ])
  })

  it('returns an empty list for junk instead of throwing', () => {
    expect(parseGpuDevices(null)).toEqual([])
    expect(parseGpuDevices('nope')).toEqual([])
    expect(parseGpuDevices({})).toEqual([])
    expect(parseGpuDevices({ gpuDevice: 'nope' })).toEqual([])
    expect(parseGpuDevices({ gpuDevice: [null, 1, { vendorId: 'x' }] })).toEqual([])
  })

  it('drops entries without an id or a name and ignores wrong field types', () => {
    expect(parseGpuDevices({ gpuDevice: [{ vendorId: 0x10de, active: 'yes', deviceId: 'x', deviceString: 7 }] })).toEqual([
      { vendorId: 0x10de, deviceId: undefined, deviceString: undefined, driverVendor: undefined, active: undefined }
    ])
  })
})
