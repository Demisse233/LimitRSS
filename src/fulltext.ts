/**
 * 全文抓取：通过 article.link 抓取原文页面，用 readability 提取正文
 * 用于 RSS 源只提供摘要的情况
 */

import { Article } from "./types";
import { prepareForDisplay } from "./sanitizer";
import { logger } from "./logger";

const MIN_CONTENT_LENGTH = 1500;  // RSS 内容 < 此值视为摘要，触发抓全文
const TIMEOUT = 30_000;
const MIN_FULLTEXT_TEXT_LENGTH = 120;

function plainTextLength(html: string): number {
    return (html || "").replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .length;
}

/** 检测内容是否像摘要 */
export function isProbablySummary(article: Article): boolean {
    const text = (article.content || "").replace(/<[^>]+>/g, "").trim();
    if (text.length < MIN_CONTENT_LENGTH) return true;
    if (/查看全文|Read more|阅读全文|read full/i.test(article.content || "")) return true;
    return false;
}

/** 抓取并提取全文 */
export async function fetchFullText(url: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT);
        let referer = "";
        try { referer = new URL(url).origin + "/"; } catch { /* */ }
        const resp = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Referer": referer,
            },
        });
        clearTimeout(timer);
        if (!resp.ok) {
            logger.warn(`fetchFullText ${url}: HTTP ${resp.status}`);
            return null;
        }
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const stripSelectors = [
            "script", "style", "noscript", "iframe",
            "nav", ".nav", ".navigation", ".menu",
            "header", ".header", ".site-header", "footer", ".footer", ".site-footer",
            ".sidebar", "#sidebar", ".aside", "aside",
            ".advertisement", ".ad", ".ads", ".adsbygoogle",
            ".share", ".social", ".social-share",
            ".related", ".recommended", ".comments", "#comments",
            ".newsletter", ".subscribe", ".popup",
            "[role='navigation']", "[role='banner']", "[aria-hidden='true']",
        ];
        stripSelectors.forEach((sel) => {
            try { doc.querySelectorAll(sel).forEach((el) => el.remove()); } catch { /* */ }
        });

        // 候选容器
        const candidates: Element[] = [];
        doc.querySelectorAll("article, main, [role='main'], .article, .article-content, .article-body, .post, .post-content, .entry, .entry-content, .content, .post-body, .story, .story-body, .article__body, .article__content, [itemprop='articleBody'], .post__content, .content-body").forEach((el) => candidates.push(el));

        let best: Element | null = null;
        let bestScore = 0;
        const scoreText = (el: Element) => {
            const text = (el.textContent || "").trim();
            if (text.length < 200) return 0;
            let s = Math.min(text.length / 100, 30);
            s += el.querySelectorAll("p").length * 3;
            const linkText = Array.from(el.querySelectorAll("a")).reduce((a, x) => a + (x.textContent || "").length, 0);
            if (text.length > 0 && linkText / text.length > 0.5) s -= 10;
            return s;
        };
        candidates.forEach((el) => {
            const s = scoreText(el);
            if (s > bestScore) { best = el; bestScore = s; }
        });

        if (!best || bestScore < 10) {
            const ps = Array.from(doc.querySelectorAll("p"));
            if (ps.length > 0) {
                const counts = new Map<Element, number>();
                ps.forEach((p) => {
                    let n: Element | null = p.parentElement;
                    while (n && n !== doc.body) {
                        counts.set(n, (counts.get(n) || 0) + 1);
                        n = n.parentElement;
                    }
                });
                let topEl: Element | null = null, topCount = 0;
                counts.forEach((c, e) => { if (c > topCount) { topCount = c; topEl = e; } });
                if (topEl && topCount >= 3) best = topEl;
            }
        }

        if (!best) best = doc.body;

        let html2 = best.innerHTML;
        html2 = html2.replace(/<p>\s*<\/p>/g, "").replace(/<br\s*\/?>\s*<br\s*\/?>/g, "<br />");
        try {
            const base = new URL(url);
            html2 = html2.replace(/(href|src)="\/([^"]*?)"/g, (_, attr, p) => `${attr}="${base.origin}/${p}"`);
        } catch { /* */ }

        const clean = prepareForDisplay(html2);
        if (plainTextLength(clean) < MIN_FULLTEXT_TEXT_LENGTH) {
            logger.warn(`fetchFullText ${url}: extracted content too short`);
            return null;
        }
        console.info("[ai-rss] fulltext fetched:", url, clean.length, "chars");
        return clean;
    } catch (e) {
        console.warn("[ai-rss] fulltext failed:", url, (e as Error).message);
        return null;
    }
}

/** 批量抓全文 */
export async function fetchFullTexts(articles: Article[], onUpdate: (a: Article, html: string) => void, concurrency = 3): Promise<void> {
    const queue = articles.filter((a) => a.link && !a.fullText && isProbablySummary(a));
    console.info("[ai-rss] fulltext: queued", queue.length, "articles");
    let running = 0;
    let idx = 0;
    return new Promise((resolve) => {
        const next = () => {
            if (idx >= queue.length && running === 0) {
                resolve();
                return;
            }
            while (running < concurrency && idx < queue.length) {
                const a = queue[idx++];
                running++;
                fetchFullText(a.link!).then((html) => {
                    if (html && html.length > (a.content?.length || 0)) {
                        onUpdate(a, html);
                    }
                }).catch(() => { /* ignore */ }).finally(() => {
                    running--;
                    next();
                });
            }
        };
        next();
    });
}
