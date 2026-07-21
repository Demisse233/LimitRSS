/**
 * 设置面板
 */

import { el, clear, iconLabel } from "./ui";
import { modal, button, toast } from "./components";
import { icon as makeIcon } from "./icons";
import { Storage } from "./storage";
import { AIService } from "./ai";
import { AIProvider, DEFAULT_PROMPTS, PromptTemplate, Subscription } from "./types";
import { applyDisplaySettings } from "./theme";
import { fetchAndParse } from "./fetcher";

const GENERIC_PROVIDER = {
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    name: "通用 AI",
};

const expandedProviders = new Set<string>();
const providerModelOptions = new Map<string, string[]>();
const LEGACY_PROVIDER_IDS = new Set(["p_openai", "p_deepseek", "p_zhipu", "p_ollama"]);
const ACTIVE_PROMPT_IDS = new Set(DEFAULT_PROMPTS.map((p) => p.id));

type Section = "general" | "display" | "reading" | "subscriptions" | "save" | "ai" | "prompts" | "about";
type SubValidationResult = { status: "testing" | "ok" | "invalid"; message?: string; articleCount?: number };

export function openSettings(storage: Storage, ai: AIService) {
    let active: Section = "general";
    const selectedSubs = new Set<string>();
    const validationResults = new Map<string, SubValidationResult>();
    let validatingSubs = false;
    const SECTIONS: { id: Section; label: string; icon: string }[] = [
        { id: "general", label: "通用", icon: "settings" },
        { id: "display", label: "外观", icon: "palette" },
        { id: "reading", label: "阅读", icon: "article" },
        { id: "subscriptions", label: "订阅源", icon: "rss" },
        { id: "save", label: "保存到思源", icon: "save" },
        { id: "ai", label: "AI 提供商", icon: "ai" },
        { id: "prompts", label: "提示词", icon: "fileText" },
        { id: "about", label: "关于", icon: "info" },
    ];

    const root = el("div", { class: "ar-settings" });
    const sidebar = el("div", { class: "ar-settings__nav" });
    const main = el("div", { class: "ar-settings__main" });
    root.appendChild(sidebar);
    root.appendChild(main);

    const render = () => {
        clear(sidebar);
        clear(main);
        SECTIONS.forEach((s) => {
            sidebar.appendChild(el("button", {
                class: `ar-settings__nav-item ${s.id === active ? "ar-settings__nav-item--active" : ""}`,
                onclick: () => { active = s.id; render(); },
            }, [el("span", { class: "ar-settings__nav-icon" }, [makeIcon(s.icon, 14)]), el("span", {}, [s.label])]));
        });
        switch (active) {
            case "general": renderGeneral(main, storage); break;
            case "display": renderDisplay(main, storage); break;
            case "reading": renderReading(main, storage); break;
            case "subscriptions": renderSubscriptions(main, storage, selectedSubs, validationResults, validatingSubs, async () => {
                if (validatingSubs) return;
                const subs = storage.getSubs();
                if (!subs.length) return;
                validatingSubs = true;
                selectedSubs.clear();
                validationResults.clear();
                subs.forEach((sub) => validationResults.set(sub.id, { status: "testing" }));
                render();
                const notice = toast(`正在检测订阅源 0/${subs.length}…`, "info", 0);
                let index = 0;
                let done = 0;
                const workers = Array.from({ length: Math.min(4, subs.length) }, async () => {
                    while (index < subs.length) {
                        const sub = subs[index++];
                        validationResults.set(sub.id, await validateSubscription(sub, storage.getSettings().general.rsshubBaseUrl));
                        done++;
                        notice.update(`正在检测订阅源 ${done}/${subs.length}…`);
                    }
                });
                await Promise.all(workers);
                notice.dismiss();
                validatingSubs = false;
                const invalid = subs.filter((sub) => validationResults.get(sub.id)?.status === "invalid");
                invalid.forEach((sub) => selectedSubs.add(sub.id));
                render();
                toast(`检测完成：${invalid.length} 个失效源`, invalid.length ? "warn" : "success", 4000);
            }, async () => {
                const ids = storage.getSubs().filter((sub) => validationResults.get(sub.id)?.status === "invalid").map((sub) => sub.id);
                if (!ids.length) {
                    toast("没有检测到失效源", "info");
                    return;
                }
                if (!confirm(`删除检测出的 ${ids.length} 个失效源？对应文章也会一并移除。`)) return;
                await storage.removeSubs(ids);
                ids.forEach((id) => {
                    validationResults.delete(id);
                    selectedSubs.delete(id);
                });
                render();
                toast(`已删除 ${ids.length} 个失效源`, "success");
            }); break;
            case "save": renderSave(main, storage); break;
            case "ai": renderAI(main, storage, ai); break;
            case "prompts": renderPrompts(main, storage); break;
            case "about": renderAbout(main); break;
        }
    };

    let dialog: ReturnType<typeof modal>;
    dialog = modal({
        title: "LimitRSS 设置",
        width: "840px",
        content: root,
        footer: [button({ text: "关闭", variant: "primary", onclick: () => dialog.close() })],
    });
    render();
    applyDisplaySettings(storage.getSettings());
    return;
}

