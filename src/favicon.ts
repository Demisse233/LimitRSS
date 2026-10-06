/**
 * 订阅源手动图标设置
 */

import { Subscription } from "./types";
import { el, clear } from "./ui";
import { modal, button, toast } from "./components";
import { siyuanIconEl } from "./icons";
import { Storage } from "./storage";

const EMOJI_GROUPS = [
    { label: "新闻", items: ["📰", "🗞️", "📢", "📣", "💬", "📻"] },
    { label: "科技", items: ["💻", "🖥️", "🤖", "📡", "🔬", "🧪", "⚙️", "🔌"] },
    { label: "财经", items: ["📈", "📉", "💰", "🏦", "💹", "📊"] },
    { label: "学习", items: ["📚", "🎓", "📖", "✏️", "🧠", "💡", "🗂️", "📝"] },
    { label: "生活", items: ["☕", "🍵", "🏠", "🚀", "⭐", "🔥", "🎮", "🎵"] },
    { label: "常用", items: ["🌐", "🔖", "📬", "✉️", "📁", "🗄️", "🏷️"] },
];
const EMOJI_CHOICES = EMOJI_GROUPS.flatMap((g) => g.items);
const MAX_DATA_URL_LENGTH = 20000;

function imageLoadable(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        const done = (ok: boolean) => {
            try { img.src = ""; } catch { /* ignore */ }
            resolve(ok);
        };
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = url;
    });
}

/** 把本地图片压缩到 64px 以内并转 dataURL，控制插件数据体积 */
function compressImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                try {
                    const max = 64;
                    const scale = Math.min(1, max / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * scale));
                    const h = Math.max(1, Math.round(img.height * scale));
                    const canvas = document.createElement("canvas");
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return reject(new Error("无法创建画布"));
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    let url = canvas.toDataURL("image/png");
                    if (url.length > MAX_DATA_URL_LENGTH) {
                        url = canvas.toDataURL("image/jpeg", 0.82);
                    }
                    if (url.length > MAX_DATA_URL_LENGTH) {
                        const s2 = Math.max(1, Math.round(48 * scale));
                        canvas.width = s2;
                        canvas.height = s2;
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(0, 0, s2, s2);
                        ctx.drawImage(img, 0, 0, s2, s2);
                        url = canvas.toDataURL("image/jpeg", 0.72);
                    }
                    resolve(url);
                } catch (e) {
                    reject(e as Error);
                }
            };
            img.onerror = () => reject(new Error("图片解析失败"));
            img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

export function openFaviconDialog(storage: Storage, sub: Subscription, onApplied?: () => void) {
    let current = sub.customFavicon || "";

    const preview = el("div", { class: "ar-favicon-preview" });
    const stateHint = el("div", { class: "ar-favicon-state" });
    const renderPreview = () => {
        clear(preview);
        if (current) {
            if (/^data:image\//.test(current) || /^https?:/i.test(current)) {
                preview.appendChild(el("img", { class: "ar-favicon-preview__img", src: current, alt: "" }));
            } else {
                preview.appendChild(el("span", { class: "ar-favicon-preview__emoji" }, [current]));
            }
        } else {
            preview.appendChild(siyuanIconEl(undefined, "📰"));
        }
        if (!current) stateHint.textContent = "当前：自动抓取图标";
        else if (/^data:image\//.test(current) || /^https?:/i.test(current)) stateHint.textContent = "当前：自定义图片";
        else stateHint.textContent = "当前：自定义 Emoji";
    };
    renderPreview();

    const urlInput = el("input", {
        class: "ar-input",
        type: "text",
        value: /^https?:/i.test(current) ? current : "",
        placeholder: "https://… 图标图片地址",
    }) as HTMLInputElement;

    const applyUrl = async () => {
        const url = urlInput.value.trim();
        if (!url) return toast("请输入图标地址", "warn");
        const ok = await imageLoadable(url);
        if (!ok) return toast("图片无法加载，请检查地址", "error", 4000);
        current = url;
        renderPreview();
        toast("预览已更新，点击「应用」保存", "success", 2000);
    };
    urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applyUrl(); });

    const fileInput = el("input", { type: "file", accept: "image/*", style: { display: "none" } }) as HTMLInputElement;
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
            current = await compressImageFile(file);
            renderPreview();
            toast("图片已压缩为本地图标，点击「应用」保存", "success", 2500);
        } catch (e) {
            toast("处理图片失败：" + (e as Error).message, "error", 4000);
        }
    });

    const emojiRow = el("div", { class: "ar-favicon-emoji" });
    EMOJI_GROUPS.forEach((g) => {
        const group = el("div", { class: "ar-favicon-emoji__group" });
        group.appendChild(el("div", { class: "ar-favicon-emoji__group-label" }, [g.label]));
        const grid = el("div", { class: "ar-favicon-emoji__grid" });
        g.items.forEach((e) => {
            grid.appendChild(el("button", {
                class: `ar-favicon-emoji__item ${current === e ? "ar-favicon-emoji__item--active" : ""}`,
                type: "button",
                onclick: () => { current = e; renderPreview(); },
            }, [e]));
        });
        group.appendChild(grid);
        emojiRow.appendChild(group);
    });

    const doApply = async () => {
        const latest = storage.getSub(sub.id);
        if (!latest) {
            dialog.close();
            return toast("订阅源不存在或已被删除", "error");
        }
        const value = current || undefined;
        if (value && !/^data:image\//.test(value) && !/^https?:/i.test(value) && !EMOJI_CHOICES.includes(value)) {
            return toast("图标格式不支持，请使用图片地址、上传图片或选择 emoji", "warn");
        }
        await storage.patchSubMeta(latest.id, { customFavicon: value });
        onApplied?.();
        dialog.close();
        toast(value ? "图标已更新" : "已清除自定义图标，恢复自动抓取", "success", 2000);
    };

    const doClear = async () => {
        const latest = storage.getSub(sub.id);
        if (!latest) {
            dialog.close();
            return toast("订阅源不存在或已被删除", "error");
        }
        await storage.patchSubMeta(latest.id, { customFavicon: undefined });
        onApplied?.();
        dialog.close();
        toast("已清除自定义图标，恢复自动抓取", "success", 2000);
    };

    const dialog = modal({
        title: `设置图标 · ${sub.name || "未命名订阅源"}`,
        width: "460px",
        content: el("div", { class: "ar-form" }, [
            preview,
            stateHint,
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["图片 URL"]),
                el("div", { class: "ar-favicon-url" }, [
                    urlInput,
                    button({ text: "预览", size: "sm", variant: "secondary", onclick: () => applyUrl() }),
                ]),
            ]),
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["上传图片"]),
                el("div", { class: "ar-favicon-upload" }, [
                    button({ text: "选择图片", icon: "image", variant: "secondary", onclick: () => fileInput.click() }),
                    el("span", { class: "ar-form__hint" }, ["自动压缩到 64px 以内"]),
                ]),
            ]),
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["Emoji"]),
                emojiRow,
            ]),
        ]),
        footer: [
            button({ text: "清除自定义", variant: "ghost", danger: true, onclick: doClear }),
            button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
            button({ text: "应用", variant: "primary", onclick: doApply }),
        ],
    });
}
