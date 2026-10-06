/**
 * 保存文章到思源
 */

import { Article, AIResult, Settings, Subscription } from "./types";
import { el, clear } from "./ui";
import { modal, button, toast } from "./components";
import { siyuanIconEl } from "./icons";
import { fetchSyncPost } from "siyuan";
import type { PathMemory } from "./saveTargetStore";
import { cleanMarkdownLinks, stripPluginFrontmatter } from "./markdownClean";

interface Notebook { id: string; name: string; icon?: string; closed?: boolean; }

const FOLDER_ILLEGAL = /[\\:*?"<>|]/g;

/** 保存前预处理文章 HTML：清理无用标签、绝对化链接/图片、标题降级、空段落清理 */
function preprocessArticleHtml(html: string, baseUrl?: string): string {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    tmp.querySelectorAll("script,style,noscript,iframe,form,button,template,svg,object,embed").forEach((n) => n.remove());
    tmp.querySelectorAll("[onclick],[onerror],[onload]").forEach((n) => {
        ["onclick", "onerror", "onload"].forEach((a) => n.removeAttribute(a));
    });
    tmp.querySelectorAll("a").forEach((a) => {
        let href = a.getAttribute("href") || "";
        if (href && baseUrl && !/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) {
            try { href = new URL(href, baseUrl).href; } catch { /* keep */ }
        }
        a.setAttribute("href", href);
        a.removeAttribute("target");
        a.removeAttribute("rel");
    });
    const seenImg = new Set<string>();
    tmp.querySelectorAll("img").forEach((img) => {
        let src = img.getAttribute("src") || "";
        if (src && baseUrl && !/^(https?:|data:|blob:)/i.test(src)) {
            try { src = new URL(src, baseUrl).href; } catch { /* keep */ }
        }
        if (src && seenImg.has(src)) {
            img.remove(); // 相同图片只保留第一张，避免图文重复
            return;
        }
        if (src) seenImg.add(src);
        img.setAttribute("src", src);
        if (!img.getAttribute("alt")) img.setAttribute("alt", "");
        ["loading", "width", "height", "style"].forEach((a) => img.removeAttribute(a));
    });
    tmp.querySelectorAll("p,div,section").forEach((n) => {
        if (!n.textContent?.trim() && !n.querySelector("img,table,pre,ul,ol,blockquote")) n.remove();
    });
    // 正文 h1 降级为 h2，避免与文档标题重复
    tmp.querySelectorAll("h1").forEach((h) => {
        const h2 = document.createElement("h2");
        h2.innerHTML = h.innerHTML;
        h.replaceWith(h2);
    });
    return tmp.innerHTML;
}

/** 去除 Markdown 中完全重复的相邻段落/图片块 */
function dedupeMarkdown(md: string): string {
    const blocks = md.split(/\n{2,}/);
    const out: string[] = [];
    let prev = "";
    for (const b of blocks) {
        const t = b.trim();
        if (!t) continue;
        if (t !== prev) out.push(t);
        prev = t;
    }
    return out.join("\n\n") + "\n";
}

function safeFolder(s: string): string {
    return (s || "")
        .split("/")
        .map((seg) => seg.trim().replace(FOLDER_ILLEGAL, " ").replace(/\s+/g, " ").trim())
        .filter((seg) => seg && seg !== "." && seg !== "..")
        .join("/")
        .replace(/^\/+|\/+$/g, "");
}

/** 渲染保存目录模板：{{source}} {{category}} {{date}} {{year}} {{month}} */
export function renderFolderTemplate(template: string | undefined, article?: Article, sub?: Subscription): string {
    const d = article?.pubDate ? new Date(article.pubDate) : new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (template || "")
        .replace(/\{\{source\}\}/g, sub?.name || "")
        .replace(/\{\{category\}\}/g, sub?.categoryName || "未分类")
        .replace(/\{\{date\}\}/g, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
        .replace(/\{\{year\}\}/g, String(d.getFullYear()))
        .replace(/\{\{month\}\}/g, pad(d.getMonth() + 1));
}

/** 确保笔记本内的父目录存在；旧内核无 mkdirs 接口时忽略错误，交给 createDocWithMd 处理 */
async function ensureParentDirs(notebook: string, folder: string) {
    if (!folder) return;
    try {
        await fetchSyncPost("/api/filetree/mkdirs", { notebook, path: "/" + folder });
    } catch { /* ignore */ }
}

interface TreeEntry { name: string; path: string; icon?: string; subFileCount: number; }

interface TargetPicker {
    wrap: HTMLElement;
    getNotebook(): string;
    getFolder(): string;
    resolvePath(docName: string): Promise<string>;
    destroy(): void;
}

function safeName(s: string): string {
    return (s || "untitled")
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "untitled";
}

/** 渲染思源模板语法：{{now | date "20060102150405"}} → 当前时间 */
function renderPathTemplate(s: string): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const tokens: [string, string][] = [
        ["2006", String(d.getFullYear())],
        ["01", pad(d.getMonth() + 1)],
        ["02", pad(d.getDate())],
        ["15", pad(d.getHours())],
        ["04", pad(d.getMinutes())],
        ["05", pad(d.getSeconds())],
    ];
    return (s || "").replace(/\{\{\s*now\s*\|\s*date\s*"([^"]*)"\s*\}\}/g, (_m, fmt: string) => {
        let out = fmt;
        tokens.forEach(([t, v]) => { out = out.split(t).join(v); });
        return out;
    });
}