function sectionTitle(text: string) { return el("h2", { class: "ar-settings__title" }, [text]); }

function formRow(label: string, ...controls: any[]): HTMLElement {
    return el("div", { class: "ar-form__row" }, [
        label ? el("label", { class: "ar-form__label" }, [label]) : null,
        ...controls,
    ].filter(Boolean) as HTMLElement[]);
}

function input(value: string, onChange: (v: string) => void, type: "text" | "password" = "text") {
    const i = el("input", { class: "ar-input", type, value: value || "" }) as HTMLInputElement;
    i.addEventListener("change", () => onChange(i.value));
    i.addEventListener("input", () => onChange(i.value));
    return i;
}

function numberInput(value: number, onChange: (v: number) => void) {
    const i = el("input", { class: "ar-input", type: "number", value: String(value) }) as HTMLInputElement;
    i.addEventListener("change", () => onChange(parseFloat(i.value) || 0));
    return i;
}

function checkbox(checked: boolean, onChange: (v: boolean) => void) {
    const c = el("input", { type: "checkbox" }) as HTMLInputElement;
    c.checked = checked;
    c.addEventListener("change", () => onChange(c.checked));
    return el("label", { class: "ar-check" }, [c]);
}

function switchInput(checked: boolean, onChange: (v: boolean) => void) {
    const c = el("input", { class: "ar-switch__input", type: "checkbox" }) as HTMLInputElement;
    c.checked = checked;
    c.addEventListener("click", (ev) => ev.stopPropagation());
    c.addEventListener("change", () => onChange(c.checked));
    return el("label", { class: "ar-switch", title: checked ? "已启用" : "未启用" }, [
        c,
        el("span", { class: "ar-switch__track" }),
    ]);
}

function select<T extends string>(value: T, options: { value: T; label: string }[], onChange: (v: T) => void) {
    const s = el("select", { class: "ar-input" }) as HTMLSelectElement;
    options.forEach((o) => s.appendChild(el("option", { value: o.value, selected: o.value === value }, [o.label])));
    s.addEventListener("change", () => onChange(s.value as T));
    return s;
}

function debounce<T extends (...a: any[]) => any>(fn: T, ms: number) {
    let t: any;
    return (...args: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function fallbackFavicon(url: string): string {
    try {
        const u = new URL(url);
        return `${u.origin}/favicon.ico`;
    } catch {
        return "";
    }
}

function rawCheck(checked: boolean, onChange: (v: boolean) => void) {
    const c = el("input", { type: "checkbox" }) as HTMLInputElement;
    c.checked = checked;
    c.addEventListener("change", () => onChange(c.checked));
    return c;
}

async function validateSubscription(sub: Subscription, rsshubBaseUrl?: string): Promise<SubValidationResult> {
    try {
        const parsed = await Promise.race([
            fetchAndParse(sub.url, rsshubBaseUrl),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("检测超时")), 15_000)),
        ]);
        if (!parsed.articles.length) throw new Error("没有文章");
        return { status: "ok", articleCount: parsed.articles.length };
    } catch (e) {
        return { status: "invalid", message: (e as Error).message.replace(/^Failed to fetch .*?: /, "") };
    }
}

