/**
 * 日志工具
 */
const DEBUG = false;

export const logger = {
    debug: (...args: any[]) => DEBUG && console.debug("[ai-rss]", ...args),
    log: (...args: any[]) => DEBUG && console.log("[ai-rss]", ...args),
    info: (...args: any[]) => DEBUG && console.info("[ai-rss]", ...args),
    warn: (...args: any[]) => console.warn("[ai-rss]", ...args),
    error: (...args: any[]) => console.error("[ai-rss]", ...args),
};
