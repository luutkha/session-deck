import {
  decideContextMenuAction,
  isRightButton,
  decideKeyAction,
  type KeyInfo
} from './keymap'

function key(partial: Partial<KeyInfo> & Pick<KeyInfo, 'key'>): KeyInfo {
  return {
    type: 'keydown',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...partial
  }
}

describe('decideKeyAction', () => {
  describe('copy', () => {
    it('copies on Ctrl+C (keydown) when there is a selection', () => {
      expect(decideKeyAction(key({ key: 'c', ctrlKey: true }), true)).toBe('copy')
    })

    it('copies on Ctrl+Shift+C regardless of selection', () => {
      const ev = key({ key: 'C', ctrlKey: true, shiftKey: true })
      expect(decideKeyAction(ev, true)).toBe('copy')
      expect(decideKeyAction(ev, false)).toBe('copy')
    })
  })

  describe('Ctrl+C without a selection passes through as ^C', () => {
    it('allows the event so xterm sends SIGINT', () => {
      expect(decideKeyAction(key({ key: 'c', ctrlKey: true }), false)).toBe('allow')
    })
  })

  describe('paste', () => {
    it('pastes on Ctrl+V', () => {
      expect(decideKeyAction(key({ key: 'v', ctrlKey: true }), false)).toBe('paste')
      expect(decideKeyAction(key({ key: 'v', ctrlKey: true }), true)).toBe('paste')
    })

    it('pastes on Ctrl+Shift+V', () => {
      const ev = key({ key: 'V', ctrlKey: true, shiftKey: true })
      expect(decideKeyAction(ev, false)).toBe('paste')
    })
  })

  describe('pass-through combos', () => {
    it('passes Ctrl+Backspace through unchanged', () => {
      expect(decideKeyAction(key({ key: 'Backspace', ctrlKey: true }), false)).toBe('allow')
    })

    it('passes Shift+Enter through unchanged', () => {
      expect(decideKeyAction(key({ key: 'Enter', shiftKey: true }), false)).toBe('allow')
    })
  })

  describe('app-level shortcuts must bubble', () => {
    it('allows Ctrl+N so the app can create a session', () => {
      expect(decideKeyAction(key({ key: 'n', ctrlKey: true }), false)).toBe('allow')
    })

    it('allows F2 so the app can rename a session', () => {
      expect(decideKeyAction(key({ key: 'F2' }), true)).toBe('allow')
    })

    it('allows Ctrl+Tab for app session switching', () => {
      expect(decideKeyAction(key({ key: 'Tab', ctrlKey: true }), false)).toBe('allow')
    })
  })

  describe('event types other than keydown are ignored', () => {
    it('ignores keyup for copy so it cannot double-fire', () => {
      const ev = key({ type: 'keyup', key: 'c', ctrlKey: true })
      expect(decideKeyAction(ev, true)).toBe('allow')
    })

    it('ignores keypress for paste so it cannot double-paste', () => {
      const ev = key({ type: 'keypress', key: 'v', ctrlKey: true })
      expect(decideKeyAction(ev, false)).toBe('allow')
    })

    it('ignores keyup for Ctrl+Shift+C', () => {
      const ev = key({ type: 'keyup', key: 'C', ctrlKey: true, shiftKey: true })
      expect(decideKeyAction(ev, true)).toBe('allow')
    })
  })

  describe('unrelated and foreign-modified keys are untouched', () => {
    it('allows a plain printable key', () => {
      expect(decideKeyAction(key({ key: 'c' }), true)).toBe('allow')
    })

    it('does not copy when Alt is also held', () => {
      const ev = key({ key: 'c', ctrlKey: true, altKey: true })
      expect(decideKeyAction(ev, true)).toBe('allow')
    })

    it('does not copy when Meta is held instead of Ctrl', () => {
      const ev = key({ key: 'c', metaKey: true })
      expect(decideKeyAction(ev, true)).toBe('allow')
    })

    it('does not paste on Ctrl+Alt+V', () => {
      const ev = key({ key: 'v', ctrlKey: true, altKey: true })
      expect(decideKeyAction(ev, false)).toBe('allow')
    })
  })
})

describe('decideContextMenuAction', () => {
  it('copies when there is a selection', () => {
    expect(decideContextMenuAction(true)).toBe('copy')
  })

  it('pastes when there is no selection', () => {
    expect(decideContextMenuAction(false)).toBe('paste')
  })
})

describe('decideKeyAction: new-session shortcut', () => {
  it('keeps xterm from sending ^N for Ctrl+Shift+N (app shortcut)', () => {
    expect(decideKeyAction(key({ key: 'N', ctrlKey: true, shiftKey: true }), false)).toBe('app-shortcut')
    expect(decideKeyAction(key({ key: 'n', ctrlKey: true, shiftKey: true }), true)).toBe('app-shortcut')
  })

  it('still passes plain Ctrl+N to the program (readline next history)', () => {
    expect(decideKeyAction(key({ key: 'n', ctrlKey: true }), false)).toBe('allow')
  })
})

describe('decideKeyAction: terminal search shortcut', () => {
  it('swallows Ctrl+Shift+F so ^F never reaches the program', () => {
    expect(decideKeyAction(key({ key: 'F', ctrlKey: true, shiftKey: true }), false)).toBe('search')
    expect(decideKeyAction(key({ key: 'f', ctrlKey: true, shiftKey: true }), true)).toBe('search')
  })

  it('still passes plain Ctrl+F to the program (readline forward-char)', () => {
    expect(decideKeyAction(key({ key: 'f', ctrlKey: true }), false)).toBe('allow')
  })
})

describe('isRightButton', () => {
  it('is true only for the right mouse button', () => {
    expect(isRightButton(2)).toBe(true)
    expect(isRightButton(0)).toBe(false)
    expect(isRightButton(1)).toBe(false)
  })
})

describe('decideKeyAction: terminal comfort zoom', () => {
  it('Ctrl+= and its Shift variant (key "+") zoom in', () => {
    expect(decideKeyAction(key({ key: '=', ctrlKey: true }), false)).toBe('zoom-in')
    expect(decideKeyAction(key({ key: '+', ctrlKey: true, shiftKey: true }), false)).toBe('zoom-in')
  })

  it('Ctrl+- and Ctrl+_ zoom out', () => {
    expect(decideKeyAction(key({ key: '-', ctrlKey: true }), false)).toBe('zoom-out')
    expect(decideKeyAction(key({ key: '_', ctrlKey: true, shiftKey: true }), false)).toBe('zoom-out')
  })

  it('Ctrl+0 resets the zoom', () => {
    expect(decideKeyAction(key({ key: '0', ctrlKey: true }), false)).toBe('zoom-reset')
  })

  it('plain - / + / 0 stay with the program', () => {
    expect(decideKeyAction(key({ key: '-' }), false)).toBe('allow')
    expect(decideKeyAction(key({ key: '+' }), false)).toBe('allow')
    expect(decideKeyAction(key({ key: '0' }), false)).toBe('allow')
  })
})