// =============== 各面板 ===============

function renderGeneral(main: HTMLElement, s: Storage) {
    const wrap = el("div", { class: "ar-settings__section" });
    const settings = s.getSettings();
    const updateGeneral = (patch: Partial<typeof settings.general>) => {
        s.updateSettings({ general: { ...s.getSettings().general, ...patch } });
    };
    wrap.appendChild(sectionTitle("通用"));
    wrap.appendChild(formRow("默认语言", select(settings.general.language, [
        { value: "auto", label: "跟随思源" },
        { value: "zh-CN", label: "简体中文" },
        { value: "en", label: "English" },
    ], (v) => updateGeneral({ language: v }))));
    wrap.appendChild(formRow("每页文章数", numberInput(settings.general.articlesPerPage, (v) => updateGeneral({ articlesPerPage: v }))));
    wrap.appendChild(formRow("自动刷新间隔（分钟，0=关）", numberInput(settings.general.autoRefresh, (v) => updateGeneral({ autoRefresh: v }))));
    wrap.appendChild(formRow("RSSHub 实例地址", input(settings.general.rsshubBaseUrl || "https://rsshub.app", (v) => updateGeneral({ rsshubBaseUrl: v.trim() }))));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, ["用于解析 rsshub:// 路由；可填写自建实例地址，默认使用 https://rsshub.app。"]));
    wrap.appendChild(formRow("自动清理旧文章（天，0=关）", numberInput(settings.general.articleRetentionDays ?? 7, (v) => {
        updateGeneral({ articleRetentionDays: Math.max(0, Math.round(v)) });
        s.cleanupExpiredArticles();
    })));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, ["默认保留 7 天内的文章，星标文章不会被自动删除。"]));
    main.appendChild(wrap);
}

function renderDisplay(main: HTMLElement, s: Storage) {
    const wrap = el("div", { class: "ar-settings__section" });
    const settings = s.getSettings();
    const updateDisplay = (patch: Partial<typeof settings.display>) => {
        s.updateSettings({ display: { ...s.getSettings().display, ...patch } }, { emit: false });
        applyDisplaySettings(s.getSettings());
    };
    wrap.appendChild(sectionTitle("外观"));
    wrap.appendChild(formRow("正文字号（px）", numberInput(settings.display.fontSize, (v) => updateDisplay({ fontSize: v }))));
    wrap.appendChild(formRow("正文行距", numberInput(settings.display.lineHeight, (v) => updateDisplay({ lineHeight: v }))));
    wrap.appendChild(formRow("主题", select(settings.display.theme, [
        { value: "auto", label: "跟随思源" },
        { value: "light", label: "亮色" },
        { value: "dark", label: "暗色" },
    ], (v) => updateDisplay({ theme: v }))));
    main.appendChild(wrap);
}

function renderReading(main: HTMLElement, s: Storage) {
    const wrap = el("div", { class: "ar-settings__section" });
    const settings = s.getSettings();
    const reading = settings.reading || { fadeReadArticles: true, boundaryScrollSwitch: true, boundaryConfirmDelayMs: 120, boundaryCooldownMs: 700, boundaryTriggerDistance: 95 };
    const updateReading = (patch: Partial<typeof reading>) => {
        s.updateSettings({ reading: { ...s.getSettings().reading, ...patch } });
        applyDisplaySettings(s.getSettings());
    };
    wrap.appendChild(sectionTitle("阅读"));
    wrap.appendChild(formRow("已读文章变淡", switchInput(reading.fadeReadArticles !== false, (v) => updateReading({ fadeReadArticles: v }))));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, ["开启后，文章列表里的已读文章会降低对比度。"]));
    wrap.appendChild(formRow("边界滚动切换文章", switchInput(reading.boundaryScrollSwitch !== false, (v) => updateReading({ boundaryScrollSwitch: v }))));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, ["开启后，阅读到顶部继续上滑切换上一篇，阅读到底部继续下滑切换下一篇。"]));
    main.appendChild(wrap);
}

