/**
 * 主 Tab：3 栏布局（订阅 / 文章列表 / 阅读器）
 * 这是最核心的文件
 */

import { el, clear, on, debounce, escapeHtml, iconLabel } from "./ui";
import { icon as makeIcon } from "./icons";
import { button, dropdown, DropdownItem, toast, modal, empty, spinner } from "./components";
import { Storage } from "./storage";
import { AIService } from "./ai";
import { Article, Subscription, AIResult, FEATURED, FEATURED_CATS, PromptTemplate, Category } from "./types";
import { fetchAndParse, resolveSubscriptionFavicon } from "./fetcher";
import { fetchFullText } from "./fulltext";
import { saveMarkdownToSiyuan, saveToSiyuan } from "./save";
import { openSettings } from "./settings";
import { applyDisplaySettings } from "./theme";
import DOMPurify from "dompurify";
import { genId } from "./util";

// =============== 工具 ===============

function sanitize(html: string): string {
    if (!html) return "";
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ["a", "b", "blockquote", "br", "code", "div", "em", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"],
        ALLOWED_ATTR: ["href", "title", "alt", "src", "class", "target", "rel"],
    }) as string;
}

function postProcess(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("a").forEach((a) => { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer"); });
    div.querySelectorAll("img").forEach((i) => { i.setAttribute("loading", "lazy"); });
    Array.from(div.querySelectorAll("table")).forEach((table) => {
        if (table.parentElement?.classList.contains("ar-rd__table-scroll")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "ar-rd__table-scroll";
        table.parentNode?.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });
    return div.innerHTML;
}

function articleId(subId: string, link: string): string {
    let h = 0x811c9dc5;
    const s = subId + "::" + link;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return "art_" + (h >>> 0).toString(36);
}

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const m = 60_000, h = 3_600_000, d = 86_400_000;
    if (diff < m) return "刚刚";
    if (diff < h) return Math.floor(diff / m) + " 分钟前";
    if (diff < d) return Math.floor(diff / h) + " 小时前";
    if (diff < 7 * d) return Math.floor(diff / d) + " 天前";
    return new Date(ts).toLocaleDateString("zh-CN");
}

function estimateReadingTime(text: string): number {
    if (!text) return 0;
    const cn = (text.match(/[一-鿿]/g) || []).length;
    const en = (text.match(/[a-zA-Z]+/g) || []).length;
    return Math.max(1, Math.ceil((cn / 4 + en) / 300));
}

const QUICK_AI_PROMPTS: PromptTemplate[] = [
    {
        id: "quick_summary_paragraph",
        name: "AI 总结",
        icon: "list",
        order: 1,
        builtin: true,
        outputFormat: "markdown",
        systemPrompt: "你是简洁准确的中文阅读助手。",
        userPrompt: "请阅读下面文章，用简体中文总结成一段自然流畅的话。要求：100-200 字，不要分点，不要标题，不要使用 Markdown 列表。\n\n标题：{{title}}\n作者：{{author}}\n\n{{content}}",
    },
    {
        id: "quick_translate",
        name: "AI 翻译",
        icon: "translate",
        order: 2,
        builtin: true,
        outputFormat: "markdown",
        systemPrompt: "你是专业中文译者。保留链接、人名、产品名、代码和专有名词的原文或通用译法。",
        userPrompt: "请把下面文章翻译为简体中文，尽量保留原文段落结构，不添加额外评论。\n\n标题：{{title}}\n作者：{{author}}\n\n{{content}}",
    },
];
const SUMMARY_PROMPT = QUICK_AI_PROMPTS[0];
const TRANSLATE_PROMPT = QUICK_AI_PROMPTS[1];
const DAILY_REPORT_PROMPT: PromptTemplate = {
    id: "quick_daily_report",
    name: "AI 日报",
    icon: "article",
    order: 3,
    builtin: true,
    outputFormat: "markdown",
    systemPrompt: "你是专业资讯编辑，擅长把 RSS 文章整理成简洁日报。",
    userPrompt: "{{content}}",
};

function dateKey(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function displayDate(key: string): string {
    return new Date(`${key}T00:00:00`).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

function htmlToPlainText(html: string): string {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}

function usableFullText(article: Article): string | null {
    if (!article.fullText) return null;
    const fullText = htmlToPlainText(article.fullText);
    const originalText = htmlToPlainText(article.content || article.description || "");
    if (fullText.length < 120) return null;
    if (originalText.length >= 120 && fullText.length < originalText.length * 0.9) return null;
    return article.fullText;
}

function escapeAttr(s: string): string {
    return escapeHtml(s).replace(/"/g, "&quot;");
}

function fallbackFavicon(url: string): string {
    try {
        const u = new URL(url);
        return `${u.origin}/favicon.ico`;
    } catch {
        return "";
    }
}

function subscriptionLogo(sub: Subscription, className: string, fallbackSize = 13): HTMLElement {
    const logoUrl = sub.favicon || fallbackFavicon(sub.siteUrl || sub.url);
    const logo = el("span", { class: className });
    if (logoUrl) {
        const img = el("img", { src: logoUrl, alt: "", loading: "lazy" }) as HTMLImageElement;
        img.addEventListener("error", () => {
            clear(logo);
            logo.appendChild(makeIcon("rss", fallbackSize));
        }, { once: true });
        logo.appendChild(img);
    } else {
        logo.appendChild(makeIcon("rss", fallbackSize));
    }
    return logo;
}

function buildTranslatableHtml(sourceHtml: string, startId = 1): { html: string; segments: { id: number; text: string }[] } {
    const root = document.createElement("div");
    root.innerHTML = postProcess(sanitize(sourceHtml));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const text = node.nodeValue || "";
            const parent = node.parentElement;
            if (!text.trim()) return NodeFilter.FILTER_REJECT;
            if (parent?.closest("code, pre")) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    const segments: { id: number; text: string }[] = [];
    let total = 0;
    nodes.forEach((node) => {
        const text = node.nodeValue || "";
        if (total > 14000) return;
        total += text.length;
        const id = startId + segments.length;
        segments.push({ id, text });
        const wrap = document.createElement("span");
        wrap.className = "ar-rd__translate-segment";
        wrap.dataset.segId = String(id);
        wrap.dataset.original = text;
        const original = document.createElement("span");
        original.className = "ar-rd__translate-original";
        for (const char of Array.from(text)) {
            const charEl = document.createElement("span");
            charEl.className = "ar-rd__translate-char";
            charEl.textContent = char;
            original.appendChild(charEl);
        }
        wrap.appendChild(original);
        node.parentNode?.replaceChild(wrap, node);
    });

    return { html: root.innerHTML, segments };
}

function buildTranslatableTitleHtml(title: string): string {
    const text = title || "(无标题)";
    const chars = Array.from(text).map((char) => `<span class="ar-rd__translate-char">${escapeHtml(char)}</span>`).join("");
    return `<span class="ar-rd__translate-segment" data-seg-id="1" data-original="${escapeAttr(text)}"><span class="ar-rd__translate-original">${chars}</span></span>`;
}

function translatedHtmlFromSource(source: HTMLElement): string {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll<HTMLElement>(".ar-rd__translate-segment").forEach((segment) => {
        const translated = segment.dataset.translated || segment.dataset.original || segment.textContent || "";
        segment.replaceWith(document.createTextNode(translated));
    });
    return clone.innerHTML;
}

function translatedTextFromSegment(root: ParentNode, id: number): string {
    const segment = root.querySelector<HTMLElement>(`.ar-rd__translate-segment[data-seg-id="${id}"]`);
    return segment?.dataset.translated || segment?.dataset.original || segment?.textContent || "";
}

function getTranslatedResult(result?: AIResult): { title?: string; html?: string } {
    if (!result) return {};
    const extra = result as AIResult & { translatedTitle?: string; translatedComplete?: boolean };
    if (!extra.translatedComplete) return {};
    return { title: extra.translatedTitle, html: result.content };
}

function parseJsonArray(text: string): any[] {
    const cleaned = (text || "").replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isTranslationComplete(result?: AIResult): boolean {
    return !!(result as AIResult & { translatedComplete?: boolean } | undefined)?.translatedComplete;
}


function buildSegmentTranslationPrompt(segments: { id: number; text: string }[]): string {
    const lines = segments.map((segment) => `${segment.id}|${segment.text.replace(/\s+/g, " ").trim()}`).join("\n");
    return [
        "请把下面编号文本片段翻译为简体中文。",
        "要求：",
        "1. 只输出翻译结果，每行格式必须是：编号|译文",
        "2. 不要输出解释、标题、Markdown 代码块",
        "3. 不要合并、拆分或省略编号",
        "4. 链接、代码、产品名、人名可保留原文或使用通用译法",
        "",
        lines,
    ].join("\n");
}

function batchTranslationSegments(segments: { id: number; text: string }[], maxChars = 3200): { id: number; text: string }[][] {
    const batches: { id: number; text: string }[][] = [];
    let current: { id: number; text: string }[] = [];
    let size = 0;
    for (const segment of segments) {
        const len = segment.text.length + 12;
        if (current.length && size + len > maxChars) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(segment);
        size += len;
    }
    if (current.length) batches.push(current);
    return batches;
}

// =============== 侧栏 ===============

class Sidebar {
    root: HTMLElement;
    storage: Storage;
    active: string = "all";
    onChange: (id: string) => void;
    private feedsScrollTop = 0;
    private renderFrame: number | null = null;
    private lastRenderSignature = "";

    constructor(root: HTMLElement, storage: Storage, onChange: (id: string) => void) {
        this.root = root;
        this.storage = storage;
        this.onChange = onChange;
        storage.on(() => this.requestRender());
        this.render();
    }

    private signature() {
        const subs = this.storage.getSubs();
        const cats = this.storage.getCats();
        const articles = this.storage.getArticles();
        const totalUnread = this.storage.totalUnread();
        const todayUnread = articles.filter((a) => !a.isRead && Date.now() - a.pubDate < 86400_000).length;
        const starred = articles.filter((a) => a.isStarred).length;
        const dailyDates = new Set(articles.map((a) => dateKey(a.pubDate))).size;
        return JSON.stringify({
            active: this.active,
            smart: [articles.length, totalUnread, todayUnread, starred, dailyDates],
            cats: cats.map((cat) => [cat.id, cat.name, cat.sortOrder]),
            subs: subs.map((sub) => [sub.id, sub.name, sub.categoryId || "", sub.categoryName || "", sub.enabled, sub.errorCount, sub.favicon || "", this.storage.unreadCount(sub.id)]),
        });
    }

    private requestRender() {
        if (this.renderFrame !== null) return;
        this.renderFrame = window.requestAnimationFrame(() => {
            this.renderFrame = null;
            const sig = this.signature();
            if (sig === this.lastRenderSignature) return;
            this.render(sig);
        });
    }

    setActive(id: string) {
        this.active = id;
        this.render();
    }

    render(signature = this.signature()) {
        this.lastRenderSignature = signature;
        const oldFeeds = this.root.querySelector<HTMLElement>(".ar-side__section--feeds");
        if (oldFeeds) this.feedsScrollTop = oldFeeds.scrollTop;
        clear(this.root);
        const subs = this.storage.getSubs();
        const cats = this.storage.getCats();

        // 顶部 brand
        const header = el("div", { class: "ar-side__header" }, [
            el("div", { class: "ar-side__brand" }, [
                el("span", { class: "ar-side__brand-logo" }, [makeIcon("rssMain", 18)]),
                el("span", {}, ["LimitRSS"]),
            ]),
            button({ variant: "icon", icon: "plus", title: "添加订阅", onclick: (e) => this.openAdd(e.currentTarget as HTMLElement, e) }),
        ]);
        this.root.appendChild(header);

        // 智能分组
        const smart = el("div", { class: "ar-side__section ar-side__section--smart" });
        const totalUnread = this.storage.totalUnread();
        const todayUnread = this.storage.getArticles().filter((a) => !a.isRead && Date.now() - a.pubDate < 86400_000).length;
        const starred = this.storage.getArticles().filter((a) => a.isStarred).length;
        const dailyDates = new Set(this.storage.getArticles().map((a) => dateKey(a.pubDate))).size;
        [
            { id: "all", label: "全部", icon: "list", count: this.storage.getArticles().length },
            { id: "unread", label: "未读", icon: "bell", count: totalUnread },
            { id: "today", label: "今天", icon: "inbox", count: todayUnread },
            { id: "starred", label: "星标", icon: "star", count: starred },
            { id: "daily", label: "AI 日报", icon: "wand", count: dailyDates },
        ].forEach((g) => smart.appendChild(this.renderGroup(g.id, g.label, g.icon, g.count)));
        this.root.appendChild(smart);

        // 分类 + 订阅
        const subsSection = el("div", { class: "ar-side__section ar-side__section--feeds" });
        const noCat = subs.filter((s) => !this.storage.resolveSubCategoryId(s));
        if (noCat.length) subsSection.appendChild(this.renderCategory("c_default", "未分类", noCat));
        cats.filter((c) => c.id !== "c_default").forEach((c) => {
            const list = subs.filter((s) => this.storage.resolveSubCategoryId(s) === c.id);
            subsSection.appendChild(this.renderCategory(c.id, c.name, list));
        });
        this.root.appendChild(subsSection);
        subsSection.scrollTop = this.feedsScrollTop;
        subsSection.addEventListener("scroll", () => {
            this.feedsScrollTop = subsSection.scrollTop;
        });

        // 底部
        const footer = el("div", { class: "ar-side__footer" }, [
            button({ variant: "ghost", block: true, icon: "folder", text: "添加分类", onclick: () => this.addCategory() }),
            button({ variant: "ghost", block: true, icon: "settings", text: "设置", onclick: () => openSettings(this.storage, (this as any)._ai) }),
        ]);
        this.root.appendChild(footer);
    }

    renderGroup(id: string, label: string, ic: string, count: number) {
        const isActive = this.active === id;
        return el("button", {
            class: `ar-side__group ar-side__group--${id} ${isActive ? "ar-side__group--active" : ""}`,
            onclick: () => { this.active = id; this.onChange(id); this.render(); },
        }, [
            el("span", { class: "ar-side__icon" }, [makeIcon(ic, 14)]),
            el("span", {}, [label]),
            el("span", { style: { flex: "1" } }),
            count > 0 ? el("span", { class: "ar-side__count" }, [String(count)]) : null,
        ].filter(Boolean) as HTMLElement[]);
    }

    renderCategory(catId: string, catName: string, subs: Subscription[]) {
        const wrap = el("div", { class: "ar-side__cat" });
        const unread = subs.reduce((sum, s) => sum + this.storage.unreadCount(s.id), 0);
        const head = el("button", {
            class: `ar-side__cat-head ${this.active === catId ? "ar-side__cat-head--active" : ""}`,
            onclick: () => { this.active = catId; this.onChange(catId); this.render(); },
        }, [
            el("span", { class: "ar-side__cat-name" }, [catName]),
            el("span", { class: "ar-side__count" }, [String(unread)]),
            button({ variant: "icon", size: "xs", icon: "more", title: "更多", onclick: (e) => { this.openCatMenu(e.currentTarget as HTMLElement, catId, catName, e); } }),
        ]);
        wrap.appendChild(head);
        subs.forEach((s) => wrap.appendChild(this.renderSub(s)));
        return wrap;
    }

    renderSub(s: Subscription) {
        const isActive = this.active === s.id;
        const unread = this.storage.unreadCount(s.id);
        const logoUrl = s.favicon || fallbackFavicon(s.siteUrl || s.url);
        const logo = el("span", { class: `ar-side__sub-logo ${s.errorCount > 0 ? "ar-side__sub-logo--err" : ""}` });
        if (logoUrl) {
            const img = el("img", { src: logoUrl, alt: "", loading: "lazy" }) as HTMLImageElement;
            img.addEventListener("error", () => {
                clear(logo);
                logo.classList.add("ar-side__sub-logo--fallback");
                logo.appendChild(makeIcon("rss", 11));
            }, { once: true });
            logo.appendChild(img);
        } else {
            logo.classList.add("ar-side__sub-logo--fallback");
            logo.appendChild(makeIcon("rss", 11));
        }
        return el("button", {
            class: `ar-side__sub ${isActive ? "ar-side__sub--active" : ""}`,
            onclick: () => { this.active = s.id; this.onChange(s.id); this.render(); },
        }, [
            logo,
            el("span", { class: "ar-side__sub-name" }, [s.name]),
            unread > 0 ? el("span", { class: "ar-side__badge" }, [unread > 99 ? "99+" : String(unread)]) : null,
            button({ variant: "icon", size: "xs", icon: "more", title: "更多", onclick: (e) => { this.openSubMenu(e.currentTarget as HTMLElement, s, e); } }),
        ].filter(Boolean) as HTMLElement[]);
    }

    openAdd(target: HTMLElement, ev?: MouseEvent) {
        ev?.stopPropagation();
        const items: (DropdownItem | null)[] = [
            { label: "手动添加", icon: "edit", onClick: () => this.showAddDialog() },
            { label: "OPML 导入", icon: "inbox", onClick: () => this.showOPML() },
            { divider: true, label: "" },
            { label: "新建分类", icon: "folder", onClick: () => this.addCategory() },
        ];
        dropdown(target, items, "200px");
    }

    showAddDialog(categoryId?: string) {
        const urlInput = el("input", { class: "ar-input", type: "text", placeholder: "https://example.com/feed 或 rsshub://github/trending/weekly/any", spellcheck: "false" }) as HTMLInputElement;
        const nameInput = el("input", { class: "ar-input", type: "text", placeholder: "显示名称（可选）" }) as HTMLInputElement;
        const resultEl = el("div", { class: "ar-form__hint" });
        const previewIcon = el("img", { class: "ar-add-preview__icon", alt: "" }) as HTMLImageElement;
        previewIcon.style.display = "none";
        const previewUrl = el("span", { class: "ar-add-preview__url" }, ["(尚未测试)"]);
        previewIcon.addEventListener("error", () => {
            previewIcon.style.display = "none";
            previewUrl.textContent = `(图标加载失败：${previewIcon.src})`;
        });
        const previewRow = el("div", { class: "ar-form__row ar-add-preview" }, [
            el("label", { class: "ar-form__label" }, ["图标预览"]),
            el("div", { class: "ar-add-preview__row" }, [previewIcon, previewUrl]),
        ]);
        const test = async () => {
            const url = urlInput.value.trim();
            if (!url) return toast("请先填写 URL", "warn");
            resultEl.textContent = "抓取中…";
            previewIcon.style.display = "none";
            previewUrl.textContent = "(解析中…)";
            try {
                const f = await fetchAndParse(url, this.storage.getSettings().general.rsshubBaseUrl);
                if (!nameInput.value) nameInput.value = f.title;
                if (f.siteUrl) urlInput.dataset.siteUrl = f.siteUrl;
                if (f.description) urlInput.dataset.description = f.description;
                resultEl.textContent = `✓ 抓取成功：${f.title}（${f.articles.length} 篇）`;
                // 异步解析图标，让用户立刻看到抓取结果；icon 解析完后回填预览
                const faviconInfo = await resolveSubscriptionFavicon({
                    feedFavicon: f.favicon,
                    siteUrl: f.siteUrl || urlInput.dataset.siteUrl || url,
                    always: true,
                });
                if (faviconInfo.favicon) {
                    previewIcon.src = faviconInfo.favicon;
                    previewIcon.style.display = "";
                    previewUrl.textContent = faviconInfo.favicon;
                    urlInput.dataset.favicon = faviconInfo.favicon;
                } else {
                    previewIcon.style.display = "none";
                    previewUrl.textContent = "(feed 与站点首页都没找到图标，将用 /favicon.ico 兜底)";
                }
            } catch (e) {
                resultEl.textContent = `抓取失败：${(e as Error).message}`;
                previewIcon.style.display = "none";
                previewUrl.textContent = "(抓取失败，未获取到图标)";
            }
        };
        urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") test(); });
        const doSave = async () => {
            const url = urlInput.value.trim();
            if (!url) return toast("请填写 URL", "warn");
            let parsed: Awaited<ReturnType<typeof fetchAndParse>> | undefined;
            try {
                parsed = await fetchAndParse(url, this.storage.getSettings().general.rsshubBaseUrl);
            } catch (e) {
                return toast("订阅源不可用：" + (e as Error).message, "error", 4000);
            }
            const name = nameInput.value.trim() || parsed.title || url;
            const faviconInfo = await resolveSubscriptionFavicon({
                feedFavicon: parsed.favicon || urlInput.dataset.favicon,
                siteUrl: parsed.siteUrl || urlInput.dataset.siteUrl || url,
                always: true,
            });
            const s: Subscription = {
                id: genId("sub_"), url, name, enabled: true, errorCount: 0,
                categoryId: categoryId && categoryId !== "c_default" ? categoryId : undefined,
                categoryName: categoryId && categoryId !== "c_default" ? this.storage.getCats().find((c) => c.id === categoryId)?.name : undefined,
                siteUrl: parsed.siteUrl || urlInput.dataset.siteUrl,
                description: parsed.description || urlInput.dataset.description,
                favicon: faviconInfo.favicon || fallbackFavicon(parsed.siteUrl || url),
                faviconTriedAt: faviconInfo.attempted ? faviconInfo.triedAt : undefined,
                sortOrder: this.storage.getSubs().length, createdAt: Date.now(), updatedAt: Date.now(),
            };
            const saved = await this.storage.upsertSub(s);
            dialog.close();
            toast(`已添加「${name}」`, "success");
            this.onRefresh(saved?.id || s.id);
        };
        const dialog = modal({
            title: "添加订阅",
            width: "480px",
            content: el("div", {}, [
                el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["RSS / URL *"]), urlInput]),
                el("div", { class: "ar-form__hint" }, ["支持普通 RSS / Atom 地址，以及 Folo 使用的 rsshub:// 路由格式。"]),
                el("div", { class: "ar-form__row" }, [el("label", { class: "ar-form__label" }, ["显示名称"]), nameInput]),
                resultEl,
                previewRow,
            ]),
            footer: [
                button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
                button({ text: "测试", variant: "secondary", onclick: test }),
                button({ text: "添加", variant: "primary", onclick: doSave }),
            ],
        });
    }

    showOPML() {
        const fileInput = el("input", { type: "file", accept: ".opml,.xml,text/xml,application/xml", style: { display: "none" } }) as HTMLInputElement;
        const ta = el("textarea", { class: "ar-input", rows: 10, placeholder: "粘贴 OPML 内容，或直接选择 .opml / .xml 文件", style: { fontFamily: "var(--b3-font-family-code)", fontSize: "11px" } }) as HTMLTextAreaElement;
        const fileName = el("span", { class: "ar-opml__file" }, ["未选择文件"]);
        const resultEl = el("div", { class: "ar-form__hint" }, ["支持粘贴 OPML 内容，也可以直接导入 OPML 文件。"]);
        const previewEl = el("div", { class: "ar-opml__preview" }, [
            el("div", { class: "ar-opml__empty" }, ["解析后会在这里预览可导入的订阅源"]),
        ]);
        type OpmlFeed = {
            title: string;
            url: string;
            category?: string;
            status: "pending" | "testing" | "valid" | "invalid" | "duplicate";
            message?: string;
            parsedTitle?: string;
            siteUrl?: string;
            favicon?: string;
            description?: string;
            articleCount?: number;
        };
        let feeds: OpmlFeed[] = [];
        let testingPromise: Promise<void> | null = null;
        const existingUrls = () => new Set(this.storage.getSubs().map((s) => s.url.trim()));
        const renderPreview = () => {
            clear(previewEl);
            if (!feeds.length) {
                previewEl.appendChild(el("div", { class: "ar-opml__empty" }, ["没有可预览的订阅源"]));
                return;
            }
            const validCount = feeds.filter((f) => f.status === "valid").length;
            const invalidCount = feeds.filter((f) => f.status === "invalid").length;
            const duplicateCount = feeds.filter((f) => f.status === "duplicate").length;
            previewEl.appendChild(el("div", { class: "ar-opml__summary" }, [
                el("span", {}, [`可导入 ${validCount}`]),
                duplicateCount ? el("span", {}, [`已存在 ${duplicateCount}`]) : null,
                invalidCount ? el("span", {}, [`无效 ${invalidCount}`]) : null,
            ].filter(Boolean) as HTMLElement[]));
            const list = el("div", { class: "ar-opml__list" });
            feeds.forEach((f) => {
                const label = f.status === "valid" ? "可导入"
                    : f.status === "invalid" ? "无效"
                    : f.status === "duplicate" ? "已存在"
                    : f.status === "testing" ? "测试中"
                    : "待测试";
                list.appendChild(el("div", { class: `ar-opml__item ar-opml__item--${f.status}` }, [
                    el("div", { class: "ar-opml__item-main" }, [
                        el("div", { class: "ar-opml__item-title" }, [f.parsedTitle || f.title || f.url]),
                        el("div", { class: "ar-opml__item-url" }, [f.url]),
                        f.category ? el("div", { class: "ar-opml__item-meta" }, [`分类：${f.category}`]) : null,
                    ].filter(Boolean) as HTMLElement[]),
                    el("div", { class: "ar-opml__item-side" }, [
                        el("span", { class: `ar-opml__status ar-opml__status--${f.status}` }, [label]),
                        f.status === "valid" && typeof f.articleCount === "number" ? el("span", { class: "ar-opml__item-meta" }, [`${f.articleCount} 篇`]) : null,
                        f.message ? el("span", { class: "ar-opml__item-meta" }, [f.message]) : null,
                    ].filter(Boolean) as HTMLElement[]),
                ]));
            });
            previewEl.appendChild(list);
        };
        const testOne = async (feed: OpmlFeed) => {
            if (existingUrls().has(feed.url.trim())) {
                feed.status = "duplicate";
                feed.message = "本地已存在";
                return;
            }
            feed.status = "testing";
            feed.message = undefined;
            renderPreview();
            try {
                const parsed = await Promise.race([
                    fetchAndParse(feed.url, this.storage.getSettings().general.rsshubBaseUrl),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("测试超时")), 15_000)),
                ]);
                if (!parsed.articles.length) throw new Error("没有文章");
                feed.status = "valid";
                feed.parsedTitle = parsed.title || feed.title;
                feed.siteUrl = parsed.siteUrl;
                const faviconInfo = await resolveSubscriptionFavicon({
                    feedFavicon: parsed.favicon,
                    siteUrl: parsed.siteUrl || feed.url,
                    always: true,
                });
                feed.favicon = faviconInfo.favicon || fallbackFavicon(parsed.siteUrl || feed.url);
                feed.description = parsed.description;
                feed.articleCount = parsed.articles.length;
                feed.message = undefined;
            } catch (e) {
                feed.status = "invalid";
                feed.message = (e as Error).message.replace(/^Failed to fetch .*?: /, "");
            }
        };
        const testFeeds = async () => {
            if (!feeds.length) return;
            const pending = feeds.filter((f) => f.status === "pending" || f.status === "testing");
            if (!pending.length) return;
            const notice = toast(`正在测试订阅源 0/${pending.length}…`, "info", 0);
            let index = 0;
            let done = 0;
            const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
                while (index < pending.length) {
                    const feed = pending[index++];
                    await testOne(feed);
                    done++;
                    notice.update(`正在测试订阅源 ${done}/${pending.length}…`);
                    renderPreview();
                }
            });
            await Promise.all(workers);
            notice.dismiss();
            const validCount = feeds.filter((f) => f.status === "valid").length;
            const invalidCount = feeds.filter((f) => f.status === "invalid").length;
            const duplicateCount = feeds.filter((f) => f.status === "duplicate").length;
            resultEl.textContent = `测试完成：可导入 ${validCount} 个，已存在 ${duplicateCount} 个，无效 ${invalidCount} 个。`;
            toast(`测试完成：可导入 ${validCount} 个`, validCount ? "success" : "warn");
        };
        const doParse = (autoTest = true) => {
            try {
                const doc = new DOMParser().parseFromString(ta.value, "application/xml");
                if (doc.querySelector("parsererror")) throw new Error("OPML 解析失败");
                const parsedFeeds: OpmlFeed[] = [];
                const seen = new Set<string>();
                const walk = (node: Element, parents: string[] = []) => {
                    Array.from(node.children).forEach((child) => {
                        if (child.tagName.toLowerCase() !== "outline") return;
                        const title = child.getAttribute("text") || child.getAttribute("title") || "未命名";
                        const xmlUrl = child.getAttribute("xmlUrl") || child.getAttribute("xmlurl");
                        if (xmlUrl) {
                            const url = xmlUrl.trim();
                            if (!seen.has(url)) {
                                seen.add(url);
                                parsedFeeds.push({ title, url, category: parents[parents.length - 1], status: "pending" });
                            }
                        } else {
                            walk(child, [...parents, title]);
                        }
                    });
                };
                const body = doc.querySelector("body");
                if (!body) throw new Error("未找到 OPML body");
                walk(body);
                feeds = parsedFeeds;
                renderPreview();
                resultEl.textContent = `解析到 ${feeds.length} 个订阅源`;
                toast(`解析到 ${feeds.length} 个订阅源`, "info");
                testingPromise = autoTest ? testFeeds() : null;
            } catch (e) {
                feeds = [];
                renderPreview();
                resultEl.textContent = `解析失败：${(e as Error).message}`;
                toast("解析失败：" + (e as Error).message, "error");
            }
        };
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                ta.value = text;
                fileName.textContent = file.name;
                resultEl.textContent = `已读取 ${file.name}，可以解析或直接导入。`;
                doParse();
            } catch (e) {
                resultEl.textContent = `读取失败：${(e as Error).message}`;
                toast("读取 OPML 文件失败：" + (e as Error).message, "error");
            }
        });
        const pickFile = () => {
            fileInput.value = "";
            fileInput.click();
        };
        const doImport = async () => {
            if (feeds.length === 0) doParse();
            if (feeds.length === 0) return;
            if (testingPromise) await testingPromise;
            if (feeds.some((f) => f.status === "pending" || f.status === "testing")) {
                testingPromise = testFeeds();
                await testingPromise;
            }
            const existing = new Set(this.storage.getSubs().map((s) => s.url));
            const categories = new Map(this.storage.getCats().map((c) => [c.name, c.id]));
            const categoryFor = async (name?: string) => {
                const clean = (name || "").trim();
                if (!clean) return undefined;
                const existed = categories.get(clean);
                if (existed) return existed === "c_default" ? undefined : existed;
                const catId = genId("cat_");
                categories.set(clean, catId);
                await this.storage.upsertCat({
                    id: catId,
                    name: clean,
                    color: "#3b82f6",
                    sortOrder: this.storage.getCats().length,
                    collapsed: false,
                });
                return catId;
            };
            const importedSubs: Subscription[] = [];
            for (const f of feeds.filter((feed) => feed.status === "valid")) {
                if (existing.has(f.url)) continue;
                const id = genId("sub_");
                const categoryId = await categoryFor(f.category);
                importedSubs.push({
                    id, url: f.url, name: f.parsedTitle || f.title,
                    categoryId,
                    categoryName: f.category,
                    enabled: true, errorCount: 0,
                    favicon: f.favicon || fallbackFavicon(f.url),
                    faviconTriedAt: Date.now(),
                    siteUrl: f.siteUrl,
                    description: f.description,
                    sortOrder: this.storage.getSubs().length + importedSubs.length,
                    createdAt: Date.now(), updatedAt: Date.now(),
                });
                existing.add(f.url);
            }
            const savedSubs = await this.storage.bulkImportSubs(importedSubs);
            const importedIds = savedSubs.map((sub) => sub.id);
            dialog.close();
            if (!importedIds.length) {
                toast("没有新的订阅源需要导入", "info");
                return;
            }
            const pending = toast(`已导入 ${importedIds.length} 个订阅源，正在刷新文章…`, "info", 0);
            let done = 0;
            for (const id of importedIds) {
                done++;
                pending.update(`正在刷新导入的订阅源 ${done}/${importedIds.length}…`);
                await this.onRefresh(id, { silent: true });
            }
            pending.dismiss();
            toast(`导入并刷新完成：${importedIds.length} 个订阅源`, "success");
        };
        const dialog = modal({
            title: "OPML 导入",
            width: "720px",
            content: el("div", { class: "ar-opml" }, [
                fileInput,
                el("div", { class: "ar-opml__picker" }, [
                    button({ text: "选择 OPML 文件", icon: "opml", variant: "secondary", onclick: pickFile }),
                    fileName,
                ]),
                ta,
                resultEl,
                previewEl,
            ]),
            footer: [
                button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
                button({ text: "解析并测试", variant: "secondary", onclick: () => doParse(true) }),
                button({ text: "导入", variant: "primary", onclick: doImport }),
            ],
        });
    }

    showFeatured() {
        const wrap = el("div", { class: "ar-featured" });
        FEATURED_CATS.forEach((c) => {
            const items = FEATURED.filter((f) => f.category === c.id);
            if (!items.length) return;
            const block = el("div", { class: "ar-featured__cat" }, [
                el("div", { class: "ar-featured__title" }, [iconLabel(c.icon, c.name, 14)]),
            ]);
            items.forEach((f) => {
                block.appendChild(el("div", { class: "ar-featured__item" }, [
                    el("div", { class: "ar-featured__name" }, [f.name]),
                    el("div", { class: "ar-featured__url" }, [f.url]),
                    button({ text: "添加", size: "xs", variant: "primary", onclick: async () => {
                        const faviconInfo = await resolveSubscriptionFavicon({
                            siteUrl: f.url,
                            always: true,
                        });
                        const s: Subscription = {
                            id: genId("sub_"), url: f.url, name: f.name, enabled: true, errorCount: 0,
                            favicon: faviconInfo.favicon || fallbackFavicon(f.url),
                            faviconTriedAt: faviconInfo.attempted ? faviconInfo.triedAt : undefined,
                            sortOrder: this.storage.getSubs().length, createdAt: Date.now(), updatedAt: Date.now(),
                        };
                        await this.storage.upsertSub(s);
                        toast(`已添加「${f.name}」`, "success");
                        this.onRefresh(s.id);
                    } }),
                ]));
            });
            wrap.appendChild(block);
        });
        modal({ title: "精选订阅源", width: "520px", content: wrap });
    }

    addCategory() {
        const nameInput = el("input", { class: "ar-input", type: "text", placeholder: "例如：科技、设计、长文" }) as HTMLInputElement;
        const doSave = async () => {
            const name = nameInput.value.trim();
            if (!name) return toast("请填写分类名称", "warn");
            const cat = {
                id: genId("cat_"),
                name,
                color: "#3b82f6",
                sortOrder: this.storage.getCats().length,
                collapsed: false,
            };
            await this.storage.upsertCat(cat);
            this.active = cat.id;
            this.onChange(cat.id);
            dialog.close();
            toast(`已添加分类「${name}」`, "success");
        };
        nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
        const dialog = modal({
            title: "添加分类",
            width: "420px",
            content: el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["分类名称"]),
                nameInput,
            ]),
            footer: [
                button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
                button({ text: "添加", variant: "primary", icon: "plus", onclick: doSave }),
            ],
        });
        setTimeout(() => nameInput.focus(), 0);
    }

    openSubMenu(target: HTMLElement, s: Subscription, ev?: MouseEvent) {
        ev?.stopPropagation();
        const items: DropdownItem[] = [
            { label: "立即刷新", icon: "refresh", onClick: () => this.onRefresh(s.id) },
            { label: "重命名", icon: "edit", onClick: () => this.showRenameSubDialog(s) },
            { divider: true, label: "" },
            { label: "暂停/恢复", icon: s.enabled ? "pause" : "play", onClick: () => this.storage.patchSubMeta(s.id, { enabled: !s.enabled }) },
            { divider: true, label: "" },
            { label: "删除", icon: "trash", danger: true, onClick: () => {
                if (confirm(`删除「${s.name}」？`)) this.storage.removeSub(s.id);
            }},
        ];
        dropdown(target, items);
    }

    private showRenameSubDialog(s: Subscription) {
        const nameInput = el("input", {
            class: "ar-input",
            type: "text",
            value: s.name,
            placeholder: "订阅源名称",
        }) as HTMLInputElement;
        const doSave = async () => {
            const name = nameInput.value.trim();
            if (!name) return toast("订阅源名称不能为空", "warn");
            const latest = this.storage.getSub(s.id);
            if (!latest) {
                dialog.close();
                return toast("订阅源不存在或已被删除", "error");
            }
            await this.storage.patchSubMeta(s.id, { name });
            dialog.close();
            toast(`已重命名为「${name}」`, "success", 1800);
        };
        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") doSave();
        });
        const dialog = modal({
            title: "重命名订阅源",
            width: "420px",
            content: el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["显示名称"]),
                nameInput,
            ]),
            footer: [
                button({ text: "取消", variant: "ghost", onclick: () => dialog.close() }),
                button({ text: "保存", variant: "primary", onclick: doSave }),
            ],
        });
        setTimeout(() => {
            nameInput.focus();
            nameInput.select();
        }, 0);
    }

    openCatMenu(target: HTMLElement, catId: string, catName: string, ev?: MouseEvent) {
        ev?.stopPropagation();
        const items = [
            { label: "在此分类添加", icon: "plus", onClick: () => this.showAddDialog(catId) },
            catId === "c_default" ? { label: "AI 分类", icon: "wand", onClick: () => this.classifyUncategorized() } : null,
            { label: "重命名", icon: "edit", onClick: () => {
                const n = prompt("新名称", catName);
                if (n) {
                    const old = this.storage.getCats().find((c) => c.id === catId);
                    this.storage.upsertCat({
                        id: catId,
                        name: n,
                        color: old?.color,
                        sortOrder: old?.sortOrder ?? 0,
                        collapsed: old?.collapsed ?? false,
                        builtin: old?.builtin,
                    });
                }
            }},
            catId !== "c_default" ? { divider: true, label: "" } : null,
            catId !== "c_default" ? { label: "删除分类", icon: "trash", danger: true, onClick: () => {
                if (confirm(`删除分类「${catName}」？`)) this.storage.removeCat(catId);
            }} : null,
        ].filter(Boolean) as DropdownItem[];
        dropdown(target, items);
    }

    private async classifyUncategorized() {
        const ai = (this as any)._ai as AIService | undefined;
        if (!ai?.providers().length) {
            toast("请先在设置中配置 AI 提供商", "error", 5000);
            return;
        }
        const uncategorized = this.storage.getSubs().filter((sub) => !this.storage.resolveSubCategoryId(sub));
        if (!uncategorized.length) {
            toast("未分类下没有订阅源", "info");
            return;
        }
        const existingCats = this.storage.getCats().filter((cat) => cat.id !== "c_default");
        const notice = toast(`正在 AI 分类 ${uncategorized.length} 个订阅源…`, "info", 0);
        const prompt: PromptTemplate = {
            id: "classify_subscriptions",
            name: "订阅源分类",
            icon: "wand",
            order: 0,
            builtin: true,
            outputFormat: "json",
            systemPrompt: "你是 RSS 订阅源整理助手。只输出 JSON，不输出解释。",
            userPrompt: "",
        };
        const sourceLines = uncategorized.map((sub) => [
            `id: ${sub.id}`,
            `name: ${sub.name}`,
            `url: ${sub.url}`,
            `site: ${sub.siteUrl || ""}`,
            `description: ${sub.description || ""}`,
        ].join("\n")).join("\n\n");
        const renderedPrompt = [
            "请为下面未分类的 RSS 订阅源选择分类。",
            "优先使用已有分类；确实没有合适分类时，可以创建新的短分类名。",
            "分类名用简体中文，尽量 2-6 个字。",
            "只输出 JSON 数组，格式：[{\"id\":\"订阅源 id\",\"category\":\"分类名\"}]。",
            "",
            `已有分类：${existingCats.map((cat) => cat.name).join("、") || "无"}`,
            "",
            "订阅源：",
            sourceLines,
        ].join("\n");
        const fakeArticle: Article = {
            id: "classify_subscriptions",
            subscriptionId: "",
            title: "订阅源分类",
            link: "",
            pubDate: Date.now(),
            fetchedAt: Date.now(),
            content: renderedPrompt,
            description: "",
            isRead: true,
            isStarred: false,
        };

        try {
            let full = "";
            await ai.streamRenderedTemplate(fakeArticle, prompt, renderedPrompt, {
                onChunk: (chunk) => { full += chunk; },
                onDone: (final) => { full = final || full; },
                onError: (err) => { throw err; },
            });
            const rows = parseJsonArray(full)
                .map((row) => ({ id: String(row.id || ""), category: String(row.category || "").trim() }))
                .filter((row) => row.id && row.category);
            if (!rows.length) {
                notice.dismiss();
                toast("AI 没有返回可用分类结果", "warn", 4000);
                return;
            }
            const byName = new Map(this.storage.getCats().filter((cat) => cat.id !== "c_default").map((cat) => [cat.name, cat]));
            const maxOrder = Math.max(0, ...this.storage.getCats().map((cat) => cat.sortOrder || 0));
            let created = 0;
            for (const name of Array.from(new Set(rows.map((row) => row.category)))) {
                if (byName.has(name)) continue;
                const cat: Category = { id: genId("cat_"), name, color: "#94a3b8", sortOrder: maxOrder + created + 1, collapsed: false };
                await this.storage.upsertCat(cat);
                byName.set(name, cat);
                created++;
            }
            const grouped = new Map<string, string[]>();
            rows.forEach((row) => {
                const sub = uncategorized.find((item) => item.id === row.id);
                const cat = byName.get(row.category);
                if (!sub || !cat) return;
                grouped.set(cat.id, [...(grouped.get(cat.id) || []), sub.id]);
            });
            let moved = 0;
            for (const [catId, ids] of grouped) {
                await this.storage.moveSubs(ids, catId);
                moved += ids.length;
            }
            notice.dismiss();
            toast(`已分类 ${moved} 个订阅源${created ? `，新建 ${created} 个分类` : ""}`, "success", 4000);
            this.render();
        } catch (e) {
            notice.dismiss();
            toast("AI 分类失败：" + (e as Error).message, "error", 5000);
        }
    }

    onRefresh: (id: string, options?: { silent?: boolean }) => void | Promise<void> = () => {};
}

