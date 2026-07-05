/**
 * 网络抓取 + RSS/Atom 解析
 */

const USER_AGENT = "Mozilla/5.0 (compatible; SiYuan-AI-RSS/0.1)";

export interface ParsedFeed {
    title: string;
    siteUrl?: string;
    description?: string;
    favicon?: string;
    articles: ParsedArticle[];
}

export interface ParsedArticle {
    title: string;
    link: string;
    author?: string;
    pubDate: number;
    content: string;
    description: string;
    thumbnail?: string;
}

export async function fetchXML(url: string): Promise<string> {
    // 优先浏览器 fetch
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const r = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            headers: { "User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        });
        clearTimeout(timer);
        if (r.ok) {
            const text = await r.text();
            if (text && text.trim()) return text;
        }
    } catch (e) { /* fall through */ }
    // 兜底：思源内核 forwardProxy
    try {
        const siyuan = (window as any).siyuan;
        if (siyuan?.api?.forwardProxy) {
            const r = await siyuan.api.forwardProxy(url, { method: "GET", timeout: 30000 });
            if (r?.body) return r.body;
        }
        // 用 fetchSyncPost
        const { fetchSyncPost } = await import("siyuan");
        const r: any = await fetchSyncPost("/api/network/forwardProxy", {
            url, method: "GET", timeout: 30000,
            headers: { "User-Agent": USER_AGENT },
        });
        if (r.code === 0 && r.data?.body) return r.data.body;
        throw new Error(r.msg || "empty body");
    } catch (e) {
        throw new Error("Failed to fetch " + url + ": " + (e as Error).message);
    }
}

function getText(el: Element | null): string { return el ? (el.textContent || "").trim() : ""; }
function getAttr(el: Element | null, n: string): string { return el ? (el.getAttribute(n) || "") : ""; }
function parseDate(s: string): number { if (!s) return Date.now(); const t = Date.parse(s); return isNaN(t) ? Date.now() : t; }

function resolveUrl(u: string, base: string): string {
    if (!u) return "";
    try { return new URL(u, base).href; } catch { return u; }
}

function extractContent(parent: Element): { content: string; description: string; thumbnail?: string } {
    let html = "";
    for (const c of Array.from(parent.children)) {
        const tag = c.tagName.toLowerCase();
        if (tag === "content" || tag.endsWith(":encoded") || tag === "encoded") {
            const raw = c.textContent || "";
            if (raw.length > html.length) html = raw;
        }
    }
    const descEl = parent.querySelector("description") || parent.querySelector("summary");
    const description = descEl ? (descEl.textContent || "") : "";
    if (!html) html = description;
    let thumbnail: string | undefined;
    const med = parent.querySelector("enclosure") || parent.querySelector("media\\:content") || parent.querySelector("media\\:thumbnail");
    if (med) {
        const u = getAttr(med, "url");
        if (u) thumbnail = u;
    }
    if (!thumbnail && html) {
        const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) thumbnail = m[1];
    }
    return { content: html, description, thumbnail };
}

function parseRSS(doc: Document): ParsedArticle[] {
    return Array.from(doc.querySelectorAll("item")).map((it) => {
        const title = getText(it.querySelector("title")) || "(无标题)";
        const link = getText(it.querySelector("link")) || "";
        const author = getText(it.querySelector("author")) || getText(it.querySelector("dc\\:creator")) || undefined;
        const pubDate = parseDate(getText(it.querySelector("pubDate")) || getText(it.querySelector("dc\\:date")));
        const { content, description, thumbnail } = extractContent(it);
        return { title, link, author, pubDate, content, description, thumbnail };
    });
}

function parseAtom(doc: Document): ParsedArticle[] {
    return Array.from(doc.querySelectorAll("entry")).map((e) => {
        const title = getText(e.querySelector("title")) || "(无标题)";
        let link = "";
        e.querySelectorAll("link").forEach((l) => {
            const rel = getAttr(l, "rel");
            const href = getAttr(l, "href");
            if (!link || rel === "alternate" || rel === "") if (href) link = href;
        });
        const author = getText(e.querySelector("author > name")) || undefined;
        const pubDate = parseDate(getText(e.querySelector("published")) || getText(e.querySelector("updated")));
        const { content, description, thumbnail } = extractContent(e);
        return { title, link, author, pubDate, content, description, thumbnail };
    });
}

export function parseXML(xml: string, sourceUrl: string): ParsedFeed {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML 解析失败");
    const root = doc.documentElement;
    const isAtom = root.tagName.toLowerCase() === "feed";
    let title = "", siteUrl = "", description = "", favicon = "";
    if (isAtom) {
        title = getText(root.querySelector("title"));
        const linkEl = Array.from(root.querySelectorAll("link")).find((l) => getAttr(l, "rel") === "alternate");
        siteUrl = linkEl ? getAttr(linkEl, "href") : "";
        description = getText(root.querySelector("subtitle"));
        favicon = getText(root.querySelector("logo")) || getText(root.querySelector("icon"));
    } else {
        const ch = root.querySelector("channel") || root;
        title = getText(ch.querySelector("title"));
        siteUrl = getText(ch.querySelector("link"));
        description = getText(ch.querySelector("description"));
        favicon = getText(ch.querySelector("image > url"));
    }
    if (!title) title = sourceUrl;
    if (favicon) favicon = resolveUrl(favicon, siteUrl || sourceUrl);
    const articles = isAtom ? parseAtom(doc) : parseRSS(doc);
    return { title, siteUrl: siteUrl || sourceUrl, description, favicon, articles };
}

export async function fetchAndParse(url: string): Promise<ParsedFeed> {
    const xml = await fetchXML(url);
    return parseXML(xml, url);
}