function renderSubscriptions(
    main: HTMLElement,
    s: Storage,
    selected: Set<string>,
    validationResults: Map<string, SubValidationResult>,
    validating: boolean,
    onValidate: () => Promise<void>,
    onDeleteInvalid: () => Promise<void>,
) {
    const rerender = () => {
        clear(main);
        renderSubscriptions(main, s, selected, validationResults, validating, onValidate, onDeleteInvalid);
    };
    const wrap = el("div", { class: "ar-settings__section ar-settings__section--wide" });
    const subs = s.getSubs();
    const cats = s.getCats();
    const selectedCount = selected.size;
    const invalidCount = subs.filter((sub) => validationResults.get(sub.id)?.status === "invalid").length;
    const selectedLabel = selectedCount ? `已选择 ${selectedCount} 个订阅源` : `共 ${subs.length} 个订阅源`;
    const moveSelect = el("select", { class: "ar-input ar-sub-manage__select", disabled: selectedCount === 0 }) as HTMLSelectElement;
    moveSelect.appendChild(el("option", { value: "" }, ["未分类"]));
    cats.filter((c) => c.id !== "c_default").forEach((c) => moveSelect.appendChild(el("option", { value: c.id }, [c.name])));

    wrap.appendChild(sectionTitle("订阅源"));
    wrap.appendChild(el("div", { class: "ar-sub-manage__bar" }, [
        el("div", { class: "ar-sub-manage__summary" }, [selectedLabel]),
        button({ text: "全选", size: "sm", variant: "secondary", disabled: subs.length === 0, onclick: () => {
            subs.forEach((sub) => selected.add(sub.id));
            rerender();
        } }),
        button({ text: "清空", size: "sm", variant: "ghost", disabled: selectedCount === 0, onclick: () => {
            selected.clear();
            rerender();
        } }),
        moveSelect,
        button({ text: "移动", size: "sm", variant: "secondary", disabled: selectedCount === 0, onclick: async () => {
            const ids = Array.from(selected);
            await s.moveSubs(ids, moveSelect.value || undefined);
            selected.clear();
            rerender();
            toast(`已移动 ${ids.length} 个订阅源`, "success");
        } }),
        button({ text: "删除", size: "sm", variant: "ghost", danger: true, disabled: selectedCount === 0, onclick: async () => {
            const ids = Array.from(selected);
            if (!confirm(`删除选中的 ${ids.length} 个订阅源？对应文章也会一并移除。`)) return;
            await s.removeSubs(ids);
            selected.clear();
            rerender();
            toast(`已删除 ${ids.length} 个订阅源`, "success");
        } }),
        button({ text: validating ? "检测中…" : "检测失效源", size: "sm", variant: "secondary", disabled: validating || subs.length === 0, onclick: () => onValidate() }),
        button({ text: `删除失效${invalidCount ? ` ${invalidCount}` : ""}`, size: "sm", variant: "ghost", danger: true, disabled: invalidCount === 0 || validating, onclick: () => onDeleteInvalid() }),
    ]));

    const groups = [
        { id: "c_default", name: "未分类", subs: subs.filter((sub) => !s.resolveSubCategoryId(sub)) },
        ...cats.filter((c) => c.id !== "c_default").map((cat) => ({ id: cat.id, name: cat.name, subs: subs.filter((sub) => s.resolveSubCategoryId(sub) === cat.id) })),
    ];
    const list = el("div", { class: "ar-sub-manage" });
    groups.forEach((group) => {
        const allInGroup = group.subs.length > 0 && group.subs.every((sub) => selected.has(sub.id));
        const groupCheck = rawCheck(allInGroup, (checked) => {
            group.subs.forEach((sub) => checked ? selected.add(sub.id) : selected.delete(sub.id));
            rerender();
        });
        const block = el("div", { class: "ar-sub-manage__group" }, [
            el("div", { class: "ar-sub-manage__group-head" }, [
                groupCheck,
                el("span", { class: "ar-sub-manage__group-title" }, [group.name]),
                el("span", { class: "ar-sub-manage__group-count" }, [`${group.subs.length}`]),
            ]),
        ]);
        if (group.subs.length) {
            group.subs.forEach((sub) => block.appendChild(renderSubscriptionManageRow(sub, selected, validationResults, rerender)));
        } else {
            block.appendChild(el("div", { class: "ar-sub-manage__empty" }, ["暂无订阅源"]));
        }
        list.appendChild(block);
    });
    wrap.appendChild(list);
    main.appendChild(wrap);
}

