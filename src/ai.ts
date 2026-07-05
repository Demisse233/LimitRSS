/**
 * AI 服务 - 多提供商 + 流式响应
 */

import { AIProvider, AIProviderType, AIResult, AISettings, Article, PromptTemplate } from "./types";
import { el, escapeHtml } from "./ui";

const MAX_CONTENT = 16000;

export class AIService {
    settings: AISettings;

    constructor(s: AISettings) { this.settings = s; }
    update(s: AISettings) { this.settings = s; }

    providers() { return this.settings.providers.filter((p) => p.enabled); }

    defaultProvider(): AIProvider | undefined {
        if (this.settings.defaultProviderId) {
            const p = this.settings.providers.find((x) => x.id === this.settings.defaultProviderId);
            if (p?.enabled) return p;
        }
        return this.settings.providers.find((p) => p.enabled);
    }

    getPrompt(id: string) { return this.settings.prompts.find((p) => p.id === id); }
    prompts() { return [...this.settings.prompts].sort((a, b) => a.order - b.order); }

    render(tpl: PromptTemplate, a: Article): string {
        const content = (a.content || "").length > MAX_CONTENT
            ? (a.content || "").slice(0, MAX_CONTENT) + "\n[…过长已截断]"
            : (a.content || "");
        // strip HTML
        const tmp = document.createElement("div");
        tmp.innerHTML = content;
        const text = (tmp.textContent || "").replace(/\s+/g, " ").trim();
        return tpl.userPrompt
            .replace(/\{\{title\}\}/g, a.title || "")
            .replace(/\{\{content\}\}/g, text)
            .replace(/\{\{link\}\}/g, a.link || "")
            .replace(/\{\{author\}\}/g, a.author || "未知")
            .replace(/\{\{date\}\}/g, new Date(a.pubDate).toLocaleDateString("zh-CN"))
            .replace(/\{\{source\}\}/g, "")
            .replace(/\{\{description\}\}/g, a.description || "");
    }

    /** 非流式 */
    async chat(article: Article, promptId: string, providerId?: string): Promise<AIResult> {
        const tpl = this.getPrompt(promptId);
        if (!tpl) throw new Error("prompt not found");
        const p = this.resolveProvider(providerId);
        if (!p) throw new Error("no AI provider configured");
        const messages: any[] = [];
        if (tpl.systemPrompt) messages.push({ role: "system", content: tpl.systemPrompt });
        messages.push({ role: "user", content: this.render(tpl, article) });
        const start = Date.now();
        const r = await callProvider(p, messages, false);
        return {
            promptId, promptName: tpl.name, content: r.content, model: r.model,
            providerId: p.id, usage: r.usage, generatedAt: Date.now(), durationMs: Date.now() - start,
        };
    }

    /** 流式 - 实时回调 */
    async stream(article: Article, promptId: string,
        cb: { onChunk: (s: string) => void; onDone: (full: string, usage?: any) => void; onError: (e: Error) => void; signal?: AbortSignal },
        providerId?: string,
    ): Promise<AIResult> {
        const tpl = this.getPrompt(promptId);
        if (!tpl) { cb.onError(new Error("prompt not found")); throw new Error("prompt not found"); }
        return this.streamTemplate(article, tpl, cb, providerId);
    }

    async streamTemplate(article: Article, tpl: PromptTemplate,
        cb: { onChunk: (s: string) => void; onDone: (full: string, usage?: any) => void; onError: (e: Error) => void; signal?: AbortSignal },
        providerId?: string,
    ): Promise<AIResult> {
        return this.streamRenderedTemplate(article, tpl, this.render(tpl, article), cb, providerId);
    }

    async streamRenderedTemplate(article: Article, tpl: PromptTemplate, renderedPrompt: string,
        cb: { onChunk: (s: string) => void; onDone: (full: string, usage?: any) => void; onError: (e: Error) => void; signal?: AbortSignal },
        providerId?: string,
    ): Promise<AIResult> {
        const p = this.resolveProvider(providerId);
        if (!p) { cb.onError(new Error("no provider")); throw new Error("no provider"); }
        const messages: any[] = [];
        if (tpl.systemPrompt) messages.push({ role: "system", content: tpl.systemPrompt });
        messages.push({ role: "user", content: renderedPrompt });
        const start = Date.now();
        try {
            const r = await callProvider(p, messages, true, cb.onChunk, cb.signal);
            cb.onDone(r.content, r.usage);
            return {
                promptId: tpl.id, promptName: tpl.name, content: r.content, model: r.model,
                providerId: p.id, usage: r.usage, generatedAt: Date.now(),
                durationMs: Date.now() - start, streamed: true,
            };
        } catch (e) { cb.onError(e as Error); throw e; }
    }

    private resolveProvider(id?: string): AIProvider | undefined {
        if (id) {
            const p = this.settings.providers.find((x) => x.id === id);
            if (p?.enabled) return p;
        }
        return this.defaultProvider();
    }