/** 解析目标路径：/开头 = 选中笔记本根路径；否则 = 当前文档所在目录的相对路径；支持文档ID或可读路径 */
async function resolveTargetPath(notebook: string, folderInput: string, docName: string): Promise<string> {
    const raw = (folderInput || "").trim();
    const folder = renderPathTemplate(raw).replace(/^\/+|\/+$/g, "");
    const name = safeName(docName);
    if (!raw) return "/" + name;
    if (raw.startsWith("/")) {
        return "/" + [folder, name].filter(Boolean).join("/");
    }
    // 相对当前文档所在目录
    try {
        const protyle = document.querySelector<HTMLElement>(".protyle[data-node-id]");
        const id = protyle?.getAttribute("data-node-id");
        if (id) {
            const safeId = id.replace(/'/g, "''");
            const r: any = await fetchSyncPost("/api/query/sql", {
                stmt: `SELECT box, path FROM blocks WHERE id = '${safeId}' AND type = 'd' LIMIT 1`,
            });
            const row = r?.data?.[0];
            if (row?.box === notebook && row.path) {
                const dir = String(row.path).replace(/\/[^/]+$/, "");
                return "/" + [dir.replace(/^\/+/, ""), folder, name].filter(Boolean).join("/");
            }
        }
    } catch { /* ignore */ }
    return "/" + [folder, name].filter(Boolean).join("/");
}

/** 目标位置选择器：笔记本下拉（自适应宽度）+ 文档路径输入 */
function createTargetPicker(notebooks: Notebook[], initialNotebook: string, initialFolder: string, onPick: () => void, paths?: PathMemory): TargetPicker {
    let selectedNb = notebooks.some((n) => n.id === initialNotebook) ? initialNotebook : notebooks[0].id;
    const nbSelect = el("select", { class: "ar-input ar-save-nb-select" }) as HTMLSelectElement;
    let currentPath = paths ? paths.get(selectedNb, initialFolder) : initialFolder;
    const pathInput = el("input", {
        class: "ar-input ar-save-path-input",
        type: "text",
        value: currentPath,
        placeholder: "/folder/{{now | date \"20060102150405\"}} 或相对路径",
        spellcheck: "false",
    }) as HTMLInputElement;

    const renderNbSelect = () => {
        nbSelect.innerHTML = "";
        notebooks.forEach((n) => nbSelect.appendChild(el("option", { value: n.id, selected: n.id === selectedNb }, [n.name])));
    };
    nbSelect.addEventListener("change", () => {
        // 先记忆当前笔记本的输入，再切换并恢复目标笔记本的已存路径
        if (paths) paths.remember(selectedNb, pathInput.value);
        selectedNb = nbSelect.value;
        currentPath = paths ? paths.get(selectedNb, initialFolder) : initialFolder;
        pathInput.value = currentPath;
        onPick();
    });
    pathInput.addEventListener("input", () => {
        currentPath = pathInput.value;
        if (paths) paths.remember(selectedNb, currentPath);
        onPick();
    });

    renderNbSelect();

    return {
        wrap: el("div", { class: "ar-save-target__selects" }, [nbSelect, pathInput]),
        getNotebook: () => selectedNb,
        getFolder: () => renderPathTemplate(pathInput.value || "").trim(),
        resolvePath: (docName) => resolveTargetPath(selectedNb, pathInput.value || "", docName),
        destroy: () => { /* 无额外资源 */ },
    };
}

/** @deprecated 旧版文档树选择器（保留避免大段删除，不再使用） */
function createTargetPickerLegacy(notebooks: Notebook[], initialNotebook: string, initialFolder: string, onPick: () => void): TargetPicker {
    let selectedNb = notebooks.some((n) => n.id === initialNotebook) ? initialNotebook : notebooks[0].id;
    let selectedFolder = safeFolder(initialFolder);
    const nbSelect = el("select", { class: "ar-input ar-save-nb-select" }) as HTMLSelectElement;

    const docBtn = el("button", { class: "ar-input ar-doc-picker-btn", type: "button" }) as HTMLButtonElement;
    const docPanel = el("div", { class: "ar-doc-picker" });
    document.body.appendChild(docPanel); // 挂到 body：避免弹窗 transform/overflow 导致的定位偏移与裁剪
    let docOpen = false;
    interface DocNode { entry: TreeEntry; children: TreeEntry[]; loaded: boolean; expanded: boolean; }
    const tree = new Map<string, DocNode>();

    const rootNode: DocNode = { entry: { name: "（笔记本根目录）", path: "", icon: undefined, subFileCount: 1 }, children: [], loaded: false, expanded: true };
    tree.set("", rootNode);

    const loadChildren = async (path: string) => {
        const node = tree.get(path);
        if (!node || node.loaded) return;
        const nb = selectedNb;
        let list: TreeEntry[] = [];
        try {
            const r: any = await fetchSyncPost("/api/filetree/listDocsByPath", { notebook: nb, path: path ? "/" + path : "/" });
            if (nb !== selectedNb) return; // 切换笔记本后的竞态结果丢弃
            const files = Array.isArray(r?.data) ? r.data : (r?.data?.files || []);
            list = (files || []).map((f: any) => ({
                name: String(f.name || (f.path || "").split("/").filter(Boolean).pop() || "未命名"),
                path: String(f.path || "").replace(/^\/+|\/+$/g, ""),
                icon: f.icon,
                subFileCount: typeof f.subFileCount === "number" ? f.subFileCount : 0,
            })).filter((e) => e.name && e.name !== "未命名");
        } catch (e) {
            console.warn("[ai-rss] listDocsByPath failed", path, e);
            return; // 失败不标记 loaded，保留展开箭头可重试
        }
        if (nb !== selectedNb) return;
        node.loaded = true;
        node.children = list;
        list.forEach((e) => {
            if (!tree.has(e.path)) tree.set(e.path, { entry: e, children: [], loaded: false, expanded: false });
        });
    };

    const updateDocBtn = () => {
        docBtn.textContent = selectedFolder ? "/" + selectedFolder : "（笔记本根目录）";
    };

    const isAncestor = (path: string) => {
        if (!path || !selectedFolder) return false;
        return selectedFolder === path || selectedFolder.startsWith(path + "/");
    };

    const renderDocPanel = () => {
        const prevTop = docPanel.scrollTop;
        clear(docPanel);
        const renderNode = (path: string, depth: number) => {
            const node = tree.get(path);
            if (!node) return;
            const row = el("div", {
                class: `ar-doc-picker__row ${selectedFolder === path ? "ar-doc-picker__row--active" : ""} ${isAncestor(path) ? "ar-doc-picker__row--ancestor" : ""}`,
                style: { paddingLeft: `${8 + depth * 14}px` },
            });
            const expandBtn = node.loaded && node.children.length === 0
                ? el("span", { style: { width: 24, flexShrink: 0 } })
                : button({
                    variant: "icon", size: "xs",
                    icon: node.expanded ? "chevronDown" : "chevronRight",
                    title: node.expanded ? "折叠" : "展开",
                    onclick: async (ev) => {
                        ev.stopPropagation();
                        node.expanded = !node.expanded;
                        if (node.expanded && !node.loaded) await loadChildren(path);
                        renderDocPanel();
                    },
                });
            row.appendChild(expandBtn);
            row.appendChild(siyuanIconEl(node.entry.icon, node.children.length || node.entry.subFileCount > 0 ? "📁" : "📄"));
            row.appendChild(el("span", { class: "ar-doc-picker__name" }, [node.entry.name]));
            row.addEventListener("click", () => {
                selectedFolder = path;
                updateDocBtn();
                onPick();
                renderDocPanel();
            });
            docPanel.appendChild(row);
            if (node.expanded) {
                node.children.forEach((c) => renderNode(c.path, depth + 1));
            }
        };
        renderNode("", 0);
        if (selectedFolder && !tree.has(selectedFolder)) {
            docPanel.appendChild(el("div", { class: "ar-doc-picker__row ar-doc-picker__row--active" }, [
                el("span", { class: "ar-doc-picker__name" }, ["（路径：/" + selectedFolder + "）"]),
            ]));
        }
        requestAnimationFrame(() => { docPanel.scrollTop = prevTop; });
    };

    const positionPanel = () => {
        const rect = docBtn.getBoundingClientRect();
        docPanel.style.position = "fixed";
        docPanel.style.left = Math.max(8, rect.left) + "px";
        docPanel.style.top = Math.min(rect.bottom + 4, window.innerHeight - 16) + "px";
        docPanel.style.width = Math.max(220, rect.width) + "px";
        docPanel.style.maxHeight = Math.min(260, Math.max(120, window.innerHeight - rect.bottom - 16)) + "px";
    };

    docBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        docOpen = !docOpen;
        if (docOpen) {
            renderDocPanel();
            positionPanel();
            docPanel.style.display = "block";
        } else {
            docPanel.style.display = "none";
        }
    });
    const onScroll = () => {
        if (docOpen) {
            docOpen = false;
            docPanel.style.display = "none";
        }
    };
    window.addEventListener("scroll", onScroll, true);
    const onDocClick = (ev: MouseEvent) => {
        // 用 composedPath 判断：面板内元素重绘后仍能正确识别为内部点击
        if (docOpen && ev.target !== docBtn && !ev.composedPath().includes(docPanel)) {
            docOpen = false;
            docPanel.style.display = "none";
        }
    };
    document.addEventListener("click", onDocClick);

    const renderNbSelect = () => {
        nbSelect.innerHTML = "";
        notebooks.forEach((n) => nbSelect.appendChild(el("option", { value: n.id, selected: n.id === selectedNb }, [n.name])));
    };
    nbSelect.addEventListener("change", () => {
        selectedNb = nbSelect.value;
        selectedFolder = "";
        tree.clear();
        tree.set("", { ...rootNode, expanded: true });
        updateDocBtn();
        loadChildren("").then(() => { if (docOpen) renderDocPanel(); });
        onPick();
    });

    renderNbSelect();
    updateDocBtn();
    loadChildren("").then(() => { if (docOpen) renderDocPanel(); });

    return {
        wrap: el("div", { class: "ar-save-target__selects" }, [
            nbSelect,
            el("div", { class: "ar-doc-picker-wrap" }, [docBtn]),
        ]),
        getNotebook: () => selectedNb,
        getFolder: () => selectedFolder,
        resolvePath: (docName) => resolveTargetPath(selectedNb, selectedFolder, docName),
        destroy: () => {
            document.removeEventListener("click", onDocClick);
            window.removeEventListener("scroll", onScroll, true);
            docPanel.remove();
        },
    };
}

