/**
 * Reads values out of Polaris web components.
 *
 * React 18 does not bind listeners for custom-element events through JSX — it
 * only knows its own synthetic event list, so `onChange` on an `<s-text-field>`
 * silently never fires. Rather than a ref per control, this listens once on a
 * container for the `input` and `change` events the components bubble, and
 * dispatches by the control's `name`.
 *
 * That also means a step can add a field without wiring anything up: give it a
 * name and it reports.
 */

import { useEffect, type RefObject } from 'react';

export interface FieldEvent {
  name: string;
  value: string;
  checked: boolean;
}

export function useFieldEvents(
  ref: RefObject<HTMLElement | null>,
  onField: (event: FieldEvent) => void
): void {
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    const handle = (event: Event) => {
      const target = event.target as (HTMLElement & { name?: string; value?: unknown; checked?: unknown }) | null;
      const name = target?.name;
      if (!name) return;

      onField({
        name,
        value: target.value === undefined || target.value === null ? '' : String(target.value),
        checked: Boolean(target.checked),
      });
    };

    // Both, because text fields report on `input` while selects, switches and
    // checkboxes report on `change`. Listening for one misses half the form.
    node.addEventListener('input', handle);
    node.addEventListener('change', handle);
    return () => {
      node.removeEventListener('input', handle);
      node.removeEventListener('change', handle);
    };
  }, [ref, onField]);
}
