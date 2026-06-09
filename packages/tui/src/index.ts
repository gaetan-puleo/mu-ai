export type { Component, Surface, SurfaceEntry } from './surface';
export { measure, measureWidth, renderToBuffer } from './surface';

export {
  box,
  type BoxOptions,
  column,
  flex,
  type FlexItem,
  modal,
  type ModalOptions,
  overlay,
  type OverlayOptions,
  row,
  text,
  toast,
  type ToastKind,
  type ToastOptions,
} from './views';
export { Editor, editor, type EditorOptions } from './components/editor';
export { ScrollView, scrollView, type ScrollViewOptions } from './components/scroll-view';
export { type SelectItem, SelectList, selectList } from './components/select-list';
export { type Command, CommandPalette, commandPalette, type CommandPaletteOptions } from './components/command-palette';

export { type LayerHandle, type ToastHandle, TUI, type TuiOptions } from './tui';
export { ProcessTerminal, type ProcessTerminalOptions } from './terminal';
export { copyToClipboard } from './clipboard';
export type { Terminal, TerminalMode } from './types/terminal';

export type { InputEvent, KeyInputEvent, Modifiers, MouseInputEvent } from './events';
export { parseInput } from './keyboard';
export { TerminalInputParser } from './parser';
export { type GlobalKeybinding, type KeyChord, keyMatches } from './keybinds';

export {
  type Capabilities,
  capability,
  type CapabilitySource,
  createDefaultCapabilities,
  mergeCapabilities,
  type PartialCapabilities,
} from './capabilities';

export { truncateToWidth, visibleWidth, wrapText } from './utils';
export type { Color, Rect } from './layout/types';