// =============== 文章列表 ===============

class ArticleListView {
    root: HTMLElement;
    storage: Storage;
    active: string = "all";
    filter: "all" | "unread" | "read" | "starred" = "all";
    search: string = "";
    dailyDate: string = "";
    visibleCount: number = 30;
    activeArticleId: string | null = null;
    private listScrollTop = 0;
    private centerArticleId: string | null = null;
    onOpen: (id: string) => void;
    onDaily: (date: string) => void;
    onGenerateDaily: (date: string) => void;
    onRefresh: () => void;
    onMarkRead: (ids: string[]) => void;
    refreshStatus: "idle" | "refreshing" | "done" = "idle";

    constructor(root: HTMLElement, storage: Storage, onOpen: (id: string) => void, onDaily: (date: string) => void, onGenerateDaily: (date: string) => void, onRefresh: () => void, onMarkRead: (ids: string[]) => void) {
        this.root = root;
        this.storage = storage;
        this.onOpen = onOpen;
        this.onDaily = onDaily;
        this.onGenerateDaily = onGenerateDaily;
        this.onRefresh = onRefresh;
        this.onMarkRead = onMarkRead;
        storage.on(() => this.render());
        this.render();
    }

    setRefreshStatus(status: ArticleListView["refreshStatus"]) {
        this.refreshStatus = status;
        this.render();
    }