function renderSubscriptionManageRow(sub: Subscription, selected: Set<string>, validationResults: Map<string, SubValidationResult>, rerender: () => void) {
    const logoUrl = sub.favicon || fallbackFavicon(sub.siteUrl || sub.url);
    const logo = el("span", { class: "ar-sub-manage__logo" });
    if (logoUrl) {
        const img = el("img", { src: logoUrl, alt: "", loading: "lazy" }) as HTMLImageElement;
        img.addEventListener("error", () => {
            clear(logo);
            logo.appendChild(makeIcon("rss", 13));
        }, { once: true });
        logo.appendChild(img);
    } else {
        logo.appendChild(makeIcon("rss", 13));
    }
    const validation = validationResults.get(sub.id);
    const stateText = validation?.status === "testing" ? "检测中"
        : validation?.status === "invalid" ? "失效"
        : validation?.status === "ok" ? `正常${validation.articleCount ? ` ${validation.articleCount}` : ""}`
        : sub.enabled ? "启用" : "暂停";
    const stateClass = validation?.status === "invalid" ? "ar-sub-manage__state--bad"
        : validation?.status === "testing" ? "ar-sub-manage__state--checking"
        : validation?.status === "ok" ? ""
        : sub.enabled ? "" : "ar-sub-manage__state--off";
    return el("div", { class: `ar-sub-manage__row ${selected.has(sub.id) ? "ar-sub-manage__row--selected" : ""} ${validation?.status === "invalid" ? "ar-sub-manage__row--bad" : ""}` }, [
        rawCheck(selected.has(sub.id), (checked) => {
            if (checked) selected.add(sub.id);
            else selected.delete(sub.id);
            rerender();
        }),
        logo,
        el("div", { class: "ar-sub-manage__info" }, [
            el("div", { class: "ar-sub-manage__name" }, [sub.name || "未命名订阅"]),
            el("div", { class: "ar-sub-manage__url" }, [sub.url]),
            validation?.status === "invalid" && validation.message ? el("div", { class: "ar-sub-manage__error" }, [validation.message]) : null,
        ]),
        el("span", { class: `ar-sub-manage__state ${stateClass}` }, [stateText]),
    ].filter(Boolean) as HTMLElement[]);
}

function renderSave(main: HTMLElement, s: Storage) {
    const wrap = el("div", { class: "ar-settings__section" });
    const settings = s.getSettings();
    wrap.appendChild(sectionTitle("保存到思源"));
    const ta = el("textarea", { class: "ar-input", rows: 8, style: { fontFamily: "var(--b3-font-family-code)", fontSize: "12px" } }, [settings.save.template]) as HTMLTextAreaElement;
    ta.addEventListener("change", debounce(() => s.updateSettings({ save: { ...settings.save, template: ta.value } }), 400));
    wrap.appendChild(formRow("Markdown 模板", ta));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, ["可用变量：{{title}} {{author}} {{date}} {{link}} {{source}} {{content}} {{summary}} {{description}}"]));
    wrap.appendChild(formRow("包含原文链接", checkbox(settings.save.includeSourceLink, (v) => s.updateSettings({ save: { ...settings.save, includeSourceLink: v } }))));
    wrap.appendChild(formRow("下载远程图片到本地", checkbox(settings.save.downloadImages, (v) => s.updateSettings({ save: { ...settings.save, downloadImages: v } }))));
    main.appendChild(wrap);
}

