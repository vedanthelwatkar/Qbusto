/**
 * Clicking a table row opens that row's details.
 *
 * WHY THIS IS SHARED RATHER THAN WRITTEN PER PAGE
 *
 * Every list in the Dashboard used to hide its details behind a link in the
 * first column - a small target, and one nobody finds without being told. The
 * row is the obvious thing to click, so the row is what opens the details now.
 *
 * The whole difficulty is the SECOND half: a row is also full of controls. Edit
 * and Deactivate buttons, status dropdowns, switches, checkboxes and real
 * navigation links all live inside the same row, and every one of them must
 * keep doing its own job without also opening a drawer behind it. Nine tables
 * each solving that separately is nine chances to get it subtly wrong, so it is
 * solved once, here.
 *
 * Applied as `onRow={detailRowProps(open)}` on the antd Table.
 */

import type { HTMLAttributes, MouseEvent } from 'react';

/**
 * Anything that owns its own click.
 *
 * Matched with `closest()`, so it also covers a click that lands on an icon or
 * a label INSIDE one of these rather than on the control itself - which is most
 * clicks on a button in practice.
 *
 * antd renders several of these as a wrapper element around a native one, so
 * both the semantic tags and antd's class names are listed. `.ant-dropdown-
 * trigger` and `[role="button"]` catch the composite widgets that render no
 * native control at all.
 */
const INTERACTIVE = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '.ant-btn',
  '.ant-select',
  '.ant-switch',
  '.ant-checkbox-wrapper',
  '.ant-radio-wrapper',
  '.ant-dropdown-trigger',
  '.ant-picker',
  '.ant-tag-checkable',
  '.ant-table-row-expand-icon',
  '.ant-table-selection-column',
].join(', ');

/**
 * Should this click open the row, or did it belong to something in the row?
 *
 * Exported for its own tests, and because the rule is worth being able to read
 * on its own.
 */
export function shouldOpenRow(event: MouseEvent<HTMLElement>): boolean {
  // Only a plain left click. Ctrl/Cmd/middle-click are how people open things
  // in a new tab, and a modifier-click that silently opened a drawer instead
  // would be worse than doing nothing.
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const target = event.target as HTMLElement | null;
  if (!target) return false;

  // A click that landed on a control - or inside one - is that control's.
  if (target.closest(INTERACTIVE)) return false;

  /*
   * Selecting text in a cell is a real thing people do with an order id or a
   * phone number, and it ends in a click. Opening a drawer on top of the
   * selection they just made would make copying a value impossible.
   */
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return false;

  return true;
}

/**
 * `onRow` props that open a row's details on click.
 *
 * @param open Called with the row's record. Give it the SAME handler the first
 *   column used, so the row shows exactly what the link showed.
 */
export function detailRowProps<T>(
  open: (record: T) => void
): (record: T) => HTMLAttributes<HTMLElement> {
  return (record: T) => ({
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!shouldOpenRow(event)) return;

      open(record);
    },
    className: 'table-row--clickable',
  });
}
