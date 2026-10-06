/**
 * Markdown 链接清理的纯逻辑（可在 Node 中直接测试）。
 */

/** 清理 Markdown/HTML 链接并保留标签文本；keepUrl 指定的链接原样保留 */
export function cleanMarkdownLinks(markdown: string, opts: { keepUrl?: string } = {}): string {
    const keep = opts.keepUrl;
    const KEEP = "\u0000AR_KEEP_LINK\u0000";
    let out = markdown || "";
    if (keep) out = out.split(keep).join(KEEP);
    out = out
        .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, (m: string, label: string, url: string) => {
            if (m.startsWith("!")) return m; // 图片语法保留
            return url.includes(KEEP) ? m : label;
        })
        .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (m: string, inner: string) => {
            return m.includes(KEEP) ? m : inner;
        });
    if (keep) out = out.split(KEEP).join(keep);
    return out;
}

/** 移除全部链接与 ↗ 箭头标记，用于日报导出为纯文本 */
export function stripMarkdownLinks(markdown: string): string {
    return cleanMarkdownLinks(markdown).replace(/[↗︎↗]/g, "");
}

/** 去除开头的插件 YAML frontmatter（含 custom-ai-rss- 键） */
export function stripPluginFrontmatter(markdown: string): string {
    const src = markdown || "";
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return src;
    if (!m[1].includes("custom-ai-rss-")) return src;
    return src.slice(m[0].length).replace(/^\s*\n/, "");
}
