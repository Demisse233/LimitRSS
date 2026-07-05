/**
 * 存储层 - 封装 siyuan loadData/saveData
 * 用 Map/Set 做内存索引，提供 reactive 读
 */

import { Plugin } from "siyuan";
import { Article, Category, Subscription, Settings, AISettings, KEYS, DEFAULT_SETTINGS, DEFAULT_AI } from "./types";

const LEGACY_PLUGIN_STORAGE_DIRS = ["ai-rss"];

type SubscriptionStore = {
    meta?: {
        revision?: number;
        updatedAt?: number;
        clientId?: string;
        clearedAt?: number;
        deletedUrls?: Record<string, number>;
    };
    items: Subscription[];
};

export class Storage {
    private plugin: Plugin;
    private ready: Promise<void>;
    private saveQueues: Map<string, Promise<void>> = new Map();
    private clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    private subStoreMeta: NonNullable<SubscriptionStore["meta"]> = { revision: 0, updatedAt: 0, clientId: this.clientId };

    subs: Subscription[] = [];
    cats: Category[] = [];
    articles: Map<string, Article> = new Map();
    read: Set<string> = new Set();
    star: Set<string> = new Set();
    settings: Settings = DEFAULT_SETTINGS;
    ai: AISettings = DEFAULT_AI;