function renderAI(main: HTMLElement, s: Storage, ai: AIService) {
    clear(main);
    const wrap = el("div", { class: "ar-settings__section" });
    wrap.appendChild(sectionTitle("AI 提供商"));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, [iconLabel("shield", "使用 OpenAI 兼容接口。API Key 仅保存在本地思源工作空间。", 12)]));

    const aiSettings = s.getAI();
    if (shouldCollapseLegacyProviders(aiSettings.providers)) {
        const picked = aiSettings.providers.find((p) => p.apiKey) || aiSettings.providers.find((p) => p.enabled) || aiSettings.providers[0];
        s.updateAI({
            providers: [{
                ...picked,
                id: "p_generic",
                type: "custom",
                name: "通用 AI",
                endpoint: picked.endpoint || GENERIC_PROVIDER.endpoint,
                model: picked.model || GENERIC_PROVIDER.model,
            }],
        });
        ai.update(s.getAI());
        return renderAI(main, s, ai);
    }
    const list = el("div", { class: "ar-providers" });
    aiSettings.providers.forEach((p, idx) => {
        list.appendChild(renderProviderCard(p, idx, s, ai, () => renderAI(main, s, ai)));
    });
    wrap.appendChild(list);
    wrap.appendChild(el("div", { class: "ar-actions" }, [
        button({ text: "添加提供商", icon: "plus", onclick: () => {
            const newP: AIProvider = {
                id: "p_" + Date.now().toString(36),
                type: "custom", name: GENERIC_PROVIDER.name,
                endpoint: GENERIC_PROVIDER.endpoint, model: GENERIC_PROVIDER.model,
                temperature: 0.7, maxTokens: 2048, enabled: !aiSettings.providers.some((p) => p.enabled),
            };
            expandedProviders.add(newP.id);
            s.updateAI({ providers: [...aiSettings.providers, newP] });
            ai.update(s.getAI());
            renderAI(main, s, ai);
        } }),
    ]));
    main.appendChild(wrap);
}

function shouldCollapseLegacyProviders(providers: AIProvider[]): boolean {
    return providers.length > 1 && providers.every((p) => LEGACY_PROVIDER_IDS.has(p.id));
}

function renderProviderCard(p: AIProvider, idx: number, s: Storage, ai: AIService, rerender: () => void): HTMLElement {
    const expanded = expandedProviders.has(p.id);
    const card = el("div", { class: `ar-provider ${expanded ? "ar-provider--open" : ""}` });
    const saveProvider = () => {
        const list = [...s.getAI().providers];
        list[idx] = p;
        s.updateAI({ providers: list });
        ai.update(s.getAI());
    };
    const header = el("div", {
        class: "ar-provider__header",
        onclick: () => {
            if (expandedProviders.has(p.id)) expandedProviders.delete(p.id);
            else expandedProviders.add(p.id);
            rerender();
        },
    }, [
        el("span", {
            class: "ar-provider__switch",
            onclick: (ev: MouseEvent) => ev.stopPropagation(),
            onmousedown: (ev: MouseEvent) => ev.stopPropagation(),
        }, [
            switchInput(p.enabled, (v) => {
                p.enabled = v;
                saveProvider();
                rerender();
            }),
        ]),
        el("div", { class: "ar-provider__name" }, [
            el("span", { class: "ar-provider__title" }, [p.name || "未命名"]),
            el("span", { class: "ar-provider__meta" }, [p.enabled ? "已启用" : "未启用"]),
        ]),
        el("span", { class: "ar-provider__chevron" }, [makeIcon("chevronDown", 14)]),
    ]);
    card.appendChild(header);

    const body = el("div", { class: "ar-provider__body" });
    body.appendChild(formRow("名称", input(p.name, (v) => { p.name = v; })));
    body.appendChild(formRow("Endpoint", input(p.endpoint || "", (v) => { p.endpoint = v; })));
    body.appendChild(formRow("API Key", input(p.apiKey || "", (v) => { p.apiKey = v; }, "password")));
    body.appendChild(formRow("模型", renderModelPicker(p, ai, saveProvider)));
    body.appendChild(formRow("Temperature", numberInput(p.temperature ?? 0.7, (v) => { p.temperature = v; })));
    body.appendChild(formRow("Max Tokens", numberInput(p.maxTokens ?? 2048, (v) => { p.maxTokens = v; })));
    body.appendChild(el("div", { class: "ar-provider__body-actions" }, [
        button({ text: "测试连接", size: "sm", variant: "secondary", onclick: async (ev) => {
            const b = ev.currentTarget as HTMLButtonElement;
            b.disabled = true; b.textContent = "测试中…";
            const r = await ai.test({ ...p, type: p.type === "anthropic" ? "anthropic" : "custom" });
            if (r.ok) toast(`${r.latencyMs}ms`, "success");
            else toast(r.msg, "error", 5000);
            b.disabled = false; b.textContent = "测试连接";
        } }),
        button({ text: "删除", size: "sm", variant: "ghost", danger: true, onclick: () => {
            if (confirm(`删除提供商「${p.name}」？`)) {
                const list = s.getAI().providers.filter((x, i) => i !== idx);
                expandedProviders.delete(p.id);
                s.updateAI({ providers: list });
                ai.update(s.getAI());
                rerender();
            }
        } }),
    ]));
    card.appendChild(body);

    // 字段变化时保存
    setTimeout(() => {
        const save = debounce(() => {
            p.type = p.type === "anthropic" ? "anthropic" : "custom";
            saveProvider();
        }, 400);
        body.querySelectorAll("input").forEach((i) => {
            i.addEventListener("input", save);
            i.addEventListener("change", save);
        });
        body.querySelectorAll("select").forEach((i) => {
            i.addEventListener("change", save);
        });
    }, 0);
    return card;
}

