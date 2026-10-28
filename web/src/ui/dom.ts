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
export function toast(message: string): void {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = h("div", { class: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove("visible"), 3200);
}