    listeners: Set<() => void> = new Set();

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.ready = this.load();
    }
    whenReady() { return this.ready; }
    on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    private emit() { this.listeners.forEach((l) => l()); }
    private defaultCat(): Category {
        return { id: "c_default", name: "未分类", color: "#94a3b8", sortOrder: 9999, collapsed: false, builtin: true };
    }
    private withDefaultCat(cats: Category[]) {
        return cats.some((c) => c.id === "c_default") ? cats : [this.defaultCat(), ...cats];
    }

    private async load() {
        const [s, c, a, r, st, sg, ai] = await Promise.all([
            this.loadDataWithLegacyFallback(KEYS.subs),
            this.loadDataWithLegacyFallback(KEYS.cats),
            this.loadDataWithLegacyFallback(KEYS.articles),
            this.loadDataWithLegacyFallback(KEYS.read),
            this.loadDataWithLegacyFallback(KEYS.star),
            this.loadDataWithLegacyFallback(KEYS.settings),
            this.loadDataWithLegacyFallback(KEYS.ai),
        ]);
        const subStore = this.normalizeSubStore(s);
        this.subs = subStore.items;
        this.subStoreMeta = {
            revision: subStore.meta?.revision || 0,
            updatedAt: subStore.meta?.updatedAt || 0,
            clientId: subStore.meta?.clientId || this.clientId,
            clearedAt: subStore.meta?.clearedAt,
            deletedUrls: subStore.meta?.deletedUrls,
        };
        if (Array.isArray(c)) this.cats = this.withDefaultCat(c);
        else this.cats = [this.defaultCat()];
        if (Array.isArray(a)) this.articles = new Map(a.map((x: Article) => [x.id, x]));
        if (Array.isArray(r)) this.read = new Set(r);
        if (Array.isArray(st)) this.star = new Set(st);
        if (sg && typeof sg === "object") {
            this.settings = {
                ...DEFAULT_SETTINGS,
                ...sg,
                general: { ...DEFAULT_SETTINGS.general, ...(sg.general || {}) },
                display: { ...DEFAULT_SETTINGS.display, ...(sg.display || {}) },
                reading: { ...DEFAULT_SETTINGS.reading, ...(sg.reading || {}) },
                save: { ...DEFAULT_SETTINGS.save, ...(sg.save || {}) },
            };
        }
        if (ai && typeof ai === "object") this.ai = { ...DEFAULT_AI, ...ai };
        for (const a of this.articles.values()) {
            a.isRead = this.read.has(a.id);
            a.isStarred = this.star.has(a.id);
        }
    }

    private async loadDataWithLegacyFallback(key: string): Promise<any> {
        const current = await this.plugin.loadData(key);
        if (current !== undefined && current !== null) return current;
        const legacy = await this.loadLegacyData(key);
        if (legacy !== undefined && legacy !== null) {
            await this.plugin.saveData(key, this.snapshot(legacy));
            console.info(`[ai-rss] migrated legacy data key ${key}`);
            return legacy;
        }
        return current;
    }

    private async loadLegacyData(key: string): Promise<any> {
        for (const dir of LEGACY_PLUGIN_STORAGE_DIRS) {
            const text = await this.getWorkspaceFileText(`/data/storage/petal/${dir}/${key}`);
            if (!text || !text.trim()) continue;
            try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && "code" in parsed && "msg" in parsed && !("items" in parsed)) continue;
                return parsed;
            } catch {
                return text;
            }
        }
        return undefined;
    }

    private async getWorkspaceFileText(path: string): Promise<string | undefined> {
        try {
            const resp = await fetch("/api/file/getFile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path }),
            });
            if (!resp.ok) return undefined;
            return await resp.text();
        } catch {
            return undefined;
        }
    }

    private snapshot<T>(data: T): T {
        try {
            if (typeof structuredClone === "function") return structuredClone(data);
        } catch { /* fallback */ }
        return JSON.parse(JSON.stringify(data)) as T;
    }

    private async save(key: string, data: any) {
        const snapshot = this.snapshot(data);
        const prev = this.saveQueues.get(key) || Promise.resolve();
        const next = prev
            .catch(() => undefined)
            .then(async () => {
                await this.plugin.saveData(key, snapshot);
            })
            .catch((e) => {
                console.error("[ai-rss] save", key, e);
            });
        this.saveQueues.set(key, next);
        await next;
        if (this.saveQueues.get(key) === next) this.saveQueues.delete(key);
    }

    // ===== subs =====
    private normalizeUrl(url: string) {
        return (url || "").trim().toLowerCase();
    }

    private normalizeSubStore(raw: any): SubscriptionStore {
        const meta = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.meta : undefined;
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
        return { meta, items: this.normalizeSubs(list) };
    }

    private normalizeSubs(list: Subscription[]) {
        const byUrl = new Map<string, Subscription>();
        const byId = new Map<string, string>();
        for (const raw of list || []) {
            if (!raw?.id || !raw?.url) continue;
            const now = Date.now();
            const sub: Subscription = {
                ...raw,
                url: raw.url.trim(),
                name: raw.name || raw.url.trim(),
                enabled: raw.enabled !== false,
                errorCount: raw.errorCount || 0,
                sortOrder: Number.isFinite(raw.sortOrder) ? raw.sortOrder : byUrl.size,
                createdAt: raw.createdAt || now,
                updatedAt: raw.updatedAt || raw.createdAt || now,
            };
            if (sub.categoryId) {
                const cat = this.cats.find((c) => c.id === sub.categoryId);
                if (cat) sub.categoryName = cat.name;
            }
            const urlKey = this.normalizeUrl(sub.url);
            const idKey = byId.get(sub.id);
            const key = idKey || urlKey;
            const existed = byUrl.get(key);
            if (!existed || (sub.updatedAt || 0) >= (existed.updatedAt || 0)) {
                const merged: Subscription = existed ? {
                    ...existed,
                    ...sub,
                    id: existed.id || sub.id,
                    createdAt: Math.min(existed.createdAt || sub.createdAt, sub.createdAt || existed.createdAt),
                    sortOrder: Math.min(existed.sortOrder ?? sub.sortOrder, sub.sortOrder ?? existed.sortOrder),
                    categoryId: sub.categoryId ?? existed.categoryId,
                    categoryName: sub.categoryName ?? existed.categoryName,
                    favicon: sub.favicon || existed.favicon,
                    siteUrl: sub.siteUrl || existed.siteUrl,
                    description: sub.description || existed.description,
                } : sub;
                byUrl.set(key, merged);
                byId.set(merged.id, key);
                if (key !== urlKey) byUrl.delete(urlKey);
                byUrl.set(urlKey, merged);
                byId.set(merged.id, urlKey);
            }
        }
        return Array.from(byUrl.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    }

    private makeSubStore(items: Subscription[]): SubscriptionStore {
        const now = Date.now();
        this.subStoreMeta = {
            revision: (this.subStoreMeta.revision || 0) + 1,
            updatedAt: now,
            clientId: this.clientId,
            clearedAt: items.length === 0 ? now : this.subStoreMeta.clearedAt,
            deletedUrls: this.subStoreMeta.deletedUrls,
        };
        return { meta: this.subStoreMeta, items: this.normalizeSubs(items) };
    }

    private async loadLatestSubStore() {
        return this.normalizeSubStore(await this.plugin.loadData(KEYS.subs));
    }

    private async commitSubs(
        mutator: (items: Subscription[]) => Subscription[] | void,
        options: { mergeCurrent?: boolean; emit?: boolean } = {},
    ) {
        const prev = this.saveQueues.get(KEYS.subs) || Promise.resolve();
        let nextItems: Subscription[] = [];
        const next = prev
            .catch(() => undefined)
            .then(async () => {
                const latest = await this.loadLatestSubStore();
                const clearedAt = latest.meta?.clearedAt || 0;
                const deletedUrls = latest.meta?.deletedUrls || {};
                const latestUrls = new Set(latest.items.map((sub) => this.normalizeUrl(sub.url)));
                const current = this.subs.filter((sub) => {
                    const ts = sub.updatedAt || sub.createdAt || 0;
                    const urlKey = this.normalizeUrl(sub.url);
                    if (clearedAt && ts <= clearedAt) return false;
                    if (deletedUrls[urlKey] && !latestUrls.has(urlKey)) return false;
                    return true;
                });
                this.subStoreMeta = {
                    revision: latest.meta?.revision || this.subStoreMeta.revision || 0,
                    updatedAt: latest.meta?.updatedAt || this.subStoreMeta.updatedAt || 0,
                    clientId: latest.meta?.clientId || this.subStoreMeta.clientId || this.clientId,
                    clearedAt: latest.meta?.clearedAt ?? this.subStoreMeta.clearedAt,
                    deletedUrls: { ...(this.subStoreMeta.deletedUrls || {}), ...(latest.meta?.deletedUrls || {}) },
                };
                const base = options.mergeCurrent === false
                    ? latest.items
                    : this.normalizeSubs([...latest.items, ...current]);
                const result = mutator(base.map((sub) => ({ ...sub })));
                nextItems = this.normalizeSubs(result || base);
                const store = this.makeSubStore(nextItems);
                await this.plugin.saveData(KEYS.subs, this.snapshot(store));
                this.subs = store.items;
            })
            .catch((e) => {
                console.error("[ai-rss] save", KEYS.subs, e);
            });
        this.saveQueues.set(KEYS.subs, next);
        await next;
        if (this.saveQueues.get(KEYS.subs) === next) this.saveQueues.delete(KEYS.subs);
        if (options.emit !== false) this.emit();
        return nextItems;
    }

    getSubs() { return [...this.subs].sort((a, b) => a.sortOrder - b.sortOrder); }
    getSub(id: string) { return this.subs.find((s) => s.id === id); }
    resolveSubCategoryId(sub: Subscription): string | undefined {
        if (sub.categoryId && this.cats.some((cat) => cat.id === sub.categoryId)) return sub.categoryId;
        if (sub.categoryName) {
            const byName = this.cats.find((cat) => cat.name === sub.categoryName);
            if (byName && byName.id !== "c_default") return byName.id;
        }
        return undefined;
    }
    async upsertSub(s: Subscription) {
        const incoming = { ...s, updatedAt: Date.now() };
        if (incoming.categoryId) {
            const cat = this.cats.find((c) => c.id === incoming.categoryId);
            incoming.categoryName = cat?.name || incoming.categoryName;
        }
        const saved = await this.commitSubs((items) => {
            const urlKey = this.normalizeUrl(incoming.url);
            if (this.subStoreMeta.deletedUrls?.[urlKey]) {
                const nextDeleted = { ...this.subStoreMeta.deletedUrls };
                delete nextDeleted[urlKey];
                this.subStoreMeta.deletedUrls = nextDeleted;
            }
            const i = items.findIndex((x) => x.id === incoming.id || this.normalizeUrl(x.url) === urlKey);
            if (i >= 0) {
                const old = items[i];
                items[i] = {
                    ...old,
                    ...incoming,
                    id: old.id,
                    createdAt: old.createdAt || incoming.createdAt,
                    sortOrder: old.sortOrder ?? incoming.sortOrder,
                };
            } else {
                items.push(incoming);
            }
            return items;
        });
        return saved.find((sub) => sub.id === incoming.id || this.normalizeUrl(sub.url) === this.normalizeUrl(incoming.url));
    }
    async patchSubMeta(id: string, patch: Partial<Subscription>) {
        await this.commitSubs((items) => items.map((sub) => sub.id === id ? { ...sub, ...patch, id: sub.id, url: sub.url, updatedAt: Date.now() } : sub));
    }
    async bulkImportSubs(list: Subscription[]) {
        const added: Subscription[] = [];
        await this.commitSubs((items) => {
            const existing = new Set(items.map((sub) => this.normalizeUrl(sub.url)));
            for (const raw of list) {
                const urlKey = this.normalizeUrl(raw.url);
                if (!urlKey || existing.has(urlKey)) continue;
                const sub = { ...raw, url: raw.url.trim(), updatedAt: Date.now() };
                if (sub.categoryId) {
                    const cat = this.cats.find((c) => c.id === sub.categoryId);
                    sub.categoryName = cat?.name || sub.categoryName;
                }
                items.push(sub);
                added.push(sub);
                existing.add(urlKey);
            }
            return items;
        });
        return added;
    }
    async removeSub(id: string) {
        const deletedUrls: string[] = [];
        await this.commitSubs((items) => {
            items.forEach((s) => { if (s.id === id) deletedUrls.push(this.normalizeUrl(s.url)); });
            if (deletedUrls.length) {
                const now = Date.now();
                this.subStoreMeta.deletedUrls = { ...(this.subStoreMeta.deletedUrls || {}) };
                deletedUrls.forEach((url) => this.subStoreMeta.deletedUrls![url] = now);
            }
            return items.filter((s) => s.id !== id);
        });
        for (const [aid, a] of this.articles) {
            if (a.subscriptionId === id) {
                this.articles.delete(aid);
                this.read.delete(aid);
                this.star.delete(aid);
            }
        }
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        await this.save(KEYS.read, Array.from(this.read));
        await this.save(KEYS.star, Array.from(this.star));
        this.emit();
    }
    async moveSubs(ids: string[], categoryId?: string) {
        const set = new Set(ids);
        const targetCat = categoryId && categoryId !== "c_default" ? this.cats.find((cat) => cat.id === categoryId) : undefined;
        const target = targetCat?.id;
        const now = Date.now();
        await this.commitSubs((items) => items.map((sub) => set.has(sub.id) ? { ...sub, categoryId: target, categoryName: targetCat?.name, updatedAt: now } : sub));
    }
    async removeSubs(ids: string[]) {
        const set = new Set(ids);
        await this.commitSubs((items) => {
            const now = Date.now();
            this.subStoreMeta.deletedUrls = { ...(this.subStoreMeta.deletedUrls || {}) };
            items.forEach((s) => { if (set.has(s.id)) this.subStoreMeta.deletedUrls![this.normalizeUrl(s.url)] = now; });
            return items.filter((s) => !set.has(s.id));
        });
        for (const [aid, a] of this.articles) {
            if (set.has(a.subscriptionId)) {
                this.articles.delete(aid);
                this.read.delete(aid);
                this.star.delete(aid);
            }
        }
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        await this.save(KEYS.read, Array.from(this.read));
        await this.save(KEYS.star, Array.from(this.star));
        this.emit();
    }
    async clearSubscriptions(options: { clearCategories?: boolean } = {}) {
        this.subs = [];
        this.articles.clear();
        this.read.clear();
        this.star.clear();
        await this.commitSubs(() => [], { mergeCurrent: false, emit: false });
        if (options.clearCategories) {
            this.cats = [this.defaultCat()];
            await this.save(KEYS.cats, this.cats);
        }
        await this.save(KEYS.articles, []);
        await this.save(KEYS.read, []);
        await this.save(KEYS.star, []);
        this.emit();
    }

    // ===== cats =====
    getCats() { return [...this.cats].sort((a, b) => a.sortOrder - b.sortOrder); }
    async upsertCat(c: Category) {
        const old = this.cats.find((x) => x.id === c.id);
        const i = this.cats.findIndex((x) => x.id === c.id);
        if (i >= 0) this.cats[i] = c; else this.cats.push(c);
        await this.save(KEYS.cats, this.cats);
        if (old && old.name !== c.name) {
            await this.commitSubs((items) => items.map((sub) => sub.categoryId === c.id ? { ...sub, categoryName: c.name, updatedAt: Date.now() } : sub), { emit: false });
        }
        this.emit();
    }
    async removeCat(id: string) {
        if (this.cats.find((c) => c.id === id)?.builtin) return;
        this.cats = this.cats.filter((c) => c.id !== id);
        await this.save(KEYS.cats, this.cats);
        await this.commitSubs((items) => items.map((s) => s.categoryId === id ? { ...s, categoryId: undefined, categoryName: undefined, updatedAt: Date.now() } : s), { emit: false });
        this.emit();
    }

    // ===== articles =====
    getArticles(sid?: string): Article[] {
        const all = Array.from(this.articles.values());
        const list = sid ? all.filter((a) => a.subscriptionId === sid) : all;
        return list.sort((a, b) => b.pubDate - a.pubDate);
    }
    getArticle(id: string) { return this.articles.get(id); }
    async upsertArticles(list: Omit<Article, "isRead" | "isStarred">[]) {
        for (const incoming of list) {
            const a = incoming as Article;
            const ex = this.articles.get(a.id);
            if (ex) {
                a.isRead = ex.isRead; a.isStarred = ex.isStarred;
                a.savedDocId = ex.savedDocId; a.savedAt = ex.savedAt;
                a.aiResults = a.aiResults || ex.aiResults;
                a.highlights = a.highlights || ex.highlights;
            } else {
                a.isRead = this.read.has(a.id);
                a.isStarred = this.star.has(a.id);
            }
            this.articles.set(a.id, a as Article);
        }
        const removed = this.pruneExpiredArticles(false);
        if (removed) await this.save(KEYS.read, Array.from(this.read));
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }
    private pruneExpiredArticles(emit = true) {
        const days = Number(this.settings.general.articleRetentionDays ?? DEFAULT_SETTINGS.general.articleRetentionDays);
        if (!Number.isFinite(days) || days <= 0) return 0;
        const cutoff = Date.now() - Math.max(1, days) * 86400_000;
        const removed: string[] = [];
        for (const [id, article] of this.articles.entries()) {
            if (article.isStarred || this.star.has(id)) continue;
            const time = article.pubDate || article.fetchedAt || 0;
            if (time && time < cutoff) {
                this.articles.delete(id);
                this.read.delete(id);
                removed.push(id);
            }
        }
        if (removed.length && emit) this.emit();
        return removed.length;
    }
    async cleanupExpiredArticles() {
        const removed = this.pruneExpiredArticles(false);
        if (!removed) return 0;
        await this.save(KEYS.read, Array.from(this.read));
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
        return removed;
    }
    async setRead(id: string, v: boolean) {
        const a = this.articles.get(id); if (!a) return;
        a.isRead = v;
        if (v) this.read.add(id); else this.read.delete(id);
        await this.save(KEYS.read, Array.from(this.read));
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }
    async markRead(ids: string[], v = true) {
        const set = new Set(ids);
        let changed = false;
        for (const id of set) {
            const a = this.articles.get(id);
            if (!a || a.isRead === v) continue;
            a.isRead = v;
            if (v) this.read.add(id); else this.read.delete(id);
            changed = true;
        }
        if (!changed) return;
        await this.save(KEYS.read, Array.from(this.read));
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }
    async setStar(id: string, v: boolean) {
        const a = this.articles.get(id); if (!a) return;
        a.isStarred = v;
        if (v) this.star.add(id); else this.star.delete(id);
        await this.save(KEYS.star, Array.from(this.star));
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }
    async setArticleFullText(id: string, fullText?: string | null) {
        const a = this.articles.get(id);
        if (!a) return;
        if (fullText) {
            a.fullText = fullText;
            a.fullTextState = "fetched";
        } else {
            delete a.fullText;
            delete a.fullTextState;
        }
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }

    async setAIResult(id: string, promptId: string, r: any) {
        const a = this.articles.get(id); if (!a) return;
        if (!a.aiResults) a.aiResults = {};
        a.aiResults[promptId] = r;
        await this.save(KEYS.articles, Array.from(this.articles.values()));
    }
    async setSaved(id: string, docId: string) {
        const a = this.articles.get(id); if (!a) return;
        a.savedDocId = docId; a.savedAt = Date.now();
        await this.save(KEYS.articles, Array.from(this.articles.values()));
    }
    async setTags(id: string, tags: string[]) {
        const a = this.articles.get(id); if (!a) return;
        a.tags = tags;
        await this.save(KEYS.articles, Array.from(this.articles.values()));
    }
    async addHighlight(articleId: string, h: any) {
        const a = this.articles.get(articleId); if (!a) return;
        if (!a.highlights) a.highlights = [];
        a.highlights.push(h);
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }
    async removeHighlight(articleId: string, hid: string) {
        const a = this.articles.get(articleId); if (!a?.highlights) return;
        a.highlights = a.highlights.filter((h) => h.id !== hid);
        await this.save(KEYS.articles, Array.from(this.articles.values()));
        this.emit();
    }

    unreadCount(sid?: string): number {
        let n = 0;
        for (const a of this.articles.values()) {
            if ((!sid || a.subscriptionId === sid) && !a.isRead) n++;
        }
        return n;
    }
    totalUnread(): number { return this.unreadCount(); }

    // ===== settings =====
    getSettings() { return this.settings; }
    async setSettings(s: Settings) {
        this.settings = s;
        await this.save(KEYS.settings, s);
        this.emit();
    }
    updateSettings(patch: Partial<Settings>, options: { emit?: boolean } = {}) {
        this.settings = { ...this.settings, ...patch };
        this.save(KEYS.settings, this.settings);
        if (options.emit !== false) this.emit();
    }
    getAI() { return this.ai; }
    async setAI(a: AISettings) {
        this.ai = a;
        await this.save(KEYS.ai, a);
        this.emit();
    }
    updateAI(patch: Partial<AISettings>) {
        this.ai = { ...this.ai, ...patch };
        this.save(KEYS.ai, this.ai);
        this.emit();
    }
}
