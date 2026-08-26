import { overlayHost } from './overlay';

export interface MenuItem {
  readonly label: string;
  readonly onPick: () => void;
}

let open: HTMLElement | null = null;

/** Dismisses whatever menu is showing. */
export function closeContextMenu(): void {
  open?.remove();
  open = null;
}

/**
 * A small menu at a point.
 *
 * Positioned within the viewport rather than blindly at the cursor, so a
 * right-click near the right or bottom edge does not open a menu that runs off
 * screen.
 */
export function showContextMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeContextMenu();
  if (items.length === 0) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.addEventListener('click', () => {
      closeContextMenu();
      item.onPick();
    });
    menu.append(button);
  }

  menu.style.visibility = 'hidden';
  overlayHost().append(menu);
  open = menu;

  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, globalThis.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, globalThis.innerHeight - box.height - 8))}px`;
  menu.style.visibility = 'visible';

  // Registered on the next frame so the click that opened the menu does not
  // immediately close it.
  requestAnimationFrame(() => {
    document.addEventListener('pointerdown', onAway, { once: true });
    document.addEventListener('keydown', onKey, { once: true });
  });

  function onAway(event: PointerEvent): void {
    if (event.target instanceof Node && menu.contains(event.target)) {
      document.addEventListener('pointerdown', onAway, { once: true });
      return;
    }
    closeContextMenu();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeContextMenu();
    else document.addEventListener('keydown', onKey, { once: true });
  }
}

/**
 * Fires for a right-click and for a touch long-press.
 *
 * `contextmenu` alone would make this desktop-only; on a tablet the same intent
 * is expressed by holding.
 */
export function onContextRequest(
  element: HTMLElement,
  handler: (x: number, y: number) => void,
): void {
  element.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    handler(event.clientX, event.clientY);
  });

  let timer: number | undefined;
  let start: { x: number; y: number } | null = null;

  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    start = { x: event.clientX, y: event.clientY };
    timer = window.setTimeout(() => {
      if (start) handler(start.x, start.y);
    }, 500);
  });

  const cancel = (event: PointerEvent): void => {
    // A drag is a scroll, not a press.
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      window.clearTimeout(timer);
    }
  };
  element.addEventListener('pointermove', cancel);
  element.addEventListener('pointerup', () => window.clearTimeout(timer));
  element.addEventListener('pointercancel', () => window.clearTimeout(timer));
}
