import { overlayHost } from './overlay';

export interface PickerOption {
  readonly value: string;
  readonly label: string;
  /** Secondary text, shown dimmed and also searched. */
  readonly note?: string;
  readonly icon?: () => HTMLElement;
}

export interface Picker {
  readonly element: HTMLElement;
  setOptions(options: readonly PickerOption[]): void;
  getValue(): string;
  setValue(value: string): void;
  setDisabled(disabled: boolean): void;
  onChange(listener: (value: string) => void): void;
  close(): void;
}

/**
 * Below this many options a search box is noise: the whole list already fits in
 * one glance, and a text field would just add a step before the click.
 */
const SEARCH_FROM = 7;

let openPicker: (() => void) | null = null;

/** Shuts whichever picker is showing, so two can never be open at once. */
export function closePickers(): void {
  openPicker?.();
  openPicker = null;
}

/**
 * A single-select that can be searched.
 *
 * A native `<select>` cannot be filtered, and on a tablet it becomes a system
 * wheel — punishing when an environment defines eighty attributes. This keeps
 * the same one-value-in, one-value-out contract while letting someone type to
 * narrow the list.
 *
 * The panel is fixed-position inside the palette root rather than nested where
 * it is used: these pickers live inside other floating panels, and an absolutely
 * positioned child would be clipped or stack underneath them.
 */
export function createPicker(placeholder = 'Nothing'): Picker {
  let options: readonly PickerOption[] = [];
  let value = '';
  let listeners: ((value: string) => void)[] = [];
  let panel: HTMLElement | null = null;
  let active = -1;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'picker';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');

  const valueText = document.createElement('span');
  valueText.className = 'picker-value';
  const caret = document.createElement('span');
  caret.className = 'picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  button.append(valueText, caret);

  function current(): PickerOption | undefined {
    return options.find((entry) => entry.value === value);
  }

  function paintLabel(): void {
    const chosen = current();
    valueText.textContent = chosen ? chosen.label : placeholder;
    valueText.classList.toggle('is-placeholder', !chosen);
  }

  function commit(next: string): void {
    if (next === value) {
      close();
      return;
    }
    value = next;
    paintLabel();
    close();
    for (const listener of listeners) listener(value);
  }

  function close(): void {
    panel?.remove();
    panel = null;
    active = -1;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    globalThis.removeEventListener('resize', reflow);
    globalThis.removeEventListener('scroll', reflow, true);
    if (openPicker === close) openPicker = null;
  }

  function onOutside(event: Event): void {
    const target = event.target as Node;
    if (!panel?.contains(target) && !button.contains(target)) close();
  }

  function open(): void {
    closePickers();

    panel = document.createElement('div');
    panel.className = 'picker-panel';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'picker-search';
    search.placeholder = 'Search…';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search options');

    const list = document.createElement('div');
    list.className = 'picker-options';
    list.setAttribute('role', 'listbox');

    const searchable = options.length >= SEARCH_FROM;
    if (searchable) panel.append(search);
    panel.append(list);

    const empty = document.createElement('p');
    empty.className = 'picker-empty';
    empty.textContent = 'Nothing matches.';

    let shown: PickerOption[] = [...options];

    function paintList(): void {
      active = shown.findIndex((entry) => entry.value === value);
      list.replaceChildren(
        ...shown.map((entry, index) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'picker-option';
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(entry.value === value));
          if (entry.value === value) row.classList.add('on');
          if (entry.icon) row.append(entry.icon());
          const label = document.createElement('span');
          label.className = 'picker-option-label';
          label.textContent = entry.label;
          row.append(label);
          if (entry.note) {
            const note = document.createElement('span');
            note.className = 'picker-option-note';
            note.textContent = entry.note;
            row.append(note);
          }
          row.addEventListener('click', () => commit(entry.value));
          row.addEventListener('pointerenter', () => {
            active = index;
            paintActive();
          });
          return row;
        }),
      );
      if (shown.length === 0) list.append(empty);
      paintActive();
    }

    function paintActive(): void {
      const rows = [...list.querySelectorAll<HTMLElement>('.picker-option')];
      rows.forEach((row, index) => row.classList.toggle('active', index === active));
      rows[active]?.scrollIntoView({ block: 'nearest' });
    }

    function filter(): void {
      const term = search.value.trim().toLowerCase();
      shown = term
        ? options.filter((entry) =>
            `${entry.label} ${entry.note ?? ''}`.toLowerCase().includes(term),
          )
        : [...options];
      paintList();
      // With a term typed, the first match is the likely target.
      if (term && shown.length > 0) {
        active = 0;
        paintActive();
      }
    }

    search.addEventListener('input', filter);
    paintList();

    panel.style.visibility = 'hidden';
    overlayHost().append(panel);
    button.setAttribute('aria-expanded', 'true');

    place();
    panel.style.visibility = 'visible';
    if (searchable) search.focus();

    function place(): void {
      if (!panel) return;
      const anchor = button.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const gap = 6;
      // Flip above when there is not room below, so a picker near the foot of
      // the screen still shows its list.
      const below = globalThis.innerHeight - anchor.bottom;
      const top =
        below < box.height + gap && anchor.top > below
          ? Math.max(8, anchor.top - box.height - gap)
          : anchor.bottom + gap;
      const left = Math.max(
        8,
        Math.min(anchor.left, globalThis.innerWidth - box.width - 8),
      );
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.minWidth = `${anchor.width}px`;
    }

    function onKeyLocal(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        button.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (shown.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active = (active + step + shown.length) % shown.length;
        paintActive();
        return;
      }
      if (event.key === 'Enter' && active >= 0 && shown[active]) {
        event.preventDefault();
        commit(shown[active]!.value);
      }
    }
    onKey = onKeyLocal;

    // Follow the anchor rather than dismissing. Closing here would make the
    // picker unusable on a tablet: opening the on-screen keyboard to type in
    // the search field is itself a resize, which would shut the panel the
    // instant it was needed.
    reflow = place;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    globalThis.addEventListener('resize', reflow);
    globalThis.addEventListener('scroll', reflow, true);
    openPicker = close;
  }

  let onKey: (event: KeyboardEvent) => void = () => {};
  let reflow: () => void = () => {};

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panel) close();
    else open();
  });

  paintLabel();

  return {
    element: button,
    setOptions(next: readonly PickerOption[]): void {
      options = next;
      if (!next.some((entry) => entry.value === value)) value = next[0]?.value ?? '';
      paintLabel();
    },
    getValue: () => value,
    setValue(next: string): void {
      value = next;
      paintLabel();
    },
    setDisabled(disabled: boolean): void {
      button.disabled = disabled;
      if (disabled) close();
    },
    onChange(listener: (value: string) => void): void {
      listeners = [...listeners, listener];
    },
    close,
  };
}
