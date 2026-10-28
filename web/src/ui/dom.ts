// A tiny element builder. The UI is small enough that a framework would be
// more code to learn than it saves.

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "on") {
      for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
        el.addEventListener(event, handler);
      }
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "style" && typeof value === "object" && value !== null) {
      Object.assign(el.style, value);
    } else if (key === "value" || key === "checked") {
      // Properties, not attributes: a textarea has no `value` attribute.
      (el as unknown as Record<string, unknown>)[key] = value;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else if (value !== false && value !== undefined && value !== null) {
      if (key in el && typeof value !== "string") (el as unknown as Record<string, unknown>)[key] = value;
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

let toastTimer: number | undefined;
/** A message on screen that screen readers also hear. Errors stay longer and
 *  interrupt; a tap dismisses any message. */
export function toast(message: string, options: { error?: boolean } = {}): void {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = h("div", { class: "toast", role: "status", "aria-live": "polite" });
    el.addEventListener("click", () => el?.classList.remove("visible"));
    document.body.append(el);
  }
  el.setAttribute("aria-live", options.error ? "assertive" : "polite");
  el.classList.toggle("error", Boolean(options.error));
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove("visible"), options.error ? 9000 : 4000);
}

let announceTimer: number | undefined;
/** Says what just changed to screen readers, without anything on screen
 *  («Palabra NADIE: 134 px», «Deshecho»). */
export function announce(message: string): void {
  let el = document.getElementById("announcer");
  if (!el) {
    el = h("div", { id: "announcer", class: "visually-hidden", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  const region = el;
  // Emptying first makes the same message twice in a row be said twice.
  region.textContent = "";
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => (region.textContent = message), 60);
}

const FOCUSABLE = "button, [href], input, select, textarea, summary, [tabindex]";

function signature(el: Element): string {
  return `${el.tagName}|${el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""}`;
}

/** Redraws a container without losing the keyboard or screen-reader focus:
 *  the control that had it gets it back in the new content, if it is still
 *  there. */
export function keepFocus(container: HTMLElement, render: () => void): void {
  const active = document.activeElement;
  let key: string | null = null;
  let nth = 0;
  if (active && active !== document.body && container.contains(active)) {
    key = signature(active);
    nth = [...container.querySelectorAll(FOCUSABLE)].filter((e) => signature(e) === key).indexOf(active);
  }
  render();
  if (key === null) return;
  const matches = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => signature(e) === key);
  const target = matches[Math.max(0, nth)] ?? matches[0];
  // If the control is gone (a layer was removed), the focus stays nearby
  // instead of falling back to the top of the page.
  if (target) target.focus({ preventScroll: true });
  else if (container.hasAttribute("tabindex")) container.focus({ preventScroll: true });
}

// Which «Edición avanzada» sections are open survives a redraw of the panel,
// not a reload: every day starts with them closed.
const openAdvanced = new Set<string>();

/** The closed-by-default home of everything the daily routine does not need. */
export function advanced(key: string, ...children: (Node | null | false | undefined)[]): HTMLElement {
  const details = h(
    "details",
    {
      class: "advanced",
      open: openAdvanced.has(key),
      on: {
        toggle: (event: Event) => {
          if ((event.target as HTMLDetailsElement).open) openAdvanced.add(key);
          else openAdvanced.delete(key);
        },
      },
    },
    h("summary", {}, "Edición avanzada"),
    h("div", { class: "panel-body advanced-body" }, ...children),
  );
  return details;
}
