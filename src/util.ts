/**
 * 工具函数
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function genId(prefix = ""): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const H = String(d.getHours()).padStart(2, "0");
    const M = String(d.getMinutes()).padStart(2, "0");
    const S = String(d.getSeconds()).padStart(2, "0");
    let r = "";
    for (let i = 0; i < 7; i++) r += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return `${prefix}${y}${m}${dd}${H}${M}${S}-${r}`;
}

// ============== 保存路径 ==============

const ILLEGAL_PATH_CHARS = /[\\/:*?"<>|]/g;

/** 清理单个路径片段：去掉文件系统非法字符，压缩空白 */
export function sanitizePathSegment(value: string): string {
    return (value || "")
        .replace(ILLEGAL_PATH_CHARS, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * 把用户输入的目录规范成 `/a/b` 形式：
 * - 反斜杠转斜杠
 * - 解析 `.` 和 `..`，避免路径穿越
 * - 每段清理非法字符
 */
export function normalizeSaveDir(raw: string): string {
    const parts = (raw || "")
        .replace(/\\/g, "/")
        .split("/")
        .map(sanitizePathSegment);
    const stack: string[] = [];
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    return "/" + stack.join("/");
}

/** 组合 createDocWithMd 需要的 hpath：目录 + 文档名 */
export function buildSavePath(dir: string, name: string): string {
    const safeDir = normalizeSaveDir(dir);
    const safeName = (sanitizePathSegment(name) || "untitled").slice(0, 120);
    return (safeDir === "/" ? "" : safeDir) + "/" + safeName;
}

/**
 * 思源笔记本图标可能是十六进制码点（如 "1f4d3"），也可能是 emoji 字符。
 * 自定义 SVG 图标名无法放进原生 <select>，统一回退到 📓。
 */
export function notebookIcon(icon?: string): string {
    const raw = (icon || "").trim();
    if (!raw) return "📓";
    if (/^[0-9a-f]{4,8}(?:[-_][0-9a-f]{4,8})*$/i.test(raw)) {
        try {
            const points = raw.split(/[-_]/)
                .map((part) => parseInt(part, 16))
                .filter((point) => Number.isFinite(point) && point > 0 && point <= 0x10ffff);
            if (points.length) return String.fromCodePoint(...points);
        } catch {
            /* fall through */
        }
    }
    // 自定义图片图标（如 AI.png）无法放进原生 <select>
    if (/\.(?:png|jpe?g|svg|webp|gif|ico)$/i.test(raw)) return "📓";
    if (raw.startsWith("icon")) return "📓";
    return raw;
}

/** 用文章 ID 集合判断日报缓存是否仍然有效（与顺序无关） */
export function dailySignature(ids: string[]): string {
    return [...ids].sort().join("|");
}

/** 仅接受 http/https URL（订阅源图标、原文链接等） */
export function isHttpUrl(value: string): boolean {
    try {
        const url = new URL((value || "").trim());
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * 判断键盘事件是否发生在可编辑区域，避免 J/K/M/S 等快捷键打断输入。
 * 同时覆盖原生表单控件、contenteditable 和思源的 Protyle 编辑器。
 */
export function isEditableElement(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (typeof el.getAttribute === "function") {
        if (el.getAttribute("role") === "textbox") return true;
        if (el.getAttribute("contenteditable") === "true") return true;
    }
    if (typeof (el as any).closest === "function") {
        return !!(el as any).closest("[contenteditable='true'], .protyle-wysiwyg, .protyle-title");
    }
    return false;
}
