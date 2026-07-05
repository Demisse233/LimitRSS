/**
 * UI 工具：DOM 创建、清理、事件
 */

export function el(tag: string, attrs?: Record<string, any>, ...children: any[]): HTMLElement {
    const node = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === "class") node.className = v;
            else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
            else if (k === "dataset" && typeof v === "object") for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
            else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
            else if (k === "html") node.innerHTML = v;
            else node.setAttribute(k, v === true ? "" : String(v));
        }
    }
    const append = (c: any) => {
        if (c == null || c === false || c === true) return;
        if (Array.isArray(c)) { for (const x of c) append(x); return; }
        if (typeof c === "string") { node.appendChild(document.createTextNode(c)); return; }
        if (c instanceof Node) { node.appendChild(c); return; }
        try { node.appendChild(document.createTextNode(String(c))); } catch { /* */ }
    };
    for (const c of children) append(c);
    return node;
}

export function clear(node: HTMLElement) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

export function on<K extends keyof HTMLElementEventMap>(
    node: HTMLElement, type: K, handler: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions,
) { node.addEventListener(type, handler, opts); return () => node.removeEventListener(type, handler, opts); }

export function debounce<T extends (...a: any[]) => any>(fn: T, wait: number) {
    let t: any;
    return ((...args: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }) as T;
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============== Icon text ==============
import { iconText, normalizeIconName } from "./icons";

export function iconLabel(iconName: string, text?: string, size = 14): HTMLElement {
    return iconText(normalizeIconName(iconName), text, size);
}