    setActive(id: string) {
        this.active = id;
        this.filter = "all";
        this.visibleCount = 30;
        this.render();
        if (id === "daily") {
            const dates = this.getArticleDates();
            if (dates.length) {
                this.dailyDate = this.dailyDate && dates.includes(this.dailyDate) ? this.dailyDate : dates[0];
                this.onDaily(this.dailyDate);
            }
        }
    }
    setActiveArticle(id: string | null, options: { center?: boolean } = {}) {
        this.activeArticleId = id;
        if (options.center) this.centerArticleId = id;
        this.render();
    }

    private getActiveCategory() {
        return this.storage.getCats().find((c) => c.id === this.active) || null;
    }

    getArticles(): Article[] {
        let list: Article[] = this.storage.getArticles();
        const activeCategory = this.getActiveCategory();
        if (this.active === "unread") list = list.filter((a) => !a.isRead);
        else if (this.active === "today") list = list.filter((a) => Date.now() - a.pubDate < 86400_000);
        else if (this.active === "starred") list = list.filter((a) => a.isStarred);
        else if (this.active === "daily") list = [];
        else if (!activeCategory && this.active !== "all") list = list.filter((a) => a.subscriptionId === this.active);
        if (activeCategory) {
            const subIds = this.storage.getSubs()
                .filter((s) => this.active === "c_default" ? !this.storage.resolveSubCategoryId(s) : this.storage.resolveSubCategoryId(s) === this.active)
                .map((s) => s.id);
            list = list.filter((a) => subIds.includes(a.subscriptionId));
        }
        if (this.filter === "unread") list = list.filter((a) => !a.isRead);
        else if (this.filter === "read") list = list.filter((a) => a.isRead);
        else if (this.filter === "starred") list = list.filter((a) => a.isStarred);
        if (this.search) {
            const s = this.search.toLowerCase();
            list = list.filter((a) => a.title.toLowerCase().includes(s) || (a.description || "").toLowerCase().includes(s));
        }
        return list;
    }

