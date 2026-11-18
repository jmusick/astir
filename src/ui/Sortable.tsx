import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import Icon from './Icon';

interface Props<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  /** Called once per finished drag or arrow-key move, with indexes into `items`. */
  onMove: (from: number, to: number) => void;
  /** Renders one `<li>`, with the drag handle placed where the row wants it. */
  render: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
}

/**
 * A list the owner orders by dragging (D49): a handle on each row works with a mouse or touch, and
 * with the arrow keys when focused (D67). The parent saves the new order; nothing moves until it
 * does, so a synced reorder from another device simply re-renders.
 */
export default function Sortable<T>({ items, keyOf, labelOf, onMove, render, className }: Props<T>) {
  const list = useRef<HTMLUListElement>(null);
  const [announcement, setAnnouncement] = useState('');
  // After an arrow-key move the row re-renders in its new place; keep focus on its handle.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    list.current?.querySelector<HTMLElement>(`[data-sort-key="${CSS.escape(key)}"]`)?.focus();
  });

  // A drag finishes after later renders (a sync may land meanwhile), so it commits through the latest props.
  const latest = useRef({ items, onMove, labelOf });
  useLayoutEffect(() => { latest.current = { items, onMove, labelOf }; });
  const move = (from: number, to: number) => {
    const { items, onMove, labelOf } = latest.current;
    if (to < 0 || to >= items.length || to === from) return;
    onMove(from, to);
    setAnnouncement(`Moved “${labelOf(items[from])}” to ${to + 1} of ${items.length}.`);
  };

  function keys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    refocus.current = keyOf(items[index]);
    move(index, to);
  }

  function drag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0 || !list.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const rows = [...list.current.children] as HTMLElement[];
    const row = rows[index];
    if (!row) return;
    const rects = rows.map((r) => r.getBoundingClientRect());
    const height = rects[index].height;
    const startY = event.clientY;
    let target = index;
    handle.setPointerCapture(event.pointerId);
    row.classList.add('dragging');
    const shift = (dy: number) => {
      const center = rects[index].top + height / 2 + dy;
      target = rects.filter((rect, i) => i !== index && rect.top + rect.height / 2 < center).length;
      row.style.transform = `translateY(${dy}px)`;
      rows.forEach((other, i) => {
        if (i === index) return;
        const offset = i > index && i <= target ? -height : i < index && i >= target ? height : 0;
        other.style.transform = offset ? `translateY(${offset}px)` : '';
      });
    };
    const onPointerMove = (e: globalThis.PointerEvent) => shift(e.clientY - startY);
    const end = (commit: boolean) => () => {
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      row.classList.remove('dragging');
      for (const other of rows) other.style.transform = '';
      if (commit) move(index, target);
    };
    const onUp = end(true);
    const onCancel = end(false);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  const handleFor = (item: T, index: number) => items.length < 2 ? null
    : <button type="button" className="icon drag-handle" data-sort-key={keyOf(item)}
        aria-label={`Move “${labelOf(item)}”, ${index + 1} of ${items.length}`} aria-keyshortcuts="ArrowUp ArrowDown"
        title="Drag to reorder, or use the up and down arrow keys"
        onPointerDown={(e) => drag(e, index)} onKeyDown={(e) => keys(e, index)}><Icon name="grip" /></button>;

  return <>
    <ul ref={list} className={className}>{items.map((item, index) => render(item, handleFor(item, index)))}</ul>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </>;
}
