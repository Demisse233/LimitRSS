/**
 * 网络抓取 + RSS/Atom 解析
 */

const USER_AGENT = "Mozilla/5.0 (compatible; SiYuan-AI-RSS/0.1)";
const DEFAULT_RSSHUB_BASE_URL = "https://rsshub.app";

export const BUILTIN_RSSHUB_INSTANCES = [
    { name: "RSSHub 官方", url: "https://rsshub.app" },
    { name: "YFI 公共实例", url: "https://rsshub.yfi.moe" },
    { name: "Bling 公共实例", url: "https://rsshub.bling.moe" },
    { name: "Nyan 公共实例", url: "https://rsshub.nyan.im" },
] as const;

export function normalizeRSSHubBaseUrl(value: string): string {
    return (value || "").trim().replace(/\/+$/, "");
}

export function listRSSHubInstances(current = "", custom: string[] = []): { name: string; url: string; builtin: boolean }[] {
    const builtinUrls = new Set<string>(BUILTIN_RSSHUB_INSTANCES.map((item) => item.url));
    const normalizedCustom = [current, ...custom].map(normalizeRSSHubBaseUrl)
        .filter((url) => /^https?:\/\//i.test(url) && !builtinUrls.has(url));
    return [
        ...BUILTIN_RSSHUB_INSTANCES.map((item) => ({ ...item, builtin: true })),
        ...Array.from(new Set(normalizedCustom)).map((url) => ({ name: "自定义实例", url, builtin: false })),
    ];
}

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

function responseError(url: string, status?: number, body = ""): Error {
    const code = status ? `HTTP ${status}` : "";
    const text = body.trim();
    const isHtml = /^\s*(?:<!doctype\s+html|<html\b)/i.test(text);

    if (status === 401 || status === 403) {
        const target = /^https?:\/\/rsshub\.app(?:\/|$)/i.test(url) ? "RSSHub 官方测试实例" : "RSSHub 实例";
        return new Error(`${target}拒绝访问（${code}），请在设置中更换或自建 RSSHub 实例`);
    }
    if (status && status >= 400) {
        return new Error(`RSSHub 实例请求失败（${code}）`);
    }
    if (isHtml) {
        return new Error("RSSHub 实例返回了 HTML 页面而不是 RSS XML，可能被验证页或反爬机制拦截");
    }
    return new Error("RSSHub 实例返回的内容不是有效的 RSS / Atom XML");
}

function ensureFeedResponse(url: string, body: unknown, status?: number): string {
    const text = typeof body === "string" ? body : "";
    if (status && (status < 200 || status >= 300)) throw responseError(url, status, text);
    if (!text.trim()) throw new Error("RSSHub 实例返回了空内容");

    const normalized = text.replace(/^\uFEFF/, "").trimStart();
    if (!/^<\?xml\b/i.test(normalized)
        && !/^<(?:rss|feed|rdf:RDF)\b/i.test(normalized)) {
        throw responseError(url, status, text);
    }
    return text;
}

/**
 * Folo and RSSHub-aware readers use rsshub:// as a portable route URL.
 * Keep that value in storage, and resolve it only when making a request.
 */
export function resolveFeedUrl(input: string, rsshubBaseUrl = DEFAULT_RSSHUB_BASE_URL): string {
    const url = (input || "").trim();
    if (!/^rsshub:\/\//i.test(url)) return url;

    const route = url.replace(/^rsshub:\/\/+?/i, "").replace(/^\/+/, "");
    if (!route) throw new Error("RSSHub 路由不能为空");

    const base = normalizeRSSHubBaseUrl(rsshubBaseUrl || DEFAULT_RSSHUB_BASE_URL);
    if (!/^https?:\/\//i.test(base)) throw new Error("RSSHub 实例地址必须以 http:// 或 https:// 开头");
    return `${base}/${route}`;
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
        const text = await r.text();
        if (r.ok) return ensureFeedResponse(url, text, r.status);
    } catch (e) { /* fall through */ }
    // 兜底：思源内核 forwardProxy
    try {
        const siyuan = (window as any).siyuan;
        if (siyuan?.api?.forwardProxy) {
            const r = await siyuan.api.forwardProxy(url, { method: "GET", timeout: 30000 });
            if (r?.body || r?.status) return ensureFeedResponse(url, r.body, Number(r.status) || undefined);
        }
        // 用 fetchSyncPost
        const { fetchSyncPost } = await import("siyuan");
        const r: any = await fetchSyncPost("/api/network/forwardProxy", {
            url, method: "GET", timeout: 30000,
            headers: { "User-Agent": USER_AGENT },
        });
        if (r.code === 0 && (r.data?.body || r.data?.status)) {
            return ensureFeedResponse(url, r.data.body, Number(r.data.status) || undefined);
        }
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

export async function fetchAndParse(url: string, rsshubBaseUrl?: string): Promise<ParsedFeed> {
    const requestUrl = resolveFeedUrl(url, rsshubBaseUrl);
    const xml = await fetchXML(requestUrl);
    return parseXML(xml, requestUrl);
}

// =============== 站点 favicon 兜底 ===============

/** 距离上次尝试超过此值才重新尝试抓站点 favicon，避免每次刷新都打主页 */
export const FAVICON_BACKOFF_MS = 7 * 86400 * 1000;

interface FaviconResolveOpts {
    /** 这次 fetchAndParse 在 feed 里读到的 favicon（最高优先级） */
    feedFavicon?: string;
    /** 库里之前保存过的 favicon（次高优先级） */
    existingFavicon?: string;
    /** 库里上次尝试站点 favicon 的时间戳 */
    existingTriedAt?: number;
    /** 站点主域 URL，用于拉首页 HTML */
    siteUrl?: string;
    /** 新订阅路径，加订阅瞬间就需要抓，跳过 7 天退避 */
    always?: boolean;
}

/**
 * 综合考虑：
 *   1. feed 自报 → 用 Range GET 探一下，确认是合法图片（2xx + image/*）
 *      否则视为无效，让下一步补救
 *   2. 库内已存的（且不等于 feed 自报的）→ 直接信任
 *   3. 7 天退避后从站点首页抓
 *
 * 返回的 `triedAt` 是本次"做过的网络动作"的时间戳，方便调用方只 patch 这个字段。
 * `attempted: true` 表示这次跑了 Range 探活 或 HTML 抓取，对应回写 `faviconTriedAt`。
 */
export async function resolveSubscriptionFavicon(opts: FaviconResolveOpts): Promise<{ favicon?: string; triedAt: number; attempted: boolean }> {
    const now = Date.now();
    if (opts.feedFavicon) {
        const ok = await probeImageUrl(opts.feedFavicon);
        if (ok) return { favicon: opts.feedFavicon, triedAt: now, attempted: true };
        // 探测失败 → 必须强制 HTML scrape 自愈，不能被 7 天退避卡住（否则用户刷新后图标消失，需要手动删除重加才能修）
    }
    if (opts.existingFavicon && opts.existingFavicon !== opts.feedFavicon) {
        return { favicon: opts.existingFavicon, triedAt: opts.existingTriedAt || now, attempted: false };
    }
    const sinceLast = now - (opts.existingTriedAt || 0);
    if (!opts.always && opts.existingTriedAt && sinceLast < FAVICON_BACKOFF_MS && !opts.feedFavicon) {
        // 退避仅当没探测过 feedFavicon 时生效；探测失败时强制走 HTML scrape
        return { triedAt: opts.existingTriedAt, attempted: false };
    }
    if (!opts.siteUrl) return { triedAt: now, attempted: false };
    const found = await fetchSiteFavicon(opts.siteUrl);
    return { favicon: found, triedAt: now, attempted: true };
}

/**
 * 用 Range GET 探一下 URL 是否真的能返回合法图片：
 *   - status 2xx 或 206
 *   - Content-Type 以 image/ 开头
 * 网络层沿用浏览器 fetch → siyuan forwardProxy 的双路径，避免 CORS / 反爬死锁。
 * 浏览器会缓存 Range 响应，二次探活的实际成本接近 0。
 */
async function probeImageUrl(url: string): Promise<boolean> {
    if (!url) return false;
    // 浏览器 fetch
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const r = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            headers: {
                "Range": "bytes=0-1023",
                "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.1",
            },
        });
        clearTimeout(timer);
        if (r.ok || r.status === 206) {
            const ct = (r.headers.get("content-type") || "").toLowerCase();
            if (!/^image\//.test(ct)) return false;  // Content-Type 不是图片，先否决
            const buf = new Uint8Array(await r.arrayBuffer());
            if (!looksLikeImage(buf)) return false;  // 但凡 magic byte 不对，也否决
            return true;
        }
    } catch { /* 走下方 forwardProxy 兜底 */ }
    // 思源内核 forwardProxy 兜底
    try {
        const { fetchSyncPost } = await import("siyuan");
        const r: any = await fetchSyncPost("/api/network/forwardProxy", {
            url, method: "GET", timeout: 10_000,
            headers: { Range: "bytes=0-1023" },
        });
        if (r?.code === 0 && r?.data) {
            const status = Number(r.data.status) || 0;
            if (status >= 200 && status < 400) {
                const ct = (r.data.headers?.["content-type"] || r.data.headers?.["Content-Type"] || "").toLowerCase();
                if (!/^image\//.test(ct)) return false;
                // forwardProxy body 是 string，可能是 base64 或原始二进制串
                // 我们只看前几个字节；如果 content-length 已知且 body 长度合理
                const body = r.data.body;
                if (typeof body !== "string" || body.length < 4) return false;
                return looksLikeImage(new TextEncoder().encode(body.slice(0, 32)));
            }
        }
    } catch { /* ignore */ }
    return false;
}

/** 通过 magic bytes 判断一段字节流是不是合法图片 */
function looksLikeImage(buf: Uint8Array): boolean {
    if (!buf || buf.length < 4) return false;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
    // GIF87a / GIF89a: 47 49 46 38 [37|39] 61
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
        (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return true;
    // WebP: RIFF....WEBP (头 4 字节 RIFF, 8-11 字节 WEBP)
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
    // ICO: 00 00 01 00
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return true;
    // AVIF / HEIC: 没特定 magic，以 ftyp 开头也行
    // SVG: '<svg' 或 '<?xml'
    if (buf[0] === 0x3C) {
        const head = new TextDecoder().decode(buf.slice(0, Math.min(buf.length, 32))).toLowerCase();
        if (head.startsWith("<svg") || head.startsWith("<?xml")) return true;
    }
    return false;
}

/**
 * 抓站点首页 HTML，从 `<link rel="icon">` 系列标签里挑出最合适的图标；
 * 抓不到 HTML 或 HTML 里没有 icon 标签时，兜底返回 `${origin}/favicon.ico`。
 * 这里**不做**网络文件读取——只返回 URL，是否能 200 由 UI 的 `<img>` 处理。
 */
export async function fetchSiteFavicon(siteUrl: string): Promise<string | undefined> {
    if (!siteUrl) return undefined;
    let origin = "";
    try {
        const u = new URL(siteUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
        origin = u.origin;
    } catch { return undefined; }

    const html = await fetchSiteHomeHtml(origin + "/");
    if (html) {
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const picked = pickIconFromHtml(doc, origin + "/");
            if (picked) return picked;
        } catch { /* fall through */ }
    }
    // 兜底：直接走 /favicon.ico 的 URL；能不能 200 由 `<img>` 处理
    return `${origin}/favicon.ico`;
}

async function fetchSiteHomeHtml(homeUrl: string): Promise<string | undefined> {
    // 浏览器 fetch（5 秒超时，多数 favicon 链接查得很快）
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const r = await fetch(homeUrl, {
            method: "GET",
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
        });
        clearTimeout(timer);
        if (r.ok) {
            const ct = r.headers.get("content-type") || "";
            if (ct.includes("text/html") || ct.includes("application/xhtml")) {
                return await r.text();
            }
        }
    } catch { /* fall through to proxy */ }
    // 思源内核 forwardProxy 兜底（解决 CORS / 反爬拦截）
    try {
        const { fetchSyncPost } = await import("siyuan");
        const r: any = await fetchSyncPost("/api/network/forwardProxy", {
            url: homeUrl, method: "GET", timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SiYuan-AI-RSS/0.1)" },
        });
        if (r?.code === 0 && r?.data?.body) {
            const status = Number(r.data.status) || 0;
            const ct = (r.data.headers?.["content-type"] || r.data.headers?.["Content-Type"] || "").toLowerCase();
            if (status >= 200 && status < 400 && (ct.includes("text/html") || ct.includes("application/xhtml"))) {
                return r.data.body as string;
            }
        }
    } catch { /* ignore */ }
    return undefined;
}

function pickIconFromHtml(doc: Document, baseUrl: string): string | undefined {
    const links = Array.from(doc.querySelectorAll('link[rel]'));
    type Cand = { href: string; pri: number };
    const cands: Cand[] = [];
    for (const l of links) {
        const href = l.getAttribute("href");
        if (!href) continue;
        const rel = (l.getAttribute("rel") || "").toLowerCase();
        if (!rel.includes("icon") && !rel.includes("mask-icon")) continue;
        let pri = 0;
        if (rel.includes("apple-touch-icon-precomposed")) pri = 5;
        else if (rel.includes("apple-touch-icon")) pri = 4;
        else if (rel.includes("mask-icon")) pri = 3;
        else if (rel.includes("shortcut")) pri = 2;
        else if (rel.includes("icon")) pri = 1;
        const sizes = (l.getAttribute("sizes") || "").toLowerCase();
        if (sizes && !sizes.includes("any")) {
            const m = sizes.match(/(\d+)\s*x\s*(\d+)/);
            if (m) {
                const max = Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
                if (max >= 180) pri += 2;
                else if (max >= 64) pri += 1;
            }
        } else if (sizes.includes("any")) {
            pri += 1;
        }
        cands.push({ href, pri });
    }
    if (!cands.length) return undefined;
    cands.sort((a, b) => b.pri - a.pri);
    return resolveUrl(cands[0].href, baseUrl);
}
