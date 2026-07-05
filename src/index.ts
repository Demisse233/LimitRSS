/**
 * ai-rss 思源笔记插件 - 入口
 */

import { Plugin, openTab } from "siyuan";
import "./index.scss";

import { Storage } from "./storage";
import { AIService } from "./ai";
import { RssTab } from "./tab";

const TAB_TYPE = "ai_rss_tab";
const GLOBAL_KEY = "__ai_rss__";

interface AIRSSGlobal {
    storage: Storage;
    ai: AIService;
}
function setGlobal(refs: AIRSSGlobal) { (window as any)[GLOBAL_KEY] = refs; }
function getGlobal(): AIRSSGlobal | null { return (window as any)[GLOBAL_KEY] || null; }

export default class AIRSSPlugin extends Plugin {
    private storage!: Storage;
    private ai!: AIService;

    async onload() {
        console.info("[ai-rss] loading…");

        this.storage = new Storage(this);
        await this.storage.whenReady();

        this.ai = new AIService(this.storage.getAI());
        this.storage.on(() => this.ai.update(this.storage.getAI()));
        setGlobal({ storage: this.storage, ai: this.ai });

        this.addIcons(`
<symbol id="iconRSSMain" viewBox="0 0 32 32">
<path d="M6.6 9.4c8.95 0 16.2 7.25 16.2 16.2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/>
<path d="M6.8 16.1c5.25 0 9.5 4.25 9.5 9.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/>
<path d="M7.7 21.25 8.55 23.35 10.65 24.2 8.55 25.05 7.7 27.15 6.85 25.05 4.75 24.2 6.85 23.35 7.7 21.25Z" fill="currentColor"/>
</symbol>
`);

        // 注册 tab 类型
        this.addTab({
            type: TAB_TYPE,
            init() {
                const element = (this as any).element as HTMLElement | undefined;
                if (!element) {
                    console.warn("[ai-rss] tab init: no element");
                    return;
                }
                element.innerHTML = "";
                element.classList.add("ar-tab-root");
                const refs = getGlobal();
                if (refs) {
                    try {
                        (this as any)._rssTab = new RssTab(element, refs.storage, refs.ai);
                        console.info("[ai-rss] tab initialized");
                    } catch (e) {
                        console.error("[ai-rss] RssTab init error", e);
                        element.innerHTML = `<div style="padding:20px;color:#ef4444">初始化失败：${(e as Error).message}</div>`;
                    }
                } else {
                    console.error("[ai-rss] no global refs found");
                    element.innerHTML = `<div style="padding:20px;color:#ef4444">ai-rss 初始化失败：未找到 storage/ai 引用</div>`;
                }
            },
            destroy() {
                try { (this as any)._rssTab?.destroy?.(); } catch { /* */ }
                delete (this as any)._rssTab;
                console.info("[ai-rss] tab destroyed");
            },
        });
    }

    onLayoutReady() {
        this.addTopBar({
            icon: "iconRSSMain",
            title: "LimitRSS",
            position: "right",
            callback: () => this.openRssTab(),
        });
    }

    onunload() {
        console.info("[ai-rss] unloading");
        delete (window as any)[GLOBAL_KEY];
    }

    private async openRssTab() {
        try {
            // 关键：id 必须是 plugin.name + tab.type 形式
            const customId = this.name + TAB_TYPE;
            console.info("[ai-rss] opening tab with id:", customId);

            // 检查是否已打开
            const opened = this.getOpenedTab();
            for (const key of Object.keys(opened)) {
                for (const t of opened[key] as any[]) {
                    if (t?.type === TAB_TYPE || t?.id === customId) {
                        try { t.parent?.parent?.switchTab?.(t); } catch { /* */ }
                        return;
                    }
                }
            }

            await openTab({
                app: this.app,
                custom: {
                    id: customId,
                    icon: "iconRSSMain",
                    title: "LimitRSS",
                    data: {},
                },
            });
        } catch (e) {
            console.error("[ai-rss] openTab failed", e);
        }
    }
}