    getAdjacentArticle(id: string, direction: "prev" | "next"): Article | null {
        const articles = this.getArticles();
        const index = articles.findIndex((a) => a.id === id);
        if (index >= 0) {
            return direction === "prev" ? articles[index - 1] || null : articles[index + 1] || null;
        }
        const current = this.storage.getArticle(id);
        if (!current) return null;
        if (direction === "prev") {
            for (let i = articles.length - 1; i >= 0; i--) {
                if (articles[i].pubDate > current.pubDate) return articles[i];
            }
            return null;
        }
        return articles.find((a) => a.pubDate < current.pubDate) || null;
    }

    private getArticleDates(): string[] {
        return Array.from(new Set(this.storage.getArticles().map((a) => dateKey(a.pubDate)))).sort((a, b) => b.localeCompare(a));
    }

    private articlesOnDate(key: string): Article[] {
        return this.storage.getArticles().filter((a) => dateKey(a.pubDate) === key);
    }

    private renderDailyPanel() {
        const dates = this.getArticleDates();
        const header = el("div", { class: "ar-list__header" }, [
            el("div", { class: "ar-list__title" }, [iconLabel("wand", "AI 日报", 15)]),
        ]);
        this.root.appendChild(header);
        if (!dates.length) {
            this.root.appendChild(empty("article", "暂无可生成日期", "刷新订阅后再生成日报"));
            return;
        }
        this.dailyDate = this.dailyDate && dates.includes(this.dailyDate) ? this.dailyDate : dates[0];
        const select = el("select", { class: "ar-input" }) as HTMLSelectElement;
        dates.forEach((date) => {
            const count = this.articlesOnDate(date).length;
            select.appendChild(el("option", { value: date, selected: date === this.dailyDate }, [`${displayDate(date)}（${count} 篇）`]));
        });
        select.addEventListener("change", () => {
            this.dailyDate = select.value;
            this.onDaily(this.dailyDate);
            this.render();
        });
        const articles = this.articlesOnDate(this.dailyDate);
        const panel = el("div", { class: "ar-daily-panel" }, [
            el("div", { class: "ar-form__row" }, [
                el("label", { class: "ar-form__label" }, ["选择日期"]),
                select,
            ]),
            button({ variant: "primary", icon: "wand", text: "生成日报", block: true, onclick: () => this.onGenerateDaily(this.dailyDate) }),
            el("div", { class: "ar-form__hint" }, [`将汇总当天 ${articles.length} 篇文章，按分类生成摘要并附文章跳转。`]),
        ]);
        this.root.appendChild(panel);
        const preview = el("div", { class: "ar-daily-list" });
        const bySub = new Map<string, { sub?: Subscription; count: number }>();
        articles.forEach((a) => {
            const current = bySub.get(a.subscriptionId) || { sub: this.storage.getSub(a.subscriptionId), count: 0 };
            current.count += 1;
            bySub.set(a.subscriptionId, current);
        });
        Array.from(bySub.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .forEach(([subId, item]) => {
                const sub = item.sub;
                preview.appendChild(el("button", { class: "ar-daily-list__item ar-daily-list__item--source", onclick: () => this.setActive(subId) }, [
                    sub ? subscriptionLogo(sub, "ar-daily-list__logo", 12) : el("span", { class: "ar-daily-list__logo" }, [makeIcon("rss", 12)]),
                    el("span", { class: "ar-daily-list__source-main" }, [
                        el("span", { class: "ar-daily-list__title" }, [sub?.name || "未知订阅源"]),
                        sub?.categoryName ? el("span", { class: "ar-daily-list__meta" }, [sub.categoryName]) : null,
                    ].filter(Boolean) as HTMLElement[]),
                    el("span", { class: "ar-daily-list__count" }, [`${item.count} 篇`]),
                ]));
        });
        this.root.appendChild(preview);
    }

    render() {
        const oldList = this.root.querySelector<HTMLElement>(".ar-list__items");
        if (oldList) this.listScrollTop = oldList.scrollTop;
        clear(this.root);
        if (this.active === "daily") {
            this.renderDailyPanel();
            return;
        }
        const subs = this.storage.getSubs();
        const subMap = new Map(subs.map((s) => [s.id, s]));
        const articles = this.getArticles();

        // 头部
        const title = this.getHeaderTitle();
        const search = el("input", { class: "ar-input ar-list__search", type: "search", placeholder: "搜索文章标题、作者、内容…", value: this.search }) as HTMLInputElement;
        const onSearch = debounce(() => { this.search = search.value.trim(); this.visibleCount = 30; this.render(); }, 200);
        search.addEventListener("input", onSearch);

        const filterChips = el("div", { class: "ar-list__filters" });
        const showFilters = this.active !== "unread" && this.active !== "starred";
        if (showFilters) {
            const filters: [ArticleListView["filter"], string, string, number][] = [["all", "全部", "list", articles.length]];
            filters.push(["unread", "未读", "bell", articles.filter((a) => !a.isRead).length]);
            filters.push(["starred", "星标", "star", articles.filter((a) => a.isStarred).length]);
            filters.forEach(([f, l, ic, c]) => filterChips.appendChild(el("button", {
                class: `ar-list__chip ar-list__chip--${f} ${this.filter === f ? "ar-list__chip--active" : ""}`,
                onclick: () => { this.filter = f; this.visibleCount = 30; this.render(); },
            }, [iconLabel(ic as string, l as string, 12), c > 0 ? el("span", { class: "ar-list__chip-c" }, [String(c)]) : null])));
        }

        const unreadIds = articles.filter((a) => !a.isRead).map((a) => a.id);
        const statusText = this.refreshStatus === "refreshing" ? "正在刷新…" : this.refreshStatus === "done" ? "刷新完成" : "";
        const header = el("div", { class: "ar-list__header" }, [
            el("div", { class: "ar-list__title-wrap" }, [
                el("div", { class: "ar-list__title" }, [title]),
                statusText ? el("span", { class: `ar-list__status-text ar-list__status-text--${this.refreshStatus}` }, [statusText]) : null,
            ].filter(Boolean) as HTMLElement[]),
            el("div", { class: "ar-list__header-actions" }, [
                button({ variant: "icon", icon: "check", title: unreadIds.length ? `将当前列表 ${unreadIds.length} 篇标为已读` : "当前列表没有未读文章", disabled: unreadIds.length === 0, onclick: () => this.onMarkRead(unreadIds) }),
                button({ variant: "icon", icon: "refresh", title: this.refreshStatus === "refreshing" ? "正在刷新" : "刷新", disabled: this.refreshStatus === "refreshing", className: this.refreshStatus === "refreshing" ? "ar-list__refresh-btn--spinning" : "", onclick: () => this.onRefresh() }),
            ]),
        ]);
        const toolbar = el("div", { class: "ar-list__toolbar" }, showFilters ? [search, filterChips] : [search]);
        this.root.appendChild(header);
        this.root.appendChild(toolbar);

        if (articles.length === 0) {
            this.root.appendChild(empty("mailOpen", "暂无文章", "在侧栏添加一个订阅源试试"));
            return;
        }

        if (this.activeArticleId) {
            const activeIndex = articles.findIndex((a) => a.id === this.activeArticleId);
            if (activeIndex >= this.visibleCount) this.visibleCount = Math.min(activeIndex + 15, articles.length);
        }
        const list = el("div", { class: "ar-list__items" });
        const visible = articles.slice(0, this.visibleCount);
        let lastDay = "";
        visible.forEach((a) => {
            const day = new Date(a.pubDate).toLocaleDateString("zh-CN");
            if (day !== lastDay) {
                list.appendChild(el("div", { class: "ar-list__day" }, [day]));
                lastDay = day;
            }
            list.appendChild(this.renderItem(a, subMap.get(a.subscriptionId)));
        });
        this.root.appendChild(list);
        list.scrollTop = this.listScrollTop;
        if (this.centerArticleId) {
            const targetId = this.centerArticleId;
            this.centerArticleId = null;
            requestAnimationFrame(() => this.centerArticle(targetId));
        }
        list.addEventListener("scroll", () => {
            this.listScrollTop = list.scrollTop;
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - 100 && this.visibleCount < articles.length) {
                this.visibleCount = Math.min(this.visibleCount + 30, articles.length);
                this.render();
            }
        });
    }