export async function saveToSiyuan(article: Article, settings: Settings, aiResults: Record<string, AIResult> = {}, sub?: Subscription, paths?: PathMemory, onCleanLinksChange?: (v: boolean) => void) {
    // 兜底：从全局存储取最新 AI 结果，避免闭包引用/对象替换导致总结丢失
    try {
        const g = (window as any).__ai_rss__;
        const fresh = g?.storage?.getArticle?.(article.id);
        if (fresh?.aiResults && Object.keys(fresh.aiResults).length) {
            aiResults = { ...aiResults, ...fresh.aiResults };
        }
    } catch { /* ignore */ }

    // 加载笔记本
    let notebooks: Notebook[] = [];
    try {
        const r: any = await fetchSyncPost("/api/notebook/lsNotebooks", {});
        if (r.code === 0 && r.data?.notebooks) {
            notebooks = r.data.notebooks.filter((n: Notebook) => !n.closed);
        }
    } catch { /* ignore */ }
    if (notebooks.length === 0) {
        toast("没有可用的笔记本", "error");
        return null;
    }

    // 默认选中
    const defaultNb = notebooks.find((n) => n.id === settings.save.defaultNotebook) || notebooks[0];

    let downloadImages = settings.save.downloadImages;
    let includeLink = settings.save.includeSourceLink;
    let cleanLinks = settings.save.cleanLinks !== false;
    let tags = (article.tags || []).join(", ");

    const safeName = (s: string) => (s || "untitled")
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "untitled";

    const nameInput = el("input", { class: "ar-input", type: "text", value: safeName(article.title) });
    const pathPreviewEl = el("div", { class: "ar-form__hint ar-save-path-hint" });
    const linkCheck = el("input", { type: "checkbox" }) as HTMLInputElement; linkCheck.checked = includeLink;
    const imgCheck = el("input", { type: "checkbox" }) as HTMLInputElement; imgCheck.checked = downloadImages;
    const cleanCheck = el("input", { type: "checkbox" }) as HTMLInputElement; cleanCheck.checked = cleanLinks;
    const tagInput = el("input", { class: "ar-input", type: "text", value: tags, placeholder: "用逗号分隔" });
    const previewEl = el("pre", { class: "ar-preview" });

    const updatePreview = () => {
        const md = composeMd(article, settings, picker.getNotebook(), { includeLink, cleanLinks });
        previewEl.textContent = md.slice(0, 1500) + (md.length > 1500 ? "\n…" : "");
        const nbName = notebooks.find((n) => n.id === picker.getNotebook())?.name || "";
        picker.resolvePath(safeName((nameInput as HTMLInputElement).value || article.title))
            .then((finalPath) => { pathPreviewEl.textContent = `将保存到：${nbName}${finalPath}.md`; })
            .catch(() => { pathPreviewEl.textContent = "将保存到：" + nbName; });
    };
    const picker = createTargetPicker(notebooks, defaultNb.id, settings.save.folderTemplate || "", updatePreview, paths);
    setTimeout(updatePreview, 50);
    linkCheck.addEventListener("change", () => { includeLink = linkCheck.checked; updatePreview(); });
    imgCheck.addEventListener("change", () => { downloadImages = imgCheck.checked; updatePreview(); });
    cleanCheck.addEventListener("change", () => { cleanLinks = cleanCheck.checked; onCleanLinksChange?.(cleanLinks); updatePreview(); });
    [nameInput, linkCheck, imgCheck, cleanCheck, tagInput].forEach((e) => {
        e.addEventListener("change", updatePreview);
        e.addEventListener("input", updatePreview);
    });

    const doSave = async () => {
        const md = composeMd(article, settings, picker.getNotebook(), { includeLink, cleanLinks });
        const tags2 = (tagInput as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean);
        const saveBtn = dialog.container.querySelector(".ar-save-btn") as HTMLButtonElement;
        saveBtn.disabled = true;
        saveBtn.textContent = "保存中…";
        try {
            const finalPath = await picker.resolvePath(safeName((nameInput as HTMLInputElement).value || article.title));
            await ensureParentDirs(picker.getNotebook(), finalPath.replace(/\/[^/]+$/, "").replace(/^\/+/, ""));
            const r: any = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: picker.getNotebook(),
                path: finalPath,
                markdown: md,
            });
            if (r.code !== 0 || !r.data) {
                throw new Error(r.msg || "创建文档失败");
            }
            const docId = r.data as string;
            await fetchSyncPost("/api/sqlite/flushTransaction", {}).catch(() => {});
            if (imgCheck.checked) {
                await fetchSyncPost("/api/format/netImg2LocalAssets", { id: docId, url: article.link || "" }).catch(() => {});
            }
            if (tags2.length > 0) {
                await fetchSyncPost("/api/attr/setBlockAttrs", {
                    id: docId,
                    attrs: {
                        "custom-ai-rss-tags": tags2.join(","),
                        "custom-ai-rss-link": article.link || "",
                    },
                }).catch(() => {});
            }
            toast("已保存到思源", "success", 4000);
            return docId;
        } catch (e) {
            toast("保存失败：" + (e as Error).message, "error", 5000);
            saveBtn.disabled = false;
            saveBtn.textContent = "保存到思源";
            return null;
        }
    };

    const dialog = modal({
        title: "保存到思源",
        width: "640px",
        onClose: () => picker.destroy(),
        content: el("div", { class: "ar-form" }, [
            el("div", { class: "ar-save-target" }, [
                el("div", { class: "ar-save-target__label" }, ["目标位置"]),
                picker.wrap,
            ]),
            pathPreviewEl,
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["文档名称"]),
                nameInput,
            ]),
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["标签"]),
                tagInput,
                el("div", { class: "ar-form__hint" }, ["作为 custom-ai-rss-tags 块属性写入"]),
            ]),
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["选项"]),
                el("div", { class: "ar-form__opts" }, [
                    el("label", { class: "ar-check" }, [linkCheck, " 包含原文链接"]),
                    el("label", { class: "ar-check" }, [imgCheck, " 下载远程图片到本地"]),
                    el("label", { class: "ar-check" }, [cleanCheck, " 链接清理（保留原文链接）"]),
                ]),
            ]),
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["预览"]),
                el("div", { class: "ar-preview-wrap" }, [previewEl]),
            ]),
        ]),
        footer: [
            button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
            button({ text: "保存到思源", variant: "primary", className: "ar-save-btn", onclick: () => doSave().then((id) => { if (id) dialog.close(); }) }),
        ],
    });
}

