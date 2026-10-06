/**
 * AI 日报全量化流水线的纯逻辑（可在 Node 中直接测试）。
 * 两阶段：全景元数据扫描 → 重点文章分批深读 → 模板拼接。
 * 约束：本模块零运行时依赖，不引用 DOM / 网络。
 */

import type { DailyReportMode, DailyReportSettings } from "./types";

export type { DailyReportMode, DailyReportSettings } from "./types";

export const DEFAULT_DAILY_REPORT: Required<DailyReportSettings> = {
    mode: "balanced",
    topN: 30,
    batchSize: 10,
    concurrency: 2,
    showLinks: true,
};

export interface PanoramaArticle {
    id: string;
    title: string;
    source: string;
    category: string;
}

export interface DeepDiveArticle extends PanoramaArticle {
    link: string;
    description: string;
}

export interface PanoramaPrompt {
    prompt: string;
    lineCount: number;
    estimateChars: number;
}

export interface DeepBatchResult {
    articles: { id: string }[];
    markdown: string;
}

export const PANORAMA_MAX_CHARS = 90000;

function normalizeTitle(title: string): string {
    return (title || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 每篇一行紧凑元数据；相同标题去重，返回行数与估算字符数 */
export function buildPanoramaPrompt(date: string, articles: PanoramaArticle[]): PanoramaPrompt {
    const seen = new Set<string>();
    const lines: string[] = [];
    articles.forEach((a, index) => {
        const key = normalizeTitle(a.title);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        lines.push(`编号：${index + 1} | 分类：${a.category || "未分类"} | 来源：${a.source || "未知"} | 标题：${(a.title || "(无标题)").slice(0, 60)}`);
    });
    const prompt = [
        `请基于 ${date} 的 RSS 文章元数据生成中文日报全景速览。`,
        "要求：",
        "1. 按分类归纳当日热点与趋势，给出「今日速览」（3-6 段）。",
        "2. 每个关键判断、趋势或分类总结句后面必须直接标注来源文章编号，例如 [12]、[12][45]；不要把编号集中放到最后。",
        "3. 不要编造文章之外的信息；内容只依据下方编号行。",
        "4. 最后单独输出小节「值得深读的文章编号」，每行一个编号，格式为 `- 12` 或 `12.`，最多 30 个；该小节仅用于内部解析，不会展示给读者。",
        "5. 输出 Markdown，标题层级使用 ## 与 ###。",
        "",
        `（共 ${lines.length} 篇）`,
        lines.join("\n"),
    ].join("\n");
    return { prompt, lineCount: lines.length, estimateChars: prompt.length };
}

/** 从全景输出中剥离“值得深读的文章编号”内部小节，避免最终日报出现裸编号 */
export function stripSelectionSection(text: string): string {
    const lines = (text || "").split("\n");
    const idx = lines.findIndex((l) => l.includes("值得深读"));
    if (idx < 0) return text || "";
    return lines.slice(0, idx).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 移除正文中的 [n] 引用编号（用于关闭今日速览链接时的纯文本输出） */
export function stripCitationMarkers(markdown: string): string {
    return (markdown || "").replace(/\[\d{1,5}\]/g, "");
}

/** 按估算字符切块，保持原顺序且不丢文章 */
export function splitPanoramaArticles(articles: PanoramaArticle[], maxChars = PANORAMA_MAX_CHARS): PanoramaArticle[][] {
    const chunks: PanoramaArticle[][] = [];
    let current: PanoramaArticle[] = [];
    let currentChars = 0;
    for (const a of articles) {
        const line = `编号：1 | 分类：${a.category || "未分类"} | 来源：${a.source || "未知"} | 标题：${(a.title || "").slice(0, 60)}`;
        const chars = line.length + 2;
        if (current.length && currentChars + chars > maxChars) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(a);
        currentChars += chars;
    }
    if (current.length) chunks.push(current);
    return chunks;
}

/** 从全景输出中解析选中编号；忽略元数据行/越界/非编号行；空结果回退为分类均匀抽样 */
export function selectTopArticles(panoramaText: string, articles: PanoramaArticle[], topN: number): PanoramaArticle[] {
    const picked = new Set<number>();
    const tryAdd = (n: number) => {
        if (!Number.isInteger(n) || n < 1 || n > articles.length) return;
        picked.add(n);
    };
    const lines = (panoramaText || "").split("\n");
    const idx = lines.findIndex((l) => l.includes("值得深读"));
    if (idx >= 0) {
        // 优先解析“值得深读”小节：小节标题行内数字 + 后续编号行
        const marker = lines[idx];
        if (/值得深读[：:]\s*\d/.test(marker)) {
            for (const m of marker.match(/\d{1,5}/g) || []) tryAdd(Number(m));
        }
        for (const raw of lines.slice(idx + 1)) {
            for (const m of raw.match(/\d{1,5}/g) || []) tryAdd(Number(m));
            if (picked.size >= topN) break;
        }
    } else {
        // 兼容旧输出：按行锚定解析独立编号行
        const re = /^(?:[-*•]\s*)?\[?(\d{1,5})\]?[.、)）:]?(?:\s|$)/;
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.includes("|") || /^#{1,6}\s/.test(line)) continue;
            const m = line.match(re);
            if (!m) continue;
            tryAdd(Number(m[1]));
            if (picked.size >= topN) break;
        }
    }
    let selected = Array.from(picked).map((n) => articles[n - 1]).filter(Boolean) as PanoramaArticle[];
    if (!selected.length) selected = fallbackSelect(articles, topN);
    return selected.slice(0, topN);
}

/** 确定性回退：按分类轮询均匀抽取 */
export function fallbackSelect(articles: PanoramaArticle[], topN: number): PanoramaArticle[] {
    const byCat = new Map<string, PanoramaArticle[]>();
    articles.forEach((a) => {
        const key = a.category || "未分类";
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key)!.push(a);
    });
    const cats = Array.from(byCat.keys());
    const out: PanoramaArticle[] = [];
    const used = new Set<string>();
    let round = 0;
    while (out.length < topN && round < articles.length) {
        for (const c of cats) {
            const list = byCat.get(c)!;
            if (round < list.length && !used.has(list[round].id)) {
                used.add(list[round].id);
                out.push(list[round]);
                if (out.length >= topN) break;
            }
        }
        round += 1;
    }
    return out;
}