    private centerArticle(id: string) {
        const list = this.root.querySelector<HTMLElement>(".ar-list__items");
        const item = list?.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(id)}"]`);
        if (!list || !item) return;
        const top = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
        list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        this.listScrollTop = Math.max(0, top);
    }

    private getHeaderTitle(): HTMLElement | string {
        const label = (() => {
            if (this.active === "all") return iconLabel("list", "全部", 15);
            if (this.active === "unread") return iconLabel("bell", "未读", 15);
            if (this.active === "today") return iconLabel("inbox", "今天", 15);
            if (this.active === "starred") return iconLabel("star", "星标", 15);
            const c = this.getActiveCategory();
            if (c) return iconLabel("folder", c.name, 15);
            const s = this.storage.getSub(this.active);
            return s ? el("span", { class: "ar-list__feed-title" }, [
                subscriptionLogo(s, "ar-list__feed-logo", 13),
                el("span", {}, [s.name]),
            ]) : this.active;
        })();
        return label;
    }

    renderItem(a: Article, sub: Subscription | undefined) {
        const isActive = a.id === this.activeArticleId;
        const isUnread = !a.isRead;
        const tmp = document.createElement("div");
        tmp.innerHTML = a.description || a.content || "";
        const desc = (tmp.textContent || "").replace(/\s+/g, " ").slice(0, 100);
        return el("div", {
            class: `ar-list__item ${isActive ? "ar-list__item--active" : ""} ${isUnread ? "ar-list__item--unread" : ""}`,
            dataset: { articleId: a.id },
            onclick: () => {
                this.onOpen(a.id);
            },
        }, [
            el("span", { class: `ar-list__dot ${isUnread ? "ar-list__dot--unread" : ""}` }),
            el("div", { class: "ar-list__main" }, [
                el("div", { class: "ar-list__title-row" }, [a.title || "(无标题)"]),
                el("div", { class: "ar-list__desc" }, [desc]),
                el("div", { class: "ar-list__meta" }, [
                    sub ? el("span", {}, [sub.name]) : null,
                    a.isStarred ? el("span", { class: "ar-list__status" }, [makeIcon("star", 12)]) : null,
                    a.savedDocId ? el("span", { class: "ar-list__status" }, [makeIcon("inbox", 12)]) : null,
                ].filter(Boolean) as HTMLElement[]),
                el("time", { class: "ar-list__time" }, [timeAgo(a.pubDate)]),
            ]),
        ]);
    }
}

// =============== 阅读器 + AI ===============

class Reader {
    root: HTMLElement;
    storage: Storage;
    ai: AIService;
    current: Article | null = null;
    mode: "article" | "daily" = "article";
    summaryVisible = false;
    translationVisible = false;
    contentArea: HTMLElement | null = null;
    dailyDate = "";
    dailyReport = "";
    dailyLoading = false;
    fromDaily = false;
    onOpenArticle: (id: string) => void;
    onNavigateArticle: (currentId: string, direction: "prev" | "next") => void;
    getAdjacentArticle: (currentId: string, direction: "prev" | "next") => Article | null;
    private boundarySwitchAt = 0;
    private switchHintTimer: number | null = null;
    private switchArmed: { direction: "prev" | "next"; articleId: string; expiresAt: number; distance: number; lastWheelAt: number } | null = null;

    constructor(root: HTMLElement, storage: Storage, ai: AIService, onOpenArticle: (id: string) => void, onNavigateArticle: (currentId: string, direction: "prev" | "next") => void, getAdjacentArticle: (currentId: string, direction: "prev" | "next") => Article | null) {
        this.root = root;
        this.storage = storage;
        this.ai = ai;
        this.onOpenArticle = onOpenArticle;
        this.onNavigateArticle = onNavigateArticle;
        this.getAdjacentArticle = getAdjacentArticle;
        storage.on(() => this.render());
        this.render();
    }

    showArticle(a: Article | null) {
        this.current = a;
        this.mode = "article";
        this.fromDaily = false;
        this.summaryVisible = false;
        this.translationVisible = false;
        this.render();
    }

    showArticleFromDaily(id: string) {
        this.current = this.storage.getArticle(id) || null;
        this.mode = "article";
        this.fromDaily = true;
        this.summaryVisible = false;
        this.translationVisible = false;
        this.render();
    }

    showDaily(date: string) {
        this.mode = "daily";
        this.current = null;
        this.dailyDate = date;
        this.dailyLoading = false;
        this.render();
    }

    render() {
        clear(this.root);
        if (this.mode === "daily") {
            this.renderDaily();
            return;
        }
        if (!this.current) {
            this.root.appendChild(empty("article", "选择一篇文章开始阅读", "点击左侧列表的文章"));
            return;
        }
        const a = this.current;
        const sub = this.storage.getSub(a.subscriptionId);
        const settings = this.storage.getSettings();

        // 顶部
        const topBar = el("div", { class: "ar-rd__topbar" }, [
            el("div", { class: "ar-rd__tabs" }, [
                this.fromDaily && this.dailyDate ? el("button", { class: "ar-rd__tab ar-rd__tab--return", onclick: () => this.showDaily(this.dailyDate) }, [iconLabel("chevronLeft", "返回日报", 13)]) : null,
                el("button", { class: `ar-rd__tab ${this.summaryVisible ? "ar-rd__tab--active" : ""}`, onclick: () => this.showInlinePrompt(a, SUMMARY_PROMPT) }, [iconLabel("ai", "AI 总结", 13)]),
                el("button", { class: `ar-rd__tab ${this.translationVisible ? "ar-rd__tab--active" : ""}`, onclick: () => this.showInlinePrompt(a, TRANSLATE_PROMPT) }, [iconLabel("translate", "AI 翻译", 13)]),
            ].filter(Boolean) as HTMLElement[]),
            (() => {
                const actions = el("div", { class: "ar-rd__actions" });
                const items: (HTMLElement | null)[] = [
                    button({ variant: "icon", icon: "star", title: a.isStarred ? "取消星标" : "星标", active: a.isStarred, className: "ar-rd__state-btn ar-rd__state-btn--star", onclick: () => this.storage.setStar(a.id, !a.isStarred) }),
                    button({ variant: "icon", icon: "check", title: a.isRead ? "标为未读" : "标为已读", active: a.isRead, className: "ar-rd__state-btn ar-rd__state-btn--read", onclick: () => this.storage.setRead(a.id, !a.isRead) }),
                    a.link
                        ? (a.fullText
                            ? (() => button({ variant: "secondary", icon: "refresh", text: "恢复原文", title: "恢复 RSS 原文内容", onclick: () => this.revertFullText(a) }))()
                            : (() => button({ variant: "primary", icon: "download", text: "抓取全文", title: "访问原文链接解析正文，替代 RSS 摘要", onclick: () => this.fetchFullTextFor(a) }))())
                        : null,
                    button({ variant: "primary", icon: "save", text: "保存", onclick: () => saveToSiyuan(a, settings, a.aiResults || {}).then((id) => { if (id) this.storage.setSaved(a.id, id); }) }),
                ];
                items.filter(Boolean).forEach((b) => actions.appendChild(b as HTMLElement));
                return actions;
            })(),
        ]);
        this.root.appendChild(topBar);

        const prevArticle = this.getAdjacentArticle(a.id, "prev");
        const nextArticle = this.getAdjacentArticle(a.id, "next");
        const boundarySwitch = settings.reading?.boundaryScrollSwitch !== false;

        // 内容
        this.contentArea = el("div", { class: "ar-rd__content" });
        this.renderArticle(this.contentArea, a, sub);
        this.root.appendChild(this.contentArea);
        if (boundarySwitch) {
            const prevHint = this.renderArticleSwitchHint("prev", prevArticle);
            const nextHint = this.renderArticleSwitchHint("next", nextArticle);
            this.root.appendChild(prevHint);
            this.root.appendChild(nextHint);
            this.bindBoundarySwitch(this.contentArea, a.id, prevHint, nextHint, !!prevArticle, !!nextArticle);
        }
    }