export async function saveMarkdownToSiyuan(title: string, markdown: string, folder = "", paths?: PathMemory) {
    let notebooks: Notebook[] = [];
    try {
        const r: any = await fetchSyncPost("/api/notebook/lsNotebooks", {});
        if (r.code === 0 && r.data?.notebooks) {
            notebooks = r.data.notebooks.filter((n: Notebook) => !n.closed);
        }
    } catch { /* ignore */ }
    if (notebooks.length === 0) {
        toast("没有可用的笔记本", "error");
        return null;
    }

    const safeName = (s: string) => (s || "untitled")
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "untitled";
    const nameInput = el("input", { class: "ar-input", type: "text", value: safeName(title) }) as HTMLInputElement;
    const pathPreviewEl = el("div", { class: "ar-form__hint ar-save-path-hint" });
    const updatePreview = () => {
        const nbName = notebooks.find((n) => n.id === picker.getNotebook())?.name || "";
        picker.resolvePath(safeName((nameInput as HTMLInputElement).value || title))
            .then((finalPath) => { pathPreviewEl.textContent = `将保存到：${nbName}${finalPath}.md`; })
            .catch(() => { pathPreviewEl.textContent = "将保存到：" + nbName; });
    };
    const picker = createTargetPicker(notebooks, notebooks[0].id, folder, updatePreview, paths);
    const previewEl = el("pre", { class: "ar-preview" }, [markdown.slice(0, 1500) + (markdown.length > 1500 ? "\n…" : "")]);
    updatePreview();
    [nameInput].forEach((e) => {
        e.addEventListener("change", updatePreview);
        e.addEventListener("input", updatePreview);
    });

    const doSave = async () => {
        const saveBtn = dialog.container.querySelector(".ar-save-btn") as HTMLButtonElement;
        saveBtn.disabled = true;
        saveBtn.textContent = "保存中…";
        try {
            const finalPath = await picker.resolvePath(safeName((nameInput as HTMLInputElement).value || title));
            await ensureParentDirs(picker.getNotebook(), finalPath.replace(/\/[^/]+$/, "").replace(/^\/+/, ""));
            const r: any = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: picker.getNotebook(),
                path: finalPath,
                markdown,
            });
            if (r.code !== 0 || !r.data) throw new Error(r.msg || "创建文档失败");
            await fetchSyncPost("/api/sqlite/flushTransaction", {}).catch(() => {});
            toast("已保存到思源", "success", 4000);
            return r.data as string;
        } catch (e) {
            toast("保存失败：" + (e as Error).message, "error", 5000);
            saveBtn.disabled = false;
            saveBtn.textContent = "保存到思源";
            return null;
        }
    };

    const dialog = modal({
        title: "保存日报到思源",
        width: "640px",
        onClose: () => picker.destroy(),
        content: el("div", { class: "ar-form" }, [
            el("div", { class: "ar-save-target" }, [
                el("div", { class: "ar-save-target__label" }, ["目标位置"]),
                picker.wrap,
            ]),
            pathPreviewEl,
            el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["文档名称"]), nameInput]),
            el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["预览"]), el("div", { class: "ar-preview-wrap" }, [previewEl])]),
        ]),
        footer: [
            button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
            button({ text: "保存到思源", variant: "primary", className: "ar-save-btn", onclick: () => doSave().then((id) => { if (id) dialog.close(); }) }),
        ],
    });
}