/** 把选中文章按批次大小切分 */
export function buildDeepDiveBatches<T>(selected: T[], batchSize: number): T[][] {
    const size = Math.max(1, Math.floor(batchSize) || 1);
    const out: T[][] = [];
    for (let i = 0; i < selected.length; i += size) out.push(selected.slice(i, i + size));
    return out;
}

/** 单个深读批次的提示词：本地编号 + 标题/链接/摘要 */
export function buildDeepDivePrompt(date: string, batch: DeepDiveArticle[], batchIndex: number): string {
    const lines = batch.map((a, i) => {
        const text = (a.description || "").replace(/\s+/g, " ").trim().slice(0, 320);
        return [
            `编号：${i + 1}`,
            `分类：${a.category || "未分类"}`,
            `来源：${a.source || "未知"}`,
            `标题：${a.title || "(无标题)"}`,
            `链接：${a.link || ""}`,
            `摘要：${text}`,
        ].join("\n");
    }).join("\n\n");
    return [
        `请为 ${date} 的这批重点 RSS 文章（第 ${batchIndex + 1} 批）生成中文摘要。`,
        "要求：",
        "1. 每篇文章给 2-4 句摘要，条目以 `[编号]` 开头（如 `[1]`），随后直接写摘要正文，不要输出“标题：”行。",
        "2. 不要输出与摘要无关的编号列表。",
        "3. 不要编造文章之外的信息。",
        "4. 输出 Markdown（正文内可使用列表/引用）。",
        "",
        lines,
    ].join("\n");
}

/** 把批次内 [n] 引用映射为文章链接 */
export function mapBatchCitations(text: string, batch: ReadonlyArray<{ id: string }>): string {
    return (text || "").replace(/\[(\d{1,5})\]/g, (match, raw: string) => {
        const n = Number(raw);
        const a = batch[n - 1];
        return a ? `[↗︎](article:${a.id})` : match;
    });
}

/** 把全景分块内的 [n] 按本块本地编号映射为文章链接 */
export function mapChunkCitations(text: string, chunk: ReadonlyArray<{ id: string }>): string {
    return mapBatchCitations(text, chunk);
}

/** 把深读批次输出规范化为“### [标题](文章链接) + 正文”，去除裸编号与“标题：”行 */
export function normalizeDeepBatchMarkdown(
    text: string,
    batch: ReadonlyArray<{ id: string; title?: string }>,
): string {
    const src = text || "";
    const entries: { n: number; body: string }[] = [];
    const re = /\[(\d{1,5})\]/g;
    let currentN: number | null = null;
    const bodyParts: string[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const flush = () => {
        if (currentN !== null) entries.push({ n: currentN, body: bodyParts.join("") });
        bodyParts.length = 0;
    };
    while ((m = re.exec(src)) !== null) {
        const between = src.slice(last, m.index);
        if (currentN !== null) bodyParts.push(between);
        flush();
        currentN = Number(m[1]);
        last = m.index + m[0].length;
    }
    if (currentN !== null) bodyParts.push(src.slice(last));
    flush();
    if (!entries.length) return src.trim();
    const out: string[] = [];
    for (const { n, body } of entries) {
        const a = batch[n - 1];
        if (!a) continue;
        const clean = body
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !/^(编号|标题)\s*[：:]/.test(l))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n");
        out.push(`### [${a.title || `文章 ${n}`}](article:${a.id})` + (clean ? `\n\n${clean}` : ""));
    }
    return out.join("\n\n");
}

/** 模板拼接最终日报，不追加模型调用 */
export function composeFinalReport(
    panorama: string,
    deepBatches: DeepBatchResult[],
    opts: { skipped?: string[] } = {},
): string {
    const parts: string[] = [];
    if (panorama?.trim()) {
        const panoramaBody = panorama
            .trim()
            .replace(/^#{1,6}\s*今日速览[：: 　]*.*$/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        if (panoramaBody) parts.push(`## 今日速览\n\n${panoramaBody}`);
    }
    const body = deepBatches
        .map((b) => b.markdown.trim())
        .filter(Boolean)
        .join("\n\n");
    if (body) parts.push(`## 重点文章摘要\n\n${body}`);
    const skipped = opts.skipped?.filter(Boolean) || [];
    if (skipped.length) parts.push(`> 提示：${skipped.length} 篇文章深读失败已跳过。`);
    return parts.join("\n\n");
}

/** 文章集合的稳定哈希（与顺序无关） */
export function articleSetHash(articles: { id: string }[]): string {
    const ids = articles.map((a) => a.id).sort();
    let h = 5381;
    for (const id of ids) {
        for (let i = 0; i < id.length; i++) {
            h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
        }
        h = ((h << 5) + h + 1) >>> 0;
    }
    return h.toString(16);
}

/** 受限并发执行，结果按输入顺序返回 */
export async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const runner = async () => {
        for (;;) {
            const i = next;
            next += 1;
            if (i >= items.length) return;
            results[i] = await worker(items[i], i);
        }
    };
    const workers = Array.from(
        { length: Math.max(1, Math.min(limit, items.length)) },
        () => runner(),
    );
    await Promise.all(workers);
    return results;
}