    private renderArticleSwitchHint(direction: "prev" | "next", article: Article | null) {
        const isPrev = direction === "prev";
        const title = article?.title || (isPrev ? "已经是上一篇边界" : "已经是最后一篇");
        return el("button", {
            class: `ar-rd__switch ar-rd__switch--${direction} ${article ? "" : "ar-rd__switch--disabled"}`,
            type: "button",
            disabled: !article,
        }, [
            el("span", { class: "ar-rd__switch-progress" }),
            el("span", { class: "ar-rd__switch-icon" }, [makeIcon("chevronDown", 14)]),
            el("span", { class: "ar-rd__switch-text" }, [isPrev ? "继续上滑阅读上一篇" : "继续下滑阅读下一篇"]),
            el("span", { class: "ar-rd__switch-title" }, [title]),
        ]);
    }

    private showSwitchHint(show: HTMLElement, hide: HTMLElement, progress = 0) {
        hide.classList.remove("ar-rd__switch--visible", "ar-rd__switch--armed");
        hide.style.setProperty("--ar-switch-progress", "0");
        const normalized = Math.max(0, Math.min(progress, 1));
        show.style.setProperty("--ar-switch-progress", String(normalized));
        show.classList.toggle("ar-rd__switch--armed", normalized > 0);
        const text = show.querySelector<HTMLElement>(".ar-rd__switch-text");
        if (text) {
            if (normalized > 0) text.textContent = show.classList.contains("ar-rd__switch--prev") ? "继续上滑切换上一篇" : "继续下滑切换下一篇";
            else text.textContent = show.classList.contains("ar-rd__switch--prev") ? "继续上滑阅读上一篇" : "继续下滑阅读下一篇";
        }
        show.classList.add("ar-rd__switch--visible");
        if (this.switchHintTimer) window.clearTimeout(this.switchHintTimer);
        this.switchHintTimer = window.setTimeout(() => {
            show.classList.remove("ar-rd__switch--visible", "ar-rd__switch--armed");
            this.switchHintTimer = null;
        }, 2200);
    }

    private hideSwitchHints(...hints: HTMLElement[]) {
        hints.forEach((hint) => hint.classList.remove("ar-rd__switch--visible", "ar-rd__switch--armed"));
        hints.forEach((hint) => hint.style.setProperty("--ar-switch-progress", "0"));
        if (this.switchHintTimer) {
            window.clearTimeout(this.switchHintTimer);
            this.switchHintTimer = null;
        }
        this.switchArmed = null;
    }

    private bindBoundarySwitch(container: HTMLElement, articleId: string, prevHint: HTMLElement, nextHint: HTMLElement, hasPrev: boolean, hasNext: boolean) {
        container.addEventListener("wheel", (event) => {
            const reading = this.storage.getSettings().reading;
            const cooldown = Math.max(0, Math.min(reading?.boundaryCooldownMs ?? 700, 3000));
            const triggerDistance = 220;
            const armDuration = 1600;
            const atTop = container.scrollTop <= 1;
            const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
            const now = Date.now();
            const direction = event.deltaY < 0 ? "prev" : event.deltaY > 0 ? "next" : null;
            if (!direction) return;
            if (now - this.boundarySwitchAt < cooldown) return;

            const canSwitch = direction === "prev" ? atTop && hasPrev : atBottom && hasNext;
            if (!canSwitch) {
                this.switchArmed = null;
                this.hideSwitchHints(prevHint, nextHint);
                return;
            }

            event.preventDefault();
            const hint = direction === "prev" ? prevHint : nextHint;
            const otherHint = direction === "prev" ? nextHint : prevHint;
            const armed = this.switchArmed?.direction === direction
                && this.switchArmed.articleId === articleId
                && this.switchArmed.expiresAt > now;
            const absDelta = Math.abs(event.deltaY);
            const isDiscreteWheel = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || absDelta >= 80;
            const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? container.clientHeight : 1;
            const rawDelta = absDelta * multiplier;
            const delta = isDiscreteWheel
                ? triggerDistance * 0.14
                : Math.min(rawDelta, triggerDistance * 0.08);
            const prevDistance = armed && now - this.switchArmed!.lastWheelAt < 600 ? this.switchArmed!.distance : 0;
            const distance = Math.min(triggerDistance * 1.8, prevDistance + delta);
            if (!armed || distance < triggerDistance) {
                this.switchArmed = { direction, articleId, expiresAt: now + armDuration, distance, lastWheelAt: now };
                this.showSwitchHint(hint, otherHint, distance / triggerDistance);
                return;
            }

            this.hideSwitchHints(prevHint, nextHint);
            this.boundarySwitchAt = now;
            this.switchArmed = null;
            this.onNavigateArticle(articleId, direction);
        }, { passive: false });
    }