function composeMd(article: Article, settings: Settings, _notebook: string, opts: { includeLink?: boolean; cleanLinks?: boolean } = {}): string {
    const cleaned = preprocessArticleHtml(article.content || "", article.link);
    const tmp = document.createElement("div");
    tmp.innerHTML = cleaned;
    const md = htmlToMd(tmp);

    const includeLink = opts.includeLink ?? settings.save.includeSourceLink !== false;
    const cleanLinks = opts.cleanLinks ?? settings.save.cleanLinks !== false;
    const vars: Record<string, string> = {
        title: article.title || "(无标题)",
        author: article.author || "未知",
        date: new Date(article.pubDate).toLocaleDateString("zh-CN"),
        link: includeLink ? (article.link || "") : "",
        source: "",
        content: md,
        summary: "",
        description: article.description || "",
    };
    let out = settings.save.template;
    for (const k of Object.keys(vars)) {
        out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), vars[k]);
    }
    if (!includeLink) {
        // 关闭“包含原文链接”时移除原文链接（空链接或指向原文 URL 的 markdown 链接）
        out = out.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (m: string, _label: string, url: string) => {
            const u = url.trim();
            return !u || u === article.link ? "" : m;
        });
    }
    if (cleanLinks) {
        out = cleanMarkdownLinks(out, includeLink ? { keepUrl: article.link } : undefined);
    }
    return stripPluginFrontmatter(dedupeMarkdown(out));
}

