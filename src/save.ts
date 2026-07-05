/**
 * 保存文章到思源
 */

import { Article, AIResult, Settings } from "./types";
import { el } from "./ui";
import { modal, button, toast } from "./components";
import { fetchSyncPost } from "siyuan";

interface Notebook { id: string; name: string; icon?: string; closed?: boolean; }

export async function saveToSiyuan(article: Article, settings: Settings, aiResults: Record<string, AIResult> = {}) {
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
    const defaultNb = settings.save.template && (window as any).siyuan?.config
        ? notebooks.find((n) => n.id === (settings as any).general?.defaultNotebook) || notebooks[0]
        : notebooks[0];

    let selectedNb = defaultNb.id;
    let includeSummary = false;
    let selectedAI: string[] = [];
    let downloadImages = settings.save.downloadImages;
    let includeLink = settings.save.includeSourceLink;
    let tags = (article.tags || []).join(", ");

    const safeName = (s: string) => (s || "untitled")
        .replace(/[/\\:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "untitled";

    const nameInput = el("input", { class: "ar-input", type: "text", value: safeName(article.title) });
    const nbSelect = el("select", { class: "ar-input" }) as HTMLSelectElement;
    notebooks.forEach((n) => {
        const opt = el("option", { value: n.id, selected: n.id === selectedNb }, [`${n.icon || "📓"} ${n.name}`]);
        nbSelect.appendChild(opt);
    });
    const linkCheck = el("input", { type: "checkbox" }) as HTMLInputElement; linkCheck.checked = includeLink;
    const imgCheck = el("input", { type: "checkbox" }) as HTMLInputElement; imgCheck.checked = downloadImages;
    const tagInput = el("input", { class: "ar-input", type: "text", value: tags, placeholder: "用逗号分隔" });
    const aiList = el("div", { class: "ar-ai-list" });

    // AI 列表
    const aiKeys = Object.keys(aiResults);
    if (aiKeys.length === 0) {
        aiList.appendChild(el("div", { class: "ar-form__hint" }, ["本篇文章还没有 AI 总结"]));
    } else {
        const summaryCb = el("input", { type: "checkbox" }) as HTMLInputElement;
        summaryCb.checked = aiKeys.includes("quick_summary_paragraph") || aiKeys.includes("p_summary");
        summaryCb.addEventListener("change", () => { includeSummary = summaryCb.checked; });
        aiKeys.forEach((pid) => {
            const r = aiResults[pid];
            const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
            cb.checked = pid === "quick_summary_paragraph" || pid === "p_summary";
            cb.addEventListener("change", () => {
                if (cb.checked) selectedAI.push(pid);
                else selectedAI = selectedAI.filter((x) => x !== pid);
            });
            aiList.appendChild(el("label", { class: "ar-ai-item" }, [
                cb, el("span", {}, [r.promptName]),
            ]));
        });
    }
    const previewEl = el("pre", { class: "ar-preview" });

    const updatePreview = () => {
        const md = composeMd(article, settings, aiResults, selectedAI, nbSelect.value);
        previewEl.textContent = md.slice(0, 1500) + (md.length > 1500 ? "\n…" : "");
    };
    setTimeout(updatePreview, 50);
    [nameInput, nbSelect, linkCheck, imgCheck, tagInput].forEach((e) => {
        e.addEventListener("change", updatePreview);
        e.addEventListener("input", updatePreview);
    });

    const doSave = async () => {
        const md = composeMd(article, settings, aiResults, selectedAI, nbSelect.value);
        const tags2 = (tagInput as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean);
        const saveBtn = dialog.container.querySelector(".ar-save-btn") as HTMLButtonElement;
        saveBtn.disabled = true;
        saveBtn.textContent = "保存中…";
        try {
            const r: any = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: nbSelect.value,
                path: "/" + ((nameInput as HTMLInputElement).value || safeName(article.title)),
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
        width: "600px",
        content: el("div", { class: "ar-form" }, [
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["目标笔记本"]),
                nbSelect,
            ]),
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
                el("label", { class: "ar-form__label" }, ["附加 AI 总结"]),
                aiList,
            ]),
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["选项"]),
                el("div", { class: "ar-form__opts" }, [
                    el("label", { class: "ar-check" }, [linkCheck, " 包含原文链接"]),
                    el("label", { class: "ar-check" }, [imgCheck, " 下载远程图片到本地"]),
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

export async function saveMarkdownToSiyuan(title: string, markdown: string) {
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
    let selectedNb = notebooks[0].id;
    const nameInput = el("input", { class: "ar-input", type: "text", value: safeName(title) }) as HTMLInputElement;
    const nbSelect = el("select", { class: "ar-input" }) as HTMLSelectElement;
    notebooks.forEach((n) => nbSelect.appendChild(el("option", { value: n.id, selected: n.id === selectedNb }, [`${n.icon || "📓"} ${n.name}`])));
    const previewEl = el("pre", { class: "ar-preview" }, [markdown.slice(0, 1500) + (markdown.length > 1500 ? "\n…" : "")]);

    const doSave = async () => {
        selectedNb = nbSelect.value;
        const saveBtn = dialog.container.querySelector(".ar-save-btn") as HTMLButtonElement;
        saveBtn.disabled = true;
        saveBtn.textContent = "保存中…";
        try {
            const r: any = await fetchSyncPost("/api/filetree/createDocWithMd", {
                notebook: selectedNb,
                path: "/" + safeName(nameInput.value || title),
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
        width: "600px",
        content: el("div", { class: "ar-form" }, [
            el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["目标笔记本"]), nbSelect]),
            el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["文档名称"]), nameInput]),
            el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["预览"]), el("div", { class: "ar-preview-wrap" }, [previewEl])]),
        ]),
        footer: [
            button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
            button({ text: "保存到思源", variant: "primary", className: "ar-save-btn", onclick: () => doSave().then((id) => { if (id) dialog.close(); }) }),
        ],
    });
}

function composeMd(article: Article, settings: Settings, aiResults: Record<string, AIResult>, selectedAI: string[], _notebook: string): string {
    const cleaned = (article.content || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    const tmp = document.createElement("div");
    tmp.innerHTML = cleaned;
    const md = htmlToMd(tmp);

    const aiMd = selectedAI
        .filter((pid) => aiResults[pid])
        .map((pid) => `\n\n## AI：${aiResults[pid].promptName}\n\n${aiResults[pid].content}`)
        .join("");

    const vars: Record<string, string> = {
        title: article.title || "(无标题)",
        author: article.author || "未知",
        date: new Date(article.pubDate).toLocaleDateString("zh-CN"),
        link: article.link || "",
        source: "",
        content: md,
        summary: aiMd,
        description: article.description || "",
    };
    let out = settings.save.template;
    for (const k of Object.keys(vars)) {
        out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), vars[k]);
    }
    return out;
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
            let out = "";
            let i = 1;
            n.querySelectorAll(":scope > li").forEach((li) => {
                out += (ordered ? `${i++}. ` : "- ") + inlineToStr(li).trim() + "\n";
            });
            return out + "\n";
        }
        case "a": {
            const href = n.getAttribute("href") || "";
            return href ? `[${inlineToStr(n)}(${href})]` : inlineToStr(n);
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
