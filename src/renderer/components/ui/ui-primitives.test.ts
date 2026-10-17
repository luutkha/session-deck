import { describe, expect, it } from 'vitest'

// Import-only smoke test: catches broken imports and missing exports in the ported primitives
// without rendering anything (the suite runs in the node environment).
const primitives: Record<string, { modulePath: () => Promise<Record<string, unknown>>; exports: string[] }> = {
  button: { modulePath: () => import('./button'), exports: ['Button', 'buttonVariants'] },
  badge: { modulePath: () => import('./badge'), exports: ['Badge', 'badgeVariants'] },
  input: { modulePath: () => import('./input'), exports: ['Input'] },
  label: { modulePath: () => import('./label'), exports: ['Label'] },
  textarea: { modulePath: () => import('./textarea'), exports: ['Textarea'] },
  checkbox: { modulePath: () => import('./checkbox'), exports: ['Checkbox'] },
  switch: { modulePath: () => import('./switch'), exports: ['Switch', 'SwitchIndicator'] },
  separator: { modulePath: () => import('./separator'), exports: ['Separator'] },
  collapsible: {
    modulePath: () => import('./collapsible'),
    exports: ['Collapsible', 'CollapsibleTrigger', 'CollapsibleContent']
  },
  'scroll-area': { modulePath: () => import('./scroll-area'), exports: ['ScrollArea', 'ScrollBar'] },
  tooltip: {
    modulePath: () => import('./tooltip'),
    exports: ['Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider']
  },
  popover: {
    modulePath: () => import('./popover'),
    exports: ['Popover', 'PopoverTrigger', 'PopoverContent', 'PopoverAnchor', 'PopoverArrow']
  },
  select: {
    modulePath: () => import('./select'),
    exports: ['Select', 'SelectTrigger', 'SelectContent', 'SelectItem', 'SelectValue']
  },
  dialog: {
    modulePath: () => import('./dialog'),
    exports: ['Dialog', 'DialogContent', 'DialogTitle', 'DialogDescription', 'DialogFooter']
  },
  'dropdown-menu': {
    modulePath: () => import('./dropdown-menu'),
    exports: ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem']
  },
  'context-menu': {
    modulePath: () => import('./context-menu'),
    exports: ['ContextMenu', 'ContextMenuTrigger', 'ContextMenuContent', 'ContextMenuItem']
  }
}

describe('ui primitives', () => {
  for (const [name, { modulePath, exports }] of Object.entries(primitives)) {
    it(`${name} imports and exports its components`, async () => {
      const mod = await modulePath()
      for (const exportName of exports) {
        expect(mod[exportName], `${name} should export ${exportName}`).toBeDefined()
      }
    })
  }
})
