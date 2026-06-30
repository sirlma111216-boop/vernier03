/** Tiny DOM helpers. */

type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<
  Partial<HTMLElementTagNameMap[K]>,
  "style"
> & {
  class?: string;
  html?: string;
  style?: string;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {} as ElProps<K>,
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v as string;
    else if (k === "html") node.innerHTML = v as string;
    else if (k === "style" && typeof v === "string") node.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "dataset") {
      Object.assign(node.dataset, v);
    } else {
      // @ts-expect-error dynamic assignment
      node[k] = v;
    }
  }
  for (const c of children) node.append(c);
  return node;
}

export function qs<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
