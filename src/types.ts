// 核心类型
import { DEFAULT_DAILY_REPORT } from "./dailyReportCore";

export type ID = string;
export type Timestamp = number;

export type DailyReportMode = "fast" | "balanced" | "comprehensive";

export interface DailyReportSettings {
    mode?: DailyReportMode;
    topN?: number;
    batchSize?: number;
    concurrency?: number;
    /** 今日速览是否显示文章链接（默认 true） */
    showLinks?: boolean;
}

export interface Category {
    id: ID; name: string; color?: string;
    sortOrder: number; collapsed: boolean; builtin?: boolean;
}

export interface Subscription {
    id: ID; url: string; name: string; categoryId?: ID; categoryName?: string;
    siteUrl?: string; description?: string; favicon?: string;
    /** 用户手动设置的图标（图片 URL / dataURL / emoji），优先级高于自动抓取 */
    customFavicon?: string;
    /** 上次尝试自动抓站点 favicon 的时间戳，用于 7 天退避 */
    faviconTriedAt?: number;
    enabled: boolean; errorCount: number; sortOrder: number;
    lastFetchAt?: number; lastError?: string;
    createdAt: number; updatedAt: number;
}

export interface Article {
    id: ID; subscriptionId: ID; title: string; link: string;
    author?: string; pubDate: number; fetchedAt: number;
    content: string; description: string; thumbnail?: string;
    isRead: boolean; isStarred: boolean;
    savedDocId?: ID; savedAt?: number;
    tags?: string[];
    aiResults?: Record<string, AIResult>;
    highlights?: Highlight[];
    /** 抓取的全文（RSS 仅摘要时） */
    fullText?: string;
    fullTextState?: "pending" | "fetched" | "failed";
}

export interface Highlight {
    id: ID; text: string; note?: string; color: string; createdAt: number;
}

export interface AIResult {
    promptId: ID; promptName: string; content: string;
    model: string; providerId: ID;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    generatedAt: number; durationMs: number; streamed?: boolean;
}

/** AI 日报缓存（按日期） */
export interface DailyReportCache {
    markdown: string;
    articleIds: string[];
    generatedAt: number;
    providerId?: string;
    model?: string;
    /** 生成时选定的订阅源范围：[] 或缺失 = 全部，元素 cat:xxx / sub:xxx */
    scope?: string[];
    /** 两阶段日报：覆盖模式 */
    mode?: DailyReportMode;
    /** 文章集合哈希，用于组件缓存命中判断 */
    articleHash?: string;
    /** 阶段一全景速览文本 */
    panorama?: string;
    /** 阶段二选中的重点文章 ID */
    selectedIds?: string[];
    /** 单篇深读结果缓存 */
    deepDives?: Record<string, string>;
    /** 生成时今日速览是否显示链接 */
    showLinks?: boolean;
    /** 缓存结构版本 */
    version?: number;
}

export type AIProviderType = "openai" | "anthropic" | "deepseek" | "zhipu" | "groq" | "ollama" | "custom";

export interface AIProvider {
    id: ID; type: AIProviderType; name: string;
    apiKey?: string; endpoint?: string; model: string;
    temperature?: number; maxTokens?: number; enabled: boolean;
}

export interface PromptTemplate {
    id: ID; name: string; description?: string;
    systemPrompt?: string; userPrompt: string;
    builtin: boolean; icon?: string; order: number;
    outputFormat?: "markdown" | "text" | "json" | "mermaid";
}

export interface AISettings {
    providers: AIProvider[];
    defaultProviderId?: ID;
    prompts: PromptTemplate[];
    enableCache: boolean;
    stream: boolean;
    /** AI 日报两阶段生成配置 */
    daily?: DailyReportSettings;
}

export interface Settings {
    general: { language: string; articlesPerPage: number; autoRefresh: number; fullText?: boolean; articleRetentionDays: number; rsshubBaseUrl: string; rsshubCustomInstances?: string[]; entryPosition?: "topbar-right" | "topbar-left" | "dock-left-top" | "dock-right-top" | "hidden"; };
    display: { fontSize: number; lineHeight: number; theme: string; };
    reading: { fadeReadArticles: boolean; boundaryScrollSwitch: boolean; boundaryConfirmDelayMs: number; boundaryCooldownMs: number; boundaryTriggerDistance: number; selection?: { copy?: boolean; translate?: boolean; search?: boolean; customUrl?: string; }; };
    save: { template: string; includeSourceLink: boolean; downloadImages: boolean; cleanLinks?: boolean; defaultNotebook?: string; folderTemplate?: string; pathsByNotebook?: Record<string, string>; };
}