function renderModelPicker(p: AIProvider, ai: AIService, saveProvider: () => void): HTMLElement {
    const wrap = el("div", { class: "ar-model-picker" });
    const field = input(p.model, (v) => { p.model = v; });
    field.placeholder = "输入模型名称，或点击获取后选择";
    wrap.appendChild(field);

    const optionsWrap = el("div", { class: "ar-model-picker__options" });
    const renderOptions = () => {
        clear(optionsWrap);
        const options = providerModelOptions.get(p.id) || [];
        if (!options.length) return;
        const select = el("select", {
            class: "b3-select ar-model-picker__select",
            onchange: (ev: Event) => {
                const value = (ev.currentTarget as HTMLSelectElement).value;
                if (!value) return;
                p.model = value;
                field.value = value;
                saveProvider();
            },
        }, [
            el("option", { value: "" }, ["选择模型"]),
            ...options.map((model) => el("option", {
                value: model,
                selected: model === p.model,
            }, [model])),
        ]);
        optionsWrap.appendChild(select);
    };

    const fetchBtn = button({
        text: "获取模型",
        size: "sm",
        variant: "secondary",
        onclick: async (ev) => {
            const b = ev.currentTarget as HTMLButtonElement;
            const oldText = b.textContent || "获取模型";
            b.disabled = true;
            b.textContent = "获取中…";
            try {
                const models = await ai.listModels({ ...p, type: p.type === "anthropic" ? "anthropic" : "custom" });
                providerModelOptions.set(p.id, models);
                renderOptions();
                if (models.length) toast(`已获取 ${models.length} 个模型`, "success");
                else toast("没有获取到可用模型", "error", 5000);
            } catch (err) {
                toast((err as Error).message || "获取模型失败", "error", 5000);
            } finally {
                b.disabled = false;
                b.textContent = oldText;
            }
        },
    });
    wrap.appendChild(el("div", { class: "ar-model-picker__actions" }, [fetchBtn]));
    wrap.appendChild(optionsWrap);
    renderOptions();
    return wrap;
}

