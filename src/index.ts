/**
 * ai-rss 思源笔记插件 - 入口
 */

import { Plugin, Setting, openTab } from "siyuan";
import "./index.scss";

import { Storage } from "./storage";
import { AIService } from "./ai";
import { RssTab } from "./tab";
import { button, dropdown, toast } from "./components";
import { openSettings } from "./settings";

const TAB_TYPE = "ai_rss_tab";
const DOCK_TYPE = "ai_rss_dock";
const GLOBAL_KEY = "__ai_rss__";

type EntryPosition = "topbar-right" | "topbar-left" | "dock-left-top" | "dock-right-top" | "hidden";
type DockPosition = "LeftTop" | "RightTop";

interface AIRSSGlobal {
    storage: Storage;
    ai: AIService;
    applyEntry?: () => void;
    openFullTab?: () => void;
}

function setGlobal(refs: AIRSSGlobal) { (window as any)[GLOBAL_KEY] = refs; }
function getGlobal(): AIRSSGlobal | null { return (window as any)[GLOBAL_KEY] || null; }

/** 在 Tab 或 Dock 容器上挂载阅读器 UI */
function mountRssTab(element: HTMLElement, isDock = false): RssTab | null {
    element.innerHTML = "";
    element.classList.add("ar-tab-root");
    if (isDock) element.classList.add("ar-tab-root--dock");
    const refs = getGlobal();
    if (!refs) {
        console.error("[ai-rss] no global refs found");
        element.innerHTML = `<div style="padding:20px;color:#ef4444">ai-rss 初始化失败：未找到 storage/ai 引用</div>`;
        return null;
    }
    try {
        const tab = new RssTab(element, refs.storage, refs.ai);
        console.info("[ai-rss] tab initialized");
        return tab;
    } catch (e) {
        console.error("[ai-rss] RssTab init error", e);
        element.innerHTML = `<div style="padding:20px;color:#ef4444">初始化失败：${(e as Error).message}</div>`;
        return null;
    }
}

export default class AIRSSPlugin extends Plugin {
    private storage!: Storage;
    private ai!: AIService;
    private topBarEl: HTMLElement | null = null;
    private dockRef: { config: { position: string }; model: any } | null = null;
    private layoutReady = false;

