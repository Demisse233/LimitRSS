/**
 * 阅读区图片操作：桌面右键菜单 / 手机长按菜单（复制图片、复制链接、打开）
 */

import { dropdown, DropdownItem, toast } from "./components";
import { attachLongPress } from "./longPress";
import { summaryCopyMenuItems } from "./aiCardMenu";

interface SelectionOpts {
    // 预留扩展
}

async function fetchImageBlob(src: string): Promise<Blob> {
    if (/^data:/i.test(src)) {
        const resp = await fetch(src);
        return resp.blob();
    }
    const resp = await fetch(src, { mode: "cors" });
    if (!resp.ok) throw new Error("图片下载失败（可能受跨域限制）");
    return resp.blob();
}

/** 跨域受限时尝试 canvas 转码（部分站点允许匿名 CORS 加载） */
async function imageViaCanvas(src: string): Promise<Blob | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth || 1;
                canvas.height = img.naturalHeight || 1;
                const ctx = canvas.getContext("2d");
                if (!ctx) return resolve(null);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((b) => resolve(b), "image/png");
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function copyImageToClipboard(src: string, imgEl?: HTMLImageElement): Promise<boolean> {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") return false;
    try {
        const blob = await fetchImageBlob(src);
        if (blob) await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
        return true;
    } catch {
        try {
            const blob = await imageViaCanvas(src);
            if (!blob) return false;
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            return true;
        } catch {
            return false;
        }
    }
    // 通道3：选中图片 DOM 后 execCommand("copy")（无跨域限制，兼容 WebView）
    if (imgEl && imgEl.isConnected) {
        try {
            const range = document.createRange();
            range.selectNodeContents(imgEl);
            const sel = document.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            const ok = document.execCommand("copy");
            sel?.removeAllRanges();
            if (ok) return true;
        } catch { /* ignore */ }
    }
    return false;
}

async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch { /* fallthrough */ }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

function showImageMenu(img: HTMLImageElement, isMobile: boolean) {
    const src = img.getAttribute("src") || "";
    if (!src) return;
    const items: DropdownItem[] = isMobile ? [
        {
            label: "打开图片",
            icon: "external",
            onClick: () => { try { window.open(src, "_blank"); } catch { /* ignore */ } },
        },
        {
            label: "复制图片链接",
            icon: "link",
            onClick: async () => {
                const ok = await copyText(src);
                toast(ok ? "图片链接已复制" : "复制失败", ok ? "success" : "error", 2000);
            },
        },
    ] : [
        {
            label: "复制图片",
            icon: "copy",
            onClick: async () => {
                const ok = await copyImageToClipboard(src, img);
                if (ok) {
                    toast("图片已复制", "success", 1500);
                    navigator.vibrate?.(30);
                } else {
                    const linkOk = await copyText(src);
                    toast(linkOk ? "复制图片失败，已复制图片链接" : "复制图片失败", "error", 4000);
                }
            },
        },
        {
            label: "复制图片链接",
            icon: "link",
            onClick: async () => {
                const ok = await copyText(src);
                toast(ok ? "图片链接已复制" : "复制失败", ok ? "success" : "error", 2000);
            },
        },
        {
            label: "打开图片",
            icon: "external",
            onClick: () => { try { window.open(src, "_blank"); } catch { /* ignore */ } },
        },
    ];
    dropdown(img, items, "170px");
}

/** AI 总结卡片：显示“复制文本”菜单（手机长按 / 桌面右键共用） */
function showAICardCopyMenu(card: HTMLElement) {
    const body = card.querySelector(".ar-rd__ai-card-body") as HTMLElement | null;
    dropdown(card, summaryCopyMenuItems(
        () => body?.textContent || "",
        (text) => {
            copyText(text).then((ok) => toast(ok ? "AI 总结文本已复制" : "复制失败", ok ? "success" : "error", 2000));
        },
    ), "170px");
}

/** 在阅读区内挂载图片右键 / 长按菜单 */
export function attachSelection(root: HTMLElement, _opts?: SelectionOpts) {
    // 桌面端右键
    root.addEventListener("contextmenu", (ev) => {
        const t = ev.target as HTMLElement;
        const img = t?.closest?.("img") as HTMLImageElement | null;
        if (!img || !img.getAttribute("src")) return;
        ev.preventDefault();
        showImageMenu(img, false);
    });
    // 桌面端右键：AI 总结卡片 → 复制文本菜单（图片菜单优先）
    root.addEventListener("contextmenu", (ev) => {
        const t = ev.target as HTMLElement;
        if (t?.closest?.("img")) return;
        const card = t?.closest?.(".ar-rd__ai-card") as HTMLElement | null;
        if (!card) return;
        ev.preventDefault();
        showAICardCopyMenu(card);
    });

    // 手机端长按（约 600ms，滑动取消）
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let pendingImg: HTMLImageElement | null = null;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pendingImg = null;
    };

    root.addEventListener("touchstart", (ev) => {
        const t = ev.target as HTMLElement;
        const img = t?.closest?.("img") as HTMLImageElement | null;
        if (!img || !img.getAttribute("src")) return;
        const touch = ev.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        pendingImg = img;
        timer = setTimeout(() => {
            timer = null;
            const imgEl = pendingImg;
            pendingImg = null;
            if (imgEl) showImageMenu(imgEl, true);
        }, 600);
    }, { passive: true });

    root.addEventListener("touchend", clearTimer);
    root.addEventListener("touchcancel", clearTimer);
    root.addEventListener("touchmove", (ev) => {
        if (!timer) return;
        const touch = ev.touches[0];
        if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
            clearTimer();
        }
    }, { passive: true });

    // AI 总结卡片长按 → 复制文本菜单（图片长按优先）
    attachLongPress(root, {
        match: (t) => {
            const target = t as HTMLElement | null;
            if (!target?.closest) return false;
            if (target.closest("img")) return false;
            return !!target.closest(".ar-rd__ai-card");
        },
        onTrigger: (ev) => {
            const target = ev.target as HTMLElement | null;
            const card = target?.closest?.(".ar-rd__ai-card") as HTMLElement | null;
            if (card) showAICardCopyMenu(card);
        },
    });
}
