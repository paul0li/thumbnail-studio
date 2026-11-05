// Keeps the text field being typed into in sight on a phone.
//
// The browser's own "scroll the field into view" does not work here: the
// preview stays stuck to the top of the screen and covers what scrolls under
// it, and the page is often too short to scroll at all once the keyboard takes
// half the screen. So, while a text field has the focus, the page gets extra
// room at the bottom as tall as the keyboard, and is scrolled so the field
// sits between the preview and the keyboard.

const MARGIN = 12;

/** A vertical span, in the layout viewport's coordinates. */
export interface Span {
  top: number;
  bottom: number;
}

/** How far to scroll the page so `field` is inside `view` with a margin:
 *  positive scrolls down, negative up, 0 leaves it. When the field is taller
 *  than the room, its top wins: that is where the caret starts. */
export function scrollToShow(field: Span, view: Span, margin = MARGIN): number {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  if (field.top < top) return field.top - top;
  if (field.bottom > bottom) return Math.min(field.bottom - bottom, field.top - top);
  return 0;
}

function isTextField(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ["text", "search", "email", "url", "tel", "number", "password"].includes(el.type);
}

/** Starts watching the focus and the on-screen keyboard. `covering` is the
 *  element stuck to the top of the screen, if any. */
export function keepTextFieldsInView(covering: () => HTMLElement | null): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const html = document.documentElement;
  let frame = 0;

  const show = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const field = document.activeElement;
      const keyboard = Math.max(0, Math.round(window.innerHeight - vv.height * vv.scale));
      html.style.setProperty("--keyboard-h", isTextField(field) ? `${keyboard}px` : "0px");
      if (!isTextField(field)) return;

      // What the person can actually see: the visual viewport, minus the
      // preview where it overlaps it.
      let top = vv.offsetTop;
      const stuck = covering();
      if (stuck && getComputedStyle(stuck).position === "sticky") {
        top = Math.max(top, stuck.getBoundingClientRect().bottom);
      }
      const rect = field.getBoundingClientRect();
      const delta = scrollToShow({ top: rect.top, bottom: rect.bottom }, { top, bottom: vv.offsetTop + vv.height });
      if (delta !== 0) window.scrollBy({ top: delta });
    });
  };

  // The keyboard slides in after the focus moves, and the browser scrolls on
  // its own meanwhile: settle once it has, and again whenever it resizes.
  document.addEventListener("focusin", () => {
    show();
    window.setTimeout(show, 350);
  });
  document.addEventListener("focusout", () => window.setTimeout(show, 50));
  vv.addEventListener("resize", show);
}
