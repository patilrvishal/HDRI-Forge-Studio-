/**
 * Gives icon-only controls an accessible name.
 *
 * Most toolbar buttons and sliders carry a tooltip (`title`) but no `aria-label`, so a screen reader announces
 * them as just "button". This copies the tooltip into `aria-label` for controls that have neither a label nor
 * visible text. It only adds an attribute: it never changes behaviour, appearance or existing labels.
 */
export function initA11yLabels(): void {
  if (typeof document === 'undefined' || !document.body) return;

  const SELECTOR = 'button[title], [role="button"][title], input[title], select[title]';

  const apply = (): void => {
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return;
      const title = el.getAttribute('title')?.trim();
      if (!title) return;
      // A button with its own visible text already has a name
      if (el instanceof HTMLButtonElement && (el.textContent ?? '').trim()) return;
      el.setAttribute('aria-label', title);
    });
  };

  // The UI re-renders constantly while dragging, so batch the work
  let timer: number | undefined;
  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => { timer = undefined; apply(); }, 300);
  };

  // aria-label is not in attributeFilter, so adding it never re-triggers this observer
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  });
  schedule();
}