function htmlToMd(node: Node, depth = 0): string {
    if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || "").replace(/\s+/g, " ");
        return t.trim() ? t + "\n\n" : "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const n = node as Element;
    const tag = n.tagName.toLowerCase();
    switch (tag) {
        case "h1": return `# ${n.textContent?.trim()}\n\n`;
        case "h2": return `## ${n.textContent?.trim()}\n\n`;
        case "h3": return `### ${n.textContent?.trim()}\n\n`;
        case "h4": return `#### ${n.textContent?.trim()}\n\n`;
        case "h5": return `##### ${n.textContent?.trim()}\n\n`;
        case "h6": return `###### ${n.textContent?.trim()}\n\n`;
        case "p": {
            const t = inlineToStr(n);
            return t.trim() ? `${t}\n\n` : "";
        }
        case "br": return "\n";
        case "strong": case "b": return `**${inlineToStr(n)}**`;
        case "em": case "i": return `*${inlineToStr(n)}*`;
        case "code": return `\`${n.textContent}\``;
        case "pre": return "```\n" + (n.textContent || "") + "\n```\n\n";
        case "blockquote": {
            const inner = Array.from(n.childNodes).map((c) => htmlToMd(c, depth + 1)).join("").trim();
            return inner.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
        }
        case "ul": case "ol": {
            const ordered = tag === "ol";
            const out: string[] = [];
            Array.from(n.children).filter((c) => c.tagName.toLowerCase() === "li").forEach((li, i) => {
                const clone = li.cloneNode(true) as Element;
                clone.querySelectorAll("ul,ol").forEach((x) => x.remove());
                const text = inlineToStr(clone).trim().replace(/\s+/g, " ");
                if (text) out.push((ordered ? `${i + 1}. ` : "- ") + text);
                Array.from(li.children).forEach((c) => {
                    const t = c.tagName.toLowerCase();
                    if (t === "ul" || t === "ol") {
                        const inner = htmlToMd(c, depth + 1).trimEnd().split("\n").map((l) => "  " + l).join("\n");
                        if (inner) out.push(inner);
                    }
                });
            });
            return out.length ? out.join("\n") + "\n" : "";
        }
        case "table": {
            const rows = Array.from(n.querySelectorAll("tr"));
            if (!rows.length) return "";
            const lines: string[] = [];
            rows.forEach((tr, ri) => {
                const cells = Array.from(tr.querySelectorAll(":scope > th, :scope > td"))
                    .map((c) => inlineToStr(c as Element).trim().replace(/\|/g, "\\|"));
                if (!cells.length) return;
                lines.push("| " + cells.join(" | ") + " |");
                if (ri === 0) lines.push("| " + cells.map(() => "---").join(" | ") + " |");
            });
            return lines.join("\n") + "\n\n";
        }
        case "figure": {
            const img = n.querySelector("img");
            const cap = n.querySelector("figcaption");
            let s = img ? htmlToMd(img) : "";
            if (cap?.textContent?.trim()) s += `**${cap.textContent.trim()}**\n\n`;
            return s;
        }
        case "a": {
            const href = n.getAttribute("href") || "";
            const label = inlineToStr(n).trim();
            return href ? `[${label}](${href})` : label;
        }
        case "img": {
            const src = n.getAttribute("src") || "";
            const alt = n.getAttribute("alt") || "";
            return src ? `![${alt}](${src})` : "";
        }
        case "hr": return "---\n\n";
        case "script": case "style": case "noscript": case "iframe": return "";
        default: return blockChildren(n, depth);
    }
}

function inlineToStr(node: Element): string {
    let s = "";
    node.childNodes.forEach((c) => {
        if (c.nodeType === Node.TEXT_NODE) s += c.textContent;
        else if (c.nodeType === Node.ELEMENT_NODE) s += htmlToMd(c);
    });
    return s;
}

function blockChildren(node: Element, depth: number): string {
    let s = "";
    node.childNodes.forEach((c) => { s += htmlToMd(c, depth); });
    return s;
}