    async onload() {
        console.info("[ai-rss] loading…");

        // 同步创建引用并注册 UI：SDK 要求 addIcons/addTab 等在同步阶段执行，
        // 避免异步等待数据导致移动端/低性能设备首次加载时入口未注册
        this.storage = new Storage(this);
        this.ai = new AIService(this.storage.getAI());
        setGlobal({ storage: this.storage, ai: this.ai, applyEntry: () => this.applyEntry(), openFullTab: () => this.openRssTab() });

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
                (this as any)._rssTab = mountRssTab(element);
            },
            destroy() {
                try { (this as any)._rssTab?.destroy?.(); } catch { /* */ }
                delete (this as any)._rssTab;
                console.info("[ai-rss] tab destroyed");
            },
        });

        // 命令面板兜底入口（隐藏按钮时仍可通过命令面板打开）
        this.addCommand({
            langKey: "limitrss.open",
            langText: "打开 LimitRSS",
            callback: () => this.openRssTab(),
        });
        this.addCommand({
            langKey: "limitrss.settings",
            langText: "打开 LimitRSS 设置",
            callback: () => openSettings(this.storage, this.ai),
        });

        // 注册 SDK 设置面板：集市「已下载」与顶栏插件菜单会显示设置入口
        this.setting = new Setting({ width: "620px" });
        this.setting.addItem({
            title: "打开 LimitRSS 设置",
            direction: "row",
            description: "配置订阅、AI 提供商、保存路径、入口位置等",
            actionElement: button({
                text: "打开设置",
                variant: "primary",
                className: "ar-open-full-settings",
                onclick: () => openSettings(this.storage, this.ai),
            }),
        });
        // 点击集市/插件管理中的「设置」时直接进入完整设置界面（绕过 SDK 中间面板）
        this.setting.open = () => {
            openSettings(this.storage, this.ai);
        };

        await this.storage.whenReady();
        this.storage.on(() => this.ai.update(this.storage.getAI()));
        // 数据就绪后按已加载的设置重新应用入口（首次 onLayoutReady 可能已用默认值注册）
        if (this.layoutReady) this.applyEntry();
    }

    onLayoutReady() {
        this.layoutReady = true;
        this.applyEntry();
    }

    /** 按设置分发入口位置（顶栏左/右、左侧/右侧 dock、隐藏） */
    applyEntry = () => {
        const position = (this.storage.getSettings().general.entryPosition || "topbar-right") as EntryPosition;
        // 清理顶栏按钮（顶栏模式可实时切换）
        if (this.topBarEl) {
            this.topBarEl.remove();
            this.topBarEl = null;
        }
        if (position === "topbar-right" || position === "topbar-left") {
            this.topBarEl = this.addTopBar({
                icon: "iconRSSMain",
                title: "LimitRSS",
                position: position === "topbar-left" ? "left" : "right",
                callback: () => this.openRssTab(),
            });
            this.topBarEl.addEventListener("contextmenu", (ev) => {
                ev.preventDefault();
                this.showEntryMenu(this.topBarEl as HTMLElement);
            });
        } else if (position === "dock-left-top" || position === "dock-right-top") {
            this.registerDock(position === "dock-left-top" ? "LeftTop" : "RightTop");
        }
        // hidden：不注册任何入口

        // 无法热卸载 dock 时提示重载
        const dockPos = this.dockRef?.config.position;
        if (this.dockRef && (position === "hidden" || position === "topbar-left" || position === "topbar-right")) {
            toast("已切换到顶栏/隐藏，dock 将在重新加载插件后移除", "info", 4000);
        } else if (dockPos && (position === "dock-left-top" || position === "dock-right-top") && dockPos !== (position === "dock-left-top" ? "LeftTop" : "RightTop")) {
            toast("切换 dock 位置需重新加载插件", "info", 4000);
        }
    };

    /** dock 会话内只注册一次；SDK 无卸载 API，位置变更需重载插件 */
    private registerDock(position: DockPosition) {
        if (this.dockRef) return;
        this.dockRef = this.addDock({
            type: DOCK_TYPE,
            config: {
                position,
                size: { width: 340, height: 0 },
                icon: "iconRSSMain",
                title: "LimitRSS",
                show: true,
            },
            data: {},
            init() {
                const element = (this as any).element as HTMLElement | undefined;
                if (!element) {
                    console.warn("[ai-rss] dock init: no element");
                    return;
                }
                (this as any)._rssTab = mountRssTab(element, true);
            },
            destroy() {
                try { (this as any)._rssTab?.destroy?.(); } catch { /* */ }
                delete (this as any)._rssTab;
            },
        });
    }

    private showEntryMenu(target: HTMLElement) {
        const current = (this.storage.getSettings().general.entryPosition || "topbar-right") as EntryPosition;
        const item = (label: string, icon: string, value: EntryPosition) => ({
            label,
            icon,
            active: current === value,
            onClick: () => this.setEntry(value),
        });
        dropdown(target, [
            item("顶栏右侧（默认）", "chevronRight", "topbar-right"),
            item("顶栏左侧", "chevronLeft", "topbar-left"),
            { divider: true, label: "" },
            item("左侧 dock", "chevronLeft", "dock-left-top"),
            item("右侧 dock", "chevronRight", "dock-right-top"),
            { divider: true, label: "" },
            item("隐藏按钮", "close", "hidden"),
        ]);
    }

    private setEntry(position: EntryPosition) {
        this.storage.updateSettings({ general: { ...this.storage.getSettings().general, entryPosition: position } });
        this.applyEntry();
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