// 持久化 key
export const KEYS = {
    subs: "ai_rss_subs",
    cats: "ai_rss_cats",
    articles: "ai_rss_articles",
    read: "ai_rss_read",
    star: "ai_rss_star",
    settings: "ai_rss_settings",
    ai: "ai_rss_ai",
    dailyReports: "ai_rss_daily_reports",
} as const;

// 默认值
export const DEFAULT_PROMPTS: PromptTemplate[] = [
    {
        id: "quick_summary_paragraph", name: "AI 总结", icon: "list", order: 1, builtin: true, outputFormat: "markdown",
        systemPrompt: "你是简洁准确的中文阅读助手。",
        userPrompt: "请阅读下面文章，用简体中文总结成一段自然流畅的话。要求：100-200 字，不要分点，不要标题，不要使用 Markdown 列表。\n\n标题：{{title}}\n作者：{{author}}\n\n{{content}}",
    },
    {
        id: "quick_translate", name: "AI 翻译", icon: "translate", order: 2, builtin: true, outputFormat: "markdown",
        systemPrompt: "你是专业中文译者。保留链接、人名、产品名、代码和专有名词的原文或通用译法。",
        userPrompt: "请把下面文章翻译为简体中文，尽量保留原文段落结构，不添加额外评论。\n\n标题：{{title}}\n作者：{{author}}\n\n{{content}}",
    },
    {
        id: "quick_daily_report", name: "AI 日报", icon: "article", order: 3, builtin: true, outputFormat: "markdown",
        systemPrompt: "你是专业资讯编辑，擅长把 RSS 文章整理成简洁日报。",
        userPrompt: "{{content}}",
    },
];

export const DEFAULT_SETTINGS: Settings = {
    general: { language: "auto", articlesPerPage: 30, autoRefresh: 30, fullText: true, articleRetentionDays: 7, rsshubBaseUrl: "https://rsshub.app" },
    display: { fontSize: 15, lineHeight: 1.7, theme: "auto" },
    reading: { fadeReadArticles: true, boundaryScrollSwitch: true, boundaryConfirmDelayMs: 120, boundaryCooldownMs: 700, boundaryTriggerDistance: 95 },
    save: {
        template: "# {{title}}\n\n> {{source}} · {{date}} · [原文]({{link}})\n\n{{content}}",
        includeSourceLink: true, downloadImages: true,
        cleanLinks: true,
        defaultNotebook: "", folderTemplate: "",
    },
};

export const DEFAULT_AI: AISettings = {
    providers: [
        { id: "p_generic", type: "custom", name: "通用 AI", endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini", temperature: 0.7, maxTokens: 2048, enabled: false },
    ],
    prompts: DEFAULT_PROMPTS,
    enableCache: true,
    stream: true,
    daily: { ...DEFAULT_DAILY_REPORT },
};

// 精选订阅源（原创）
export const FEATURED = [
    { name: "少数派", url: "https://sspai.com/feed", category: "tech" },
    { name: "云风的 BLOG", url: "https://blog.codingnow.com/atom.xml", category: "tech" },
    { name: "陈皓", url: "https://coolshell.cn/feed", category: "tech" },
    { name: "IT 之家", url: "https://www.ithome.com/rss/", category: "tech" },
    { name: "LWN.net", url: "https://lwn.net/headlines/rss", category: "tech" },
    { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "tech" },
    { name: "Slashdot", url: "https://rss.slashdot.org/Slashdot/slashdot", category: "tech" },
    { name: "Hacker News 最佳", url: "https://hnrss.org/best", category: "tech" },
    { name: "Wait But Why", url: "https://waitbutwhy.com/feed", category: "creator" },
    { name: "gwern.net", url: "https://www.gwern.net/atom.xml", category: "creator" },
    { name: "Stratechery", url: "https://stratechery.com/feed/", category: "creator" },
    { name: "Farnam Street", url: "https://fs.blog/feed/", category: "learn" },
    { name: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", category: "learn" },
    { name: "EFF", url: "https://www.eff.org/rss/updates.xml", category: "learn" },
    { name: "澳门文化局", url: "https://www.icm.gov.mo/rss/files/rssNews_G.xml", category: "news" },
];

export const FEATURED_CATS = [
    { id: "tech", name: "技术", icon: "code2" },
    { id: "creator", name: "创作者", icon: "pen" },
    { id: "learn", name: "学习", icon: "archive" },
    { id: "industry", name: "行业", icon: "chart" },
];
