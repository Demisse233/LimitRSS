/**
 * 通用 UI 组件
 */

import { el } from "./ui";
import { icon as makeIcon } from "./icons";

// ============== Button ==============

export interface BtnOpt {
    variant?: "primary" | "secondary" | "ghost" | "danger" | "icon" | "text";
    size?: "xs" | "sm" | "md";
    icon?: string;
    text?: string;
    title?: string;
    active?: boolean;
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    danger?: boolean;
    onclick?: (ev: MouseEvent) => void;
    className?: string;
}

export function button(opts: BtnOpt): HTMLElement {
    const v = opts.variant || "secondary";
    const s = opts.size || "sm";
    const cls = [
        "ar-btn", `ar-btn--${v}`, `ar-btn--${s}`,
        opts.active && "ar-btn--active",
        opts.loading && "ar-btn--loading",
        opts.block && "ar-btn--block",
        opts.danger && v === "ghost" && "ar-btn--danger",
        opts.className || "",
    ].filter(Boolean).join(" ");

    const content: any[] = [];
    if (opts.loading) content.push(el("span", { class: "ar-btn__spin" }));
    else if (opts.icon) {
        const sz = s === "xs" ? 12 : s === "sm" ? 14 : 16;
        const w = document.createElement("span");
        w.className = "ar-btn__icon";
        w.appendChild(makeIcon(opts.icon, sz));
        content.push(w);
    }
    if (opts.text) content.push(opts.text);

    return el("button", {
        class: cls,
        type: "button",
        title: opts.title,
        disabled: opts.disabled || opts.loading,
        onclick: opts.onclick,
    }, content);
}

// ============== Toast ==============

let toastContainer: HTMLElement | null = null;
function ensureToast() {
    if (!toastContainer) {
        toastContainer = el("div", { class: "ar-toast-c" });
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

export function toast(msg: string, type: "info" | "success" | "error" | "warn" = "info", duration = 3000) {
    const c = ensureToast();
    const iconName = type === "success" ? "checkPlain" : type === "error" ? "closePlain" : type === "warn" ? "warnPlain" : "infoPlain";
    const msgEl = el("span", { class: "ar-toast__msg" }, [msg]);
    const t = el("div", { class: `ar-toast ar-toast--${type}` }, [
        el("span", { class: "ar-toast__icon" }, [makeIcon(iconName, 18)]),
        msgEl,
        el("button", { class: "ar-toast__close", onclick: () => dismiss() }, [makeIcon("closePlain", 14)]),
    ]);
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add("ar-toast--in"));
    let timer: any;
    function dismiss() {
        t.classList.remove("ar-toast--in");
        setTimeout(() => t.remove(), 200);
        if (timer) clearTimeout(timer);
    }
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return {
        update(text: string) { msgEl.textContent = text; },
        dismiss,
    };
}

// ============== Modal ==============

export interface ModalOpt {
    title?: string;
    width?: string;
    content: HTMLElement;
    onClose?: () => void;
    footer?: (HTMLElement | null)[];
}

export function modal(opt: ModalOpt): { close: () => void; setTitle: (t: string) => void; container: HTMLElement } {
    const titleEl = el("div", { class: "ar-modal__title" }, [opt.title || ""]);
    const closeBtn = el("button", { class: "ar-modal__close", title: "关闭", onclick: () => close() }, ["×"]);
    const header = el("div", { class: "ar-modal__header" }, [titleEl, closeBtn]);
    const body = el("div", { class: "ar-modal__body" }, [opt.content]);
    const dialog = el("div", { class: "ar-modal__dialog", style: { width: opt.width, maxWidth: opt.width || "560px" } }, [header, body]);
    if (opt.footer && opt.footer.length) {
        const f = el("div", { class: "ar-modal__footer" });
        for (const x of opt.footer) if (x) f.appendChild(x);
        dialog.appendChild(f);
    }
    const backdrop = el("div", { class: "ar-modal__backdrop" }, [dialog]);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("ar-modal--in"));
    function close() {
        backdrop.classList.remove("ar-modal--in");
        document.removeEventListener("keydown", esc);
        setTimeout(() => { backdrop.remove(); opt.onClose?.(); }, 200);
    }
    return { close, setTitle: (t) => { titleEl.textContent = t; }, container: backdrop };
}

// ============== Dropdown ==============

export interface DropdownItem {
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    divider?: boolean;
}

let activeDrop: HTMLElement | null = null;
function closeDrop() { if (activeDrop) { activeDrop.remove(); activeDrop = null; } }
document.addEventListener("click", (e) => { if (activeDrop && !activeDrop.contains(e.target as Node)) closeDrop(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrop(); });

export function dropdown(target: HTMLElement, items: DropdownItem[], width = "180px") {
    closeDrop();
    const menu = el("div", { class: "ar-drop", style: { width } });
    for (const it of items) {
        if (it.divider) { menu.appendChild(el("div", { class: "ar-drop__sep" })); continue; }
        menu.appendChild(el("button", {
            class: `ar-drop__item ${it.danger ? "ar-drop__item--danger" : ""}`,
            disabled: it.disabled,
            onclick: () => { closeDrop(); it.onClick?.(); },
        }, [
            it.icon ? el("span", { class: "ar-drop__icon" }, [makeIcon(it.icon, 14)]) : null,
            el("span", {}, [it.label]),
        ]));
    }
    document.body.appendChild(menu);
    const rect = target.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    let top = rect.bottom + 4, left = rect.left;
    if (top + mr.height > window.innerHeight - 8) top = window.innerHeight - mr.height - 8;
    if (left + mr.width > window.innerWidth - 8) left = window.innerWidth - mr.width - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    menu.style.top = top + "px";
    menu.style.left = left + "px";
    requestAnimationFrame(() => menu.classList.add("ar-drop--in"));
    activeDrop = menu;
}

// ============== Spinner ==============

export function spinner(size = 14): HTMLElement {
    return el("div", { class: "ar-spin", style: { width: size + "px", height: size + "px" } });
}

// ============== Empty state ==============

export function empty(icon_: string, title: string, desc?: string): HTMLElement {
    return el("div", { class: "ar-empty" }, [
        el("div", { class: "ar-empty__icon" }, [makeIcon(icon_, 38)]),
        el("div", { class: "ar-empty__title" }, [title]),
        desc ? el("div", { class: "ar-empty__desc" }, [desc]) : null,
    ].filter(Boolean) as HTMLElement[]);
}