    renderDaily() {
        const articles = this.getDailyArticles(this.dailyDate);
        const topBar = el("div", { class: "ar-rd__topbar" }, [
            el("div", { class: "ar-rd__tabs" }, [iconLabel("wand", `AI 日报 · ${displayDate(this.dailyDate)}`, 13)]),
            button({ variant: "primary", icon: "save", text: "保存", disabled: !this.dailyReport || this.dailyLoading, onclick: () => this.saveDailyReport() }),
        ]);
        this.root.appendChild(topBar);
        const content = el("div", { class: "ar-rd__content" });
        if (!articles.length) {
            content.appendChild(empty("article", "这一天没有文章", "请选择有文章的日期"));
        } else if (this.dailyReport || this.dailyLoading) {
            content.appendChild(el("div", { class: "ar-daily-report ar-rd__body", html: mdToHtml(this.linkDailyCitations(this.dailyReport || "正在生成日报…", articles)) }));
        } else {
            content.appendChild(el("div", { class: "ar-daily-hero" }, [
                el("h1", {}, ["AI 日报"]),
                el("p", {}, [`${displayDate(this.dailyDate)} · ${articles.length} 篇文章`]),
            ]));
        }
        content.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const link = target.closest("a") as HTMLAnchorElement | null;
            if (!link) return;
            const href = link.getAttribute("href") || "";
            if (!href.startsWith("article:")) return;
            event.preventDefault();
            this.onOpenArticle(href.replace(/^article:/, ""));
        });
        this.root.appendChild(content);
    }

    private saveDailyReport() {
        if (!this.dailyReport || this.dailyLoading) return;
        const articles = this.getDailyArticles(this.dailyDate);
        const markdown = this.linkDailyCitations(this.dailyReport, articles);
        saveMarkdownToSiyuan(`${displayDate(this.dailyDate)} AI 日报`, markdown);
    }

    private getDailyArticles(date: string): Article[] {
        return this.storage.getArticles().filter((a) => dateKey(a.pubDate) === date);
    }

    private dailyCategoryName(article: Article): string {
        const sub = this.storage.getSub(article.subscriptionId);
        const catId = sub ? this.storage.resolveSubCategoryId(sub) : undefined;
        const cat = catId ? this.storage.getCats().find((c) => c.id === catId) : null;
        return cat?.name || "未分类";
    }

    private buildDailyPrompt(date: string, articles: Article[]): string {
        const lines = articles.map((a, index) => {
            const sub = this.storage.getSub(a.subscriptionId);
            const text = htmlToPlainText(a.description || a.content || "").slice(0, 320);
            return [
                `编号：${index + 1}`,
                `分类：${this.dailyCategoryName(a)}`,
                `来源：${sub?.name || "未知来源"}`,
                `标题：${a.title || "(无标题)"}`,
                `摘要：${text}`,
            ].join("\n");
        }).join("\n\n");
        return [
            `请基于 ${displayDate(date)} 的 RSS 文章生成中文 AI 日报。`,
            "要求：",
            "1. 按分类组织内容，每个分类给出 2-4 句总览。",
            "2. 先给出「今日速览」，再给出「分类总结」。",
            "3. 不要编造文章之外的信息。",
            "4. 每个关键判断、趋势或总结句后面必须直接标注对应文章编号，例如 [1]、[2][5]；不要把链接或编号集中放到最后。",
            "5. 输出 Markdown。",
            "",
            lines,
        ].join("\n");
    }

    private linkDailyCitations(markdown: string, articles: Article[]): string {
        return markdown
            .replace(/\[↗\]\(article:/g, "[↗︎](article:")
            .replace(/\[跳转\]\(article:/g, "[↗︎](article:")
            .replace(/\[(\d+)\]/g, (match, rawIndex) => {
            const index = Number(rawIndex);
            const article = articles[index - 1];
            if (!article) return match;
            return `[↗︎](article:${article.id})`;
        });
    }

    async generateDailyReport(date: string) {
        const articles = this.getDailyArticles(date);
        if (!articles.length) return toast("这一天没有文章", "warn");
        if (!this.ai.providers().length) return toast("请先在设置中配置 AI 提供商", "error", 5000);
        this.dailyLoading = true;
        this.dailyReport = "";
        this.render();
        try {
            let full = "";
            const fakeArticle = {
                id: `daily_${date}`,
                subscriptionId: "",
                title: `${displayDate(date)} AI 日报`,
                link: "",
                pubDate: Date.now(),
                fetchedAt: Date.now(),
                content: "",
                description: "",
                isRead: true,
                isStarred: false,
            } as Article;
            const dailyPrompt = { ...DAILY_REPORT_PROMPT, ...(this.ai.getPrompt(DAILY_REPORT_PROMPT.id) || {}) };
            await this.ai.streamRenderedTemplate(fakeArticle, dailyPrompt, this.buildDailyPrompt(date, articles), {
                onChunk: (chunk) => {
                    full += chunk;
                    this.dailyReport = full;
                    this.updateDailyReport();
                },
                onDone: (final) => {
                    this.dailyReport = final || full;
                    this.dailyLoading = false;
                    this.render();
                },
                onError: (err) => {
                    this.dailyLoading = false;
                    this.dailyReport = `生成失败：${err.message}`;
                    this.render();
                    toast("AI 日报生成失败：" + err.message, "error", 5000);
                },
            });
        } catch (e) {
            this.dailyLoading = false;
            this.dailyReport = `生成失败：${(e as Error).message}`;
            this.render();
        }
    }

    private updateDailyReport() {
        const body = this.root.querySelector<HTMLElement>(".ar-daily-report");
        if (body) body.innerHTML = mdToHtml(this.linkDailyCitations(this.dailyReport || "正在生成日报…", this.getDailyArticles(this.dailyDate)));
    }

    renderArticle(c: HTMLElement, a: Article, sub: Subscription | undefined) {
        const translation = getTranslatedResult(a.aiResults?.[TRANSLATE_PROMPT.id]);
        const titleHtml = this.translationVisible && !translation.title
            ? buildTranslatableTitleHtml(a.title || "(无标题)")
            : "";
        const header = el("div", { class: "ar-rd__head" }, [
            titleHtml
                ? el("h1", { class: "ar-rd__title", html: titleHtml })
                : el("h1", { class: "ar-rd__title" }, [this.translationVisible && translation.title ? translation.title : (a.title || "(无标题)")]),
            el("div", { class: "ar-rd__meta" }, [
                sub ? el("span", {}, [sub.name]) : null,
                el("span", { class: "ar-rd__sep" }, ["·"]),
                el("time", {}, [new Date(a.pubDate).toLocaleString("zh-CN")]),
                a.author ? el("span", { class: "ar-rd__sep" }, ["·"]) : null,
                a.author ? el("span", {}, [a.author]) : null,
                el("span", { class: "ar-rd__sep" }, ["·"]),
                el("span", {}, [iconLabel("article", `${estimateReadingTime(a.content || a.description)} 分钟`, 12)]),
                a.savedDocId ? el("span", { class: "ar-rd__sep" }, ["·"]) : null,
                a.savedDocId ? el("span", { class: "ar-rd__saved" }, [iconLabel("inbox", "已保存", 12)]) : null,
            ].filter(Boolean) as HTMLElement[]),
        ]);
        c.appendChild(header);


        // 正文：只在抓取结果足够像正文时才替换 RSS 原文，避免页面壳覆盖内容。
        const fullText = usableFullText(a);
        const displayHtml = fullText || a.content || a.description || "";
        const isFullText = !!fullText;
        if (this.summaryVisible) this.renderInlineAI(c, a);
        if (this.translationVisible) {
            this.renderTranslationBody(c, a, displayHtml);
        } else {
            const html = sanitize(displayHtml);
            const body = el("div", { class: "ar-rd__body", html: postProcess(html) });
            c.appendChild(body);
        }
        if (isFullText) {
            const badge = el("div", { class: "ar-rd__fulltext-badge" }, [iconLabel("fileText", "已抓取全文", 12)]);
            c.appendChild(badge);
        }

        c.appendChild(el("div", { class: "ar-rd__footer" }, [
            el("a", { href: a.link, target: "_blank", rel: "noopener noreferrer", class: "ar-rd__origin" }, [iconLabel("link", "在浏览器中打开原文 →", 14)]),
        ]));
        c.appendChild(el("div", { class: "ar-rd__scroll-buffer" }));
    }

    renderInlineAI(c: HTMLElement, a: Article) {
        if (!this.summaryVisible) return;
        const result = a.aiResults?.[SUMMARY_PROMPT.id];
        const wrap = el("div", { class: "ar-rd__inline-ai" });
        if (result) wrap.appendChild(this.renderResultCard(a, SUMMARY_PROMPT.id, result));
        c.appendChild(wrap);
    }

    renderTranslationBody(c: HTMLElement, a: Article, sourceHtml: string) {
        const translated = getTranslatedResult(a.aiResults?.[TRANSLATE_PROMPT.id]);
        if (translated.html) {
            c.appendChild(el("div", { class: "ar-rd__body ar-rd__body--translated", html: postProcess(sanitize(translated.html)) }));
            return;
        }
        const { html } = buildTranslatableHtml(sourceHtml, 2);
        const source = el("div", { class: "ar-rd__body ar-rd__translate-source", html });
        const stage = el("div", { class: "ar-rd__translate-stage" }, [
            el("div", { class: "ar-rd__translate-status" }, [spinner(12), " 正在翻译…"]),
            source,
        ]);
        c.appendChild(stage);
    }

    showInlinePrompt(a: Article, prompt: PromptTemplate) {
        this.mode = "article";
        if (prompt.id === SUMMARY_PROMPT.id) this.summaryVisible = true;
        if (prompt.id === TRANSLATE_PROMPT.id) {
            this.translationVisible = !this.translationVisible;
            this.render();
            if (!this.translationVisible || isTranslationComplete(a.aiResults?.[prompt.id])) return;
            const effectivePrompt = { ...prompt, ...(this.ai.getPrompt(prompt.id) || {}) };
            this.runTranslationPrompt(a, effectivePrompt);
            return;
        }
        this.render();
        if (a.aiResults?.[prompt.id]) return;
        const effectivePrompt = { ...prompt, ...(this.ai.getPrompt(prompt.id) || {}) };
        this.runQuickPrompt(a, effectivePrompt);
    }

    updateTranslationProgress(stage: HTMLElement, progress: number) {
        const normalized = Math.max(0, Math.min(progress, 1));
        stage.style.setProperty("--ar-translate-progress", String(normalized));
    }

    private setTranslationStatus(status: HTMLElement | null, text: string, spinning = true) {
        if (!status) return;
        clear(status);
        if (spinning) status.appendChild(spinner(12));
        status.appendChild(el("span", {}, [text]));
    }

    renderAI(c: HTMLElement, a: Article) {
        const providers = this.ai.providers();
        if (providers.length === 0) {
            c.appendChild(el("div", { class: "ar-rd__ai-empty" }, [
                el("h2", {}, ["请先配置 AI 提供商"]),
                el("p", {}, ["在侧栏底部点击设置按钮 → AI 提供商中配置。"]),
            ]));
            return;
        }
        const grid = el("div", { class: "ar-rd__ai-quick" });
        QUICK_AI_PROMPTS.forEach((p) => {
            const hasResult = a.aiResults && a.aiResults[p.id];
            grid.appendChild(el("button", {
                class: `ar-rd__ai-btn ${hasResult ? "ar-rd__ai-btn--done" : ""}`,
                onclick: () => this.runQuickPrompt(a, p),
            }, [
                el("span", { class: "ar-rd__ai-icon" }, [makeIcon(p.icon || "sparkle", 18)]),
                el("div", { class: "ar-rd__ai-name" }, [p.name]),
                hasResult ? el("span", { class: "ar-rd__ai-check" }, [makeIcon("check", 12)]) : null,
            ].filter(Boolean) as HTMLElement[]));
        });
        c.appendChild(grid);

        // 已有结果
        const quickResults = QUICK_AI_PROMPTS
            .map((p) => [p.id, a.aiResults?.[p.id]] as const)
            .filter(([, r]) => !!r);
        if (quickResults.length > 0) {
            const results = el("div", { class: "ar-rd__ai-results" });
            quickResults.forEach(([pid, r]) => results.appendChild(this.renderResultCard(a, pid, r as AIResult)));
            c.appendChild(results);
        }
    }

    renderResultCard(a: Article, pid: string, r: AIResult) {
        return el("div", { class: "ar-rd__ai-card", dataset: { promptId: pid } }, [
            el("div", { class: "ar-rd__ai-card-head" }, [
                el("span", {}, [r.promptName]),
                el("span", { style: { flex: "1" } }),
                r.usage ? el("span", { class: "ar-rd__ai-meta" }, [iconLabel("chart", `${r.usage.totalTokens} tokens`, 12)]) : null,
                el("span", { class: "ar-rd__ai-meta" }, [iconLabel("clock", `${Math.round((r.durationMs || 0) / 100) / 10}s`, 12)]),
            ]),
            el("div", { class: "ar-rd__ai-card-body", html: mdToHtml(r.content) }),
            el("div", { class: "ar-rd__ai-card-foot" }, [
                button({ variant: "ghost", size: "xs", icon: "copy", text: "复制", onclick: () => { navigator.clipboard.writeText(r.content); toast("已复制", "success"); } }),
                button({ variant: "primary", size: "xs", icon: "save", text: "附加到思源", onclick: () => saveToSiyuan(a, this.storage.getSettings(), { [pid]: r }).then((id) => { if (id) this.storage.setSaved(a.id, id); }) }),
            ]),
        ]);
    }

    async runPrompt(a: Article, promptId: string) {
        const providers = this.ai.providers();
        if (!providers.length) return toast("请先在设置中配置 AI 提供商", "error", 5000);

        // 创建 streaming 卡片
        const resultsArea = this.contentArea?.querySelector(".ar-rd__ai-results") as HTMLElement | null;
        if (!resultsArea) {
            const newArea = el("div", { class: "ar-rd__ai-results" });
            this.contentArea?.appendChild(newArea);
        }
        const target = (this.contentArea?.querySelector(".ar-rd__ai-results") as HTMLElement) || el("div");
        const tpl = this.ai.getPrompt(promptId);
        if (!tpl) return;

        const card = el("div", { class: "ar-rd__ai-card ar-rd__ai-card--stream" }, [
            el("div", { class: "ar-rd__ai-card-head" }, [
                el("span", {}, [makeIcon(tpl.icon || "sparkle", 14)]),
                el("span", {}, [tpl.name]),
                el("span", { style: { flex: "1" } }),
                el("span", { class: "ar-rd__ai-streaming" }, [spinner(12), " 生成中…"]),
            ]),
            el("div", { class: "ar-rd__ai-card-body" }, []),
        ]);
        target.insertBefore(card, target.firstChild);
        const body = card.querySelector(".ar-rd__ai-card-body") as HTMLElement;
        const head = card.querySelector(".ar-rd__ai-card-head") as HTMLElement;

        try {
            let full = "";
            const r = await this.ai.stream(a, promptId, {
                onChunk: (chunk) => {
                    full += chunk;
                    body.innerHTML = mdToHtml(full);
                },
                onDone: async (final) => {
                    body.innerHTML = mdToHtml(final);
                    head.querySelector(".ar-rd__ai-streaming")?.remove();
                    a.aiResults = a.aiResults || {};
                    a.aiResults[promptId] = r;
                    await this.storage.setAIResult(a.id, promptId, r);
                },
                onError: (err) => {
                    head.querySelector(".ar-rd__ai-streaming")?.remove();
                    body.innerHTML = `<div style="color: var(--ar-error)">${escapeHtml(err.message)}</div>`;
                    toast("AI 调用失败：" + err.message, "error", 5000);
                },
            });
        } catch (e) {
            head.querySelector(".ar-rd__ai-streaming")?.remove();
            body.innerHTML = `<div style="color: var(--ar-error)">${escapeHtml((e as Error).message)}</div>`;
        }
    }

    async runQuickPrompt(a: Article, prompt: PromptTemplate) {
        const providers = this.ai.providers();
        if (!providers.length) return toast("请先在设置中配置 AI 提供商", "error", 5000);

        const inlineTarget = this.summaryVisible && prompt.id === SUMMARY_PROMPT.id
            ? this.contentArea?.querySelector(".ar-rd__inline-ai") as HTMLElement | null
            : null;
        if (!inlineTarget) {
            const resultsArea = this.contentArea?.querySelector(".ar-rd__ai-results") as HTMLElement | null;
            if (!resultsArea) {
                const newArea = el("div", { class: "ar-rd__ai-results" });
                this.contentArea?.appendChild(newArea);
            }
        }
        const target = inlineTarget || (this.contentArea?.querySelector(".ar-rd__ai-results") as HTMLElement) || el("div");
        target.querySelector(`[data-prompt-id="${prompt.id}"]`)?.remove();

        const card = el("div", { class: "ar-rd__ai-card ar-rd__ai-card--stream", dataset: { promptId: prompt.id } }, [
            el("div", { class: "ar-rd__ai-card-head" }, [
                el("span", {}, [makeIcon(prompt.icon || "sparkle", 14)]),
                el("span", {}, [prompt.name]),
                el("span", { style: { flex: "1" } }),
                el("span", { class: "ar-rd__ai-streaming" }, [spinner(12), " 生成中…"]),
            ]),
            el("div", { class: "ar-rd__ai-card-body" }, []),
        ]);
        target.insertBefore(card, target.firstChild);
        const body = card.querySelector(".ar-rd__ai-card-body") as HTMLElement;
        const head = card.querySelector(".ar-rd__ai-card-head") as HTMLElement;

        try {
            let full = "";
            const r = await this.ai.streamTemplate(a, prompt, {
                onChunk: (chunk) => {
                    full += chunk;
                    body.innerHTML = mdToHtml(full);
                },
                onDone: async (final) => {
                    body.innerHTML = mdToHtml(final);
                    head.querySelector(".ar-rd__ai-streaming")?.remove();
                    a.aiResults = a.aiResults || {};
                    a.aiResults[prompt.id] = r;
                    await this.storage.setAIResult(a.id, prompt.id, r);
                    this.render();
                },
                onError: (err) => {
                    head.querySelector(".ar-rd__ai-streaming")?.remove();
                    body.innerHTML = `<div style="color: var(--ar-error)">${escapeHtml(err.message)}</div>`;
                    toast("AI 调用失败：" + err.message, "error", 5000);
                },
            });
        } catch (e) {
            head.querySelector(".ar-rd__ai-streaming")?.remove();
            body.innerHTML = `<div style="color: var(--ar-error)">${escapeHtml((e as Error).message)}</div>`;
        }
    }

    async runTranslationPrompt(a: Article, prompt: PromptTemplate) {
        const providers = this.ai.providers();
        if (!providers.length) return toast("请先在设置中配置 AI 提供商", "error", 5000);
        const stage = this.contentArea?.querySelector(".ar-rd__translate-stage") as HTMLElement | null;
        const status = stage?.querySelector(".ar-rd__translate-status") as HTMLElement | null;
        const source = stage?.querySelector(".ar-rd__translate-source") as HTMLElement | null;
        if (!stage || !source) return;

        try {
            let finalHtml = "";
            let finalTitle = "";
            let finalResult: AIResult | null = null;
            const startedAt = Date.now();
            const processed = new Set<number>();
            const sourceHtml = a.fullText || a.content || a.description || "";
            const titleSegment = { id: 1, text: a.title || "(无标题)" };
            const { segments: bodySegments } = buildTranslatableHtml(sourceHtml, 2);
            const segments = [titleSegment, ...bodySegments];
            const batches = batchTranslationSegments(segments);
            const applyLine = (line: string) => {
                const cleaned = line.trim().replace(/^```(?:text)?|```$/g, "").trim();
                const match = cleaned.match(/^(\d+)\s*[|｜:：]\s*(.+)$/);
                if (!match) return;
                const id = Number(match[1]);
                if (!Number.isFinite(id) || processed.has(id)) return;
                const translated = match[2].trim();
                if (!translated) return;
                const segment = this.root.querySelector<HTMLElement>(`.ar-rd__translate-segment[data-seg-id="${id}"]`);
                if (!segment) return;
                processed.add(id);
                segment.dataset.translated = translated;
                segment.querySelectorAll(".ar-rd__translate-char").forEach((char) => char.classList.add("ar-rd__translate-char--gone"));
                const replacement = el("span", { class: "ar-rd__translate-replacement" }, [translated]);
                segment.appendChild(replacement);
                setTimeout(() => {
                    segment.textContent = translated;
                    segment.classList.add("ar-rd__translate-segment--done");
                }, 220);
                this.updateTranslationProgress(stage, processed.size / Math.max(segments.length, 1));
            };
            const processBuffer = (buffer: string, final = false) => {
                const lines = buffer.split(/\r?\n/);
                const ready = final ? lines : lines.slice(0, -1);
                ready.forEach(applyLine);
            };
            for (let i = 0; i < batches.length; i++) {
                let batchFull = "";
                this.setTranslationStatus(status, "正在翻译…", true);
                const r = await this.ai.streamRenderedTemplate(a, prompt, buildSegmentTranslationPrompt(batches[i]), {
                    onChunk: (chunk) => {
                        batchFull += chunk;
                        processBuffer(batchFull, false);
                    },
                    onDone: async (final) => {
                        batchFull = final || batchFull;
                        processBuffer(batchFull, true);
                    },
                    onError: (err) => {
                        status?.classList.add("ar-rd__translate-status--error");
                        this.setTranslationStatus(status, "翻译失败", false);
                        toast("AI 翻译失败：" + err.message, "error", 5000);
                    },
                });
                finalResult = r;
            }
            const missing = () => segments.filter((segment) => !processed.has(segment.id));
            for (let retry = 0; retry < 2 && missing().length; retry++) {
                const missingBatches = batchTranslationSegments(missing(), 2200);
                for (let i = 0; i < missingBatches.length; i++) {
                    let batchFull = "";
                    this.setTranslationStatus(status, "正在补全翻译…", true);
                    const r = await this.ai.streamRenderedTemplate(a, prompt, buildSegmentTranslationPrompt(missingBatches[i]), {
                        onChunk: (chunk) => {
                            batchFull += chunk;
                            processBuffer(batchFull, false);
                        },
                        onDone: async (final) => {
                            batchFull = final || batchFull;
                            processBuffer(batchFull, true);
                        },
                        onError: (err) => {
                            status?.classList.add("ar-rd__translate-status--error");
                            this.setTranslationStatus(status, "翻译失败", false);
                            toast("AI 翻译失败：" + err.message, "error", 5000);
                        },
                    });
                    finalResult = r;
                }
            }
            this.updateTranslationProgress(stage, 1);
            status?.classList.add("ar-rd__translate-status--done");
            this.setTranslationStatus(status, "翻译完成", false);
            finalHtml = translatedHtmlFromSource(source);
            finalTitle = translatedTextFromSegment(this.root, 1);
            const remaining = missing().length;
            if (remaining) {
                status?.classList.remove("ar-rd__translate-status--done");
                status?.classList.add("ar-rd__translate-status--error");
                this.setTranslationStatus(status, `仍有 ${remaining} 段未完成，请重试`, false);
                toast(`翻译未完成，还有 ${remaining} 段未返回`, "warn", 5000);
                return;
            }
            if (finalHtml && finalResult) {
                a.aiResults = a.aiResults || {};
                const savedResult = { ...finalResult, content: finalHtml, translatedTitle: finalTitle, translatedComplete: true, durationMs: Date.now() - startedAt };
                a.aiResults[prompt.id] = savedResult;
                await this.storage.setAIResult(a.id, prompt.id, savedResult);
                setTimeout(() => this.render(), 420);
            }
        } catch (e) {
            status?.classList.add("ar-rd__translate-status--error");
            this.setTranslationStatus(status, "翻译失败", false);
        }
    }

    async fetchFullTextFor(a: Article) {
        if (!a.link) return;
        const pending = toast("正在抓取全文…", "info", 0);
        try {
            const html = await fetchFullText(a.link);
            pending.dismiss();
            if (html) {
                const originalText = htmlToPlainText(a.content || a.description || "");
                const fetchedText = htmlToPlainText(html);
                if (fetchedText.length < 120 || (originalText.length >= 120 && fetchedText.length < originalText.length * 0.9)) {
                    toast("抓取到的正文质量太低，已保留原文", "warn", 4000);
                    return;
                }
                a.fullText = html;
                a.fullTextState = "fetched";
                await this.storage.setArticleFullText(a.id, html);
                toast(`全文已抓取（${html.length} 字）`, "success");
                this.render();
            } else {
                toast("抓取失败：可能 CORS / 反爬 / URL 已失效", "error", 4000);
            }
        } catch (e) {
            pending.dismiss();
            toast("抓取失败：" + (e as Error).message, "error", 4000);
        }
    }

    async revertFullText(a: Article) {
        a.fullText = undefined;
        a.fullTextState = undefined;
        await this.storage.setArticleFullText(a.id, null);
        toast("已恢复原文", "info", 1500);
        this.render();
    }
}

function mdToHtml(md: string): string {
    if (!md) return "";
    let h = escapeHtml(md);
    h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`);
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/^###### (.*)$/gm, "<h6>$1</h6>");
    h = h.replace(/^##### (.*)$/gm, "<h5>$1</h5>");
    h = h.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
    h = h.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    h = h.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    h = h.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(^|\W)\*([^*]+)\*/g, "$1<em>$2</em>");
    h = h.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');
    h = h.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");
    h = h.replace(/(^|\n)((?:- [^\n]+\n?)+)/g, (_, p, list) => {
        const items = list.trim().split("\n").map((l: string) => `<li>${l.replace(/^- /, "")}</li>`).join("");
        return `${p}<ul>${items}</ul>`;
    });
    h = h.replace(/(^|\n)((?:\d+\. [^\n]+\n?)+)/g, (_, p, list) => {
        const items = list.trim().split("\n").map((l: string) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("");
        return `${p}<ol>${items}</ol>`;
    });
    h = h.split(/\n{2,}/).map((p) => {
        p = p.trim();
        if (!p) return "";
        if (/^<(h\d|ul|ol|li|blockquote|pre|p|hr|img|table)/.test(p)) return p;
        return `<p>${p.replace(/\n/g, "<br />")}</p>`;
    }).join("\n");
    return h;
}

// =============== 主 Tab ===============

export class RssTab {
    root: HTMLElement;
    storage: Storage;
    ai: AIService;
    private sidebar!: Sidebar;
    private list!: ArticleListView;
    private reader!: Reader;
    private autoRefreshTimer?: number;
    private refreshInterval?: number;
    private refreshDoneTimer?: number;

    constructor(root: HTMLElement, storage: Storage, ai: AIService) {
        this.root = root;
        this.storage = storage;
        this.ai = ai;
        this.root.classList.add("ar-tab");
        this.root.innerHTML = "";
        applyDisplaySettings(this.storage.getSettings());

        const sideEl = el("div", { class: "ar-side" });
        const listEl = el("div", { class: "ar-list" });
        const readerEl = el("div", { class: "ar-rd" });
        this.root.appendChild(sideEl);
        this.root.appendChild(listEl);
        this.root.appendChild(readerEl);

        this.sidebar = new Sidebar(sideEl, storage, (id) => {
            this.list.setActive(id);
            this.list.setActiveArticle(null);
            if (id !== "daily") this.reader.showArticle(null);
        });
        (this.sidebar as any)._ai = ai;  // 注入 ai 给设置
        (this.sidebar as any).onRefresh = (id: string, options?: { silent?: boolean }) => this.refreshOne(id, options);
        const openArticle = (id: string, options: { centerInList?: boolean } = {}) => {
            const article = this.storage.getArticle(id) || null;
            this.reader.showArticle(article);
            if (article && !article.isRead) this.storage.setRead(article.id, true);
            this.list.setActiveArticle(id, { center: options.centerInList });
        };
        const openAdjacentArticle = (currentId: string, direction: "prev" | "next") => {
            const article = this.list.getAdjacentArticle(currentId, direction);
            if (!article) return;
            openArticle(article.id, { centerInList: true });
        };
        const openArticleFromDaily = (id: string) => {
            this.sidebar.setActive("all");
            this.list.setActive("all");
            this.list.setActiveArticle(id);
            this.reader.showArticleFromDaily(id);
        };
        this.list = new ArticleListView(
            listEl,
            storage,
            openArticle,
            (date) => this.reader.showDaily(date),
            (date) => this.reader.generateDailyReport(date),
            () => this.refreshAll(),
            (ids) => this.markCurrentListRead(ids),
        );
        this.reader = new Reader(readerEl, storage, ai, openArticleFromDaily, openAdjacentArticle, (currentId, direction) => this.list.getAdjacentArticle(currentId, direction));

        this.storage.cleanupExpiredArticles();

        // 自动刷新
        const subs = storage.getSubs();
        if (subs.length) this.autoRefreshTimer = window.setTimeout(() => this.refreshAll({ silent: true }), 1500);

        // 定期刷新
        const interval = storage.getSettings().general.autoRefresh;
        if (interval > 0) {
            this.refreshInterval = window.setInterval(() => this.refreshAll({ silent: true }), interval * 60_000);
        }
    }

    destroy() {
        if (this.autoRefreshTimer) window.clearTimeout(this.autoRefreshTimer);
        if (this.refreshInterval) window.clearInterval(this.refreshInterval);
        if (this.refreshDoneTimer) window.clearTimeout(this.refreshDoneTimer);
        this.autoRefreshTimer = undefined;
        this.refreshInterval = undefined;
        this.refreshDoneTimer = undefined;
    }

    private async markCurrentListRead(ids: string[]) {
        if (!ids.length) return;
        await this.storage.markRead(ids, true);
        toast(`已标记 ${ids.length} 篇为已读`, "success", 1600);
    }

    async refreshOne(id: string, options: { silent?: boolean } = {}) {
        const sub = this.storage.getSub(id);
        if (!sub) return;
        await this.doRefresh([sub], { toast: !options.silent });
    }

    async refreshAll(options: { silent?: boolean } = {}) {
        const subs = this.storage.getSubs().filter((s) => s.enabled);
        if (!subs.length) return;
        await this.doRefresh(subs, { toast: !options.silent });
    }

    private async doRefresh(subs: Subscription[], options: { toast?: boolean } = {}) {
        if (this.refreshDoneTimer) window.clearTimeout(this.refreshDoneTimer);
        this.list?.setRefreshStatus("refreshing");
        for (const sub of subs) {
            try {
                const f = await fetchAndParse(sub.url, this.storage.getSettings().general.rsshubBaseUrl);
                if (!this.storage.getSub(sub.id)) continue;
                const articles = f.articles.filter((a) => a.link).map((a) => ({
                    id: articleId(sub.id, a.link),
                    subscriptionId: sub.id,
                    title: a.title, link: a.link, author: a.author,
                    pubDate: a.pubDate, fetchedAt: Date.now(),
                    content: a.content, description: a.description, thumbnail: a.thumbnail,
                }));
                const faviconInfo = await resolveSubscriptionFavicon({
                    feedFavicon: f.favicon,
                    existingFavicon: sub.favicon,
                    existingTriedAt: sub.faviconTriedAt,
                    siteUrl: f.siteUrl || sub.siteUrl || sub.url,
                });
                const faviconPatch: Partial<Subscription> = {
                    siteUrl: f.siteUrl || sub.siteUrl,
                    description: f.description || sub.description,
                    lastFetchAt: Date.now(),
                    lastError: undefined,
                    errorCount: 0,
                };
                if (faviconInfo.favicon || !sub.favicon) {
                    faviconPatch.favicon = faviconInfo.favicon || fallbackFavicon(f.siteUrl || sub.url);
                }
                if (faviconInfo.attempted) {
                    faviconPatch.faviconTriedAt = faviconInfo.triedAt;
                }
                await this.storage.patchSubMeta(sub.id, faviconPatch);
                await this.storage.upsertArticles(articles as any);
            } catch (e) {
                const latest = this.storage.getSub(sub.id);
                if (!latest) continue;
                await this.storage.patchSubMeta(sub.id, {
                    lastFetchAt: Date.now(),
                    lastError: (e as Error).message,
                    errorCount: (latest.errorCount || 0) + 1,
                });
            }
        }
        this.list?.setRefreshStatus("done");
        this.refreshDoneTimer = window.setTimeout(() => {
            this.list?.setRefreshStatus("idle");
            this.refreshDoneTimer = undefined;
        }, 1800);
        if (options.toast !== false) toast("刷新完成", "success", 2000);
    }
}