    /** 测试连通性 */
    async test(p: AIProvider): Promise<{ ok: boolean; msg: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            const r = await callProvider({ ...p, enabled: true }, [{ role: "user", content: "PONG" }], false);
            return { ok: true, msg: r.content.slice(0, 80), latencyMs: Date.now() - start };
        } catch (e) { return { ok: false, msg: (e as Error).message }; }
    }

    async listModels(p: AIProvider): Promise<string[]> {
        if (!p.endpoint) throw new Error("请先填写 Endpoint");
        if (p.type === "anthropic") throw new Error("当前只支持 OpenAI 兼容接口自动获取模型");
        return listOpenAICompatibleModels(p);
    }
}

// =============== Provider 适配 ===============

interface ChatResult { content: string; model: string; usage?: any }

async function listOpenAICompatibleModels(p: AIProvider): Promise<string[]> {
    const url = `${(p.endpoint || "").replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (p.apiKey) headers["Authorization"] = `Bearer ${p.apiKey}`;
    const resp = await fetch(url, { method: "GET", headers });
    if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200) || resp.statusText}`);
    }
    const data: any = await resp.json();
    const raw = Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.models) ? data.models
            : Array.isArray(data) ? data
                : [];
    const ids: string[] = raw
        .map((item: any) => typeof item === "string" ? item : item?.id || item?.name || item?.model)
        .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id: string) => id.trim());
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

async function callProvider(
    p: AIProvider, messages: any[], stream: boolean,
    onChunk?: (s: string) => void, signal?: AbortSignal,
): Promise<ChatResult> {
    if (p.type === "anthropic") return callAnthropic(p, messages, stream, onChunk, signal);
    return callOpenAICompatible(p, messages, stream, onChunk, signal);
}

async function callOpenAICompatible(
    p: AIProvider, messages: any[], stream: boolean,
    onChunk?: (s: string) => void, signal?: AbortSignal,
): Promise<ChatResult> {
    const url = `${(p.endpoint || "").replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (p.apiKey) headers["Authorization"] = `Bearer ${p.apiKey}`;
    const body: any = {
        model: p.model, messages, stream,
        temperature: p.temperature ?? 0.7, max_tokens: p.maxTokens ?? 2048,
    };
    if (stream) body.stream_options = { include_usage: true };
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    if (!stream) {
        const data = await resp.json();
        return {
            content: data.choices?.[0]?.message?.content || "",
            model: data.model || p.model,
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
            } : undefined,
        };
    }
    // SSE 流式
    return parseSSE(resp, p, onChunk);
}

async function parseSSE(resp: Response, p: AIProvider, onChunk?: (s: string) => void): Promise<ChatResult> {
    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", model = p.model, usage: any;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const d = t.slice(5).trim();
            if (d === "[DONE]") continue;
            try {
                const o = JSON.parse(d);
                const delta = o.choices?.[0]?.delta?.content;
                if (delta) { content += delta; onChunk?.(delta); }
                if (o.usage) {
                    usage = {
                        promptTokens: o.usage.prompt_tokens,
                        completionTokens: o.usage.completion_tokens,
                        totalTokens: o.usage.total_tokens,
                    };
                }
                if (o.model) model = o.model;
            } catch { /* skip */ }
        }
    }
    return { content, model, usage };
}

async function callAnthropic(
    p: AIProvider, messages: any[], stream: boolean,
    onChunk?: (s: string) => void, signal?: AbortSignal,
): Promise<ChatResult> {
    const url = `${(p.endpoint || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;
    const sys = messages.find((m) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m) => m.role !== "system");
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": p.apiKey || "",
        "anthropic-version": "2023-06-01",
    };
    const body: any = {
        model: p.model, system: sys,
        messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: p.maxTokens ?? 2048,
        temperature: p.temperature ?? 0.7,
        stream,
    };
    const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    if (!stream) {
        const data = await resp.json();
        return {
            content: data.content?.[0]?.text || "",
            model: data.model || p.model,
            usage: data.usage ? {
                promptTokens: data.usage.input_tokens,
                completionTokens: data.usage.output_tokens,
                totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
            } : undefined,
        };
    }
    // Anthropic SSE
    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", model = p.model;
    let inT = 0, outT = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const d = line.slice(5).trim();
            if (!d) continue;
            try {
                const o = JSON.parse(d);
                if (o.type === "content_block_delta" && o.delta?.text) {
                    content += o.delta.text; onChunk?.(o.delta.text);
                } else if (o.type === "message_start" && o.message?.usage) {
                    inT = o.message.usage.input_tokens || 0;
                } else if (o.type === "message_delta" && o.usage) {
                    outT = o.usage.output_tokens || 0;
                } else if (o.message?.model) {
                    model = o.message.model;
                }
            } catch { /* skip */ }
        }
    }
    return { content, model, usage: { promptTokens: inT, completionTokens: outT, totalTokens: inT + outT } };
}