function renderPrompts(main: HTMLElement, s: Storage) {
    clear(main);
    const wrap = el("div", { class: "ar-settings__section" });
    const ai = s.getAI();
    wrap.appendChild(sectionTitle("提示词模板"));
    wrap.appendChild(el("div", { class: "ar-form__hint" }, ["变量：{{title}} {{content}} {{link}} {{author}} {{date}} {{description}}"]));
    const prompts = activePrompts(ai.prompts);
    if (prompts.length !== ai.prompts.length || prompts.some((p, i) => p.id !== ai.prompts[i]?.id)) {
        s.updateAI({ prompts });
    }
    const list = el("div", { class: "ar-prompts" });
    prompts.forEach((p, idx) => {
        list.appendChild(renderPromptCard(p, idx, s));
    });
    wrap.appendChild(list);
    main.appendChild(wrap);
}

function activePrompts(stored: PromptTemplate[]): PromptTemplate[] {
    return DEFAULT_PROMPTS.map((base) => {
        const saved = stored.find((p) => p.id === base.id);
        return saved ? { ...base, ...saved, builtin: true, order: base.order, icon: base.icon, outputFormat: base.outputFormat } : { ...base };
    }).filter((p) => ACTIVE_PROMPT_IDS.has(p.id));
}

function renderPromptCard(p: PromptTemplate, idx: number, s: Storage): HTMLElement {
    const card = el("div", { class: "ar-prompt" });
    const header = el("div", { class: "ar-prompt__header" }, [
        el("span", {}, [makeIcon(p.icon || "sparkle", 14)]),
        el("span", { class: "ar-prompt__name" }, [p.name]),
        el("span", { class: "ar-prompt__tag" }, [p.builtin ? "内置" : "用户"]),
    ]);
    card.appendChild(header);
    const body = el("div", { class: "ar-prompt__body" });
    body.appendChild(formRow("名称", input(p.name, (v) => { p.name = v; })));
    body.appendChild(formRow("说明", input(p.description || "", (v) => { p.description = v; })));
    const sysTa = el("textarea", { class: "ar-input", rows: 3, placeholder: "系统提示词" }, [p.systemPrompt || ""]) as HTMLTextAreaElement;
    body.appendChild(formRow("系统提示", sysTa));
    const userTa = el("textarea", { class: "ar-input", rows: 6, style: { fontFamily: "var(--b3-font-family-code)", fontSize: "12px" } }, [p.userPrompt]) as HTMLTextAreaElement;
    body.appendChild(formRow("用户提示", userTa));
    card.appendChild(body);

    setTimeout(() => {
        const save = debounce(() => {
            p.systemPrompt = sysTa.value;
            p.userPrompt = userTa.value;
            const list = activePrompts(s.getAI().prompts);
            list[idx] = p;
            s.updateAI({ prompts: list });
        }, 400);
        [sysTa, userTa].forEach((t) => t.addEventListener("input", save));
        body.querySelectorAll("input").forEach((i) => i.addEventListener("input", save));
    }, 0);
    return card;
}

function renderAbout(main: HTMLElement) {
    const wrap = el("div", { class: "ar-settings__section" });
    wrap.appendChild(el("div", { class: "ar-about" }, [
        el("div", { class: "ar-about__logo" }, [makeIcon("rssMain", 48)]),
        el("h2", {}, ["LimitRSS"]),
        el("p", { class: "ar-about__ver" }, ["v0.1.3 · 2026-07-21"]),
        el("p", {}, ["用 AI 收敛信息噪音的 RSS 阅读器。"]),
        el("hr"),
        el("h3", {}, ["特性"]),
        el("ul", {}, [
            ["rss", "RSS/Atom 订阅管理、OPML 导入导出"],
            ["ai", "通用 OpenAI 兼容 AI 接口，可配置多个提供商"],
            ["fileText", "流式总结/翻译/关键观点/思维导图/主题日报/智能标签"],
            ["save", "一键保存到思源，自动下载远程图片到本地"],
            ["palette", "跟随思源主题，深色模式原生支持"],
            ["keyboard", "完整快捷键支持"],
        ].map(([ic, t]) => el("li", {}, [iconLabel(ic, t, 13)]))),
        el("hr"),
        el("p", {}, [iconLabel("shield", "API Key 仅存储在本地工作空间。", 13)]),
    ]));
    main.appendChild(wrap);
}
