/**
 * AI 服务 - 多提供商 + 流式响应
 *
 * 网络层优先直连；在 Docker / 伺服 / 反向代理等浏览器环境下，直连可能被
 * CORS 或混合内容拦截，此时自动回退到思源内核的 forwardProxy。
 */

import { AIProvider, AIProxyMode, AIResult, AISettings, Article, PromptTemplate } from "./types";
import { HttpError, openHttp, readTransport, withProxyFallback } from "./http";

const MAX_CONTENT = 16000;
const REQUEST_TIMEOUT = 120_000;

/** 本会话内已经确认直连失败的 Endpoint，后续请求直接走内核代理，避免重复消耗额度 */
const proxyEndpoints = new Set<string>();

function endpointKey(p: AIProvider): string {
    return (p.endpoint || "").replace(/\/+$/, "");
}

function effectiveMode(p: AIProvider, mode: AIProxyMode): AIProxyMode {
    return mode === "auto" && endpointKey(p) && proxyEndpoints.has(endpointKey(p)) ? "proxy" : mode;
}

interface StreamCallbacks {
    onChunk: (s: string) => void;
    onDone: (full: string, usage?: any) => void;
    onError: (e: Error) => void;
    signal?: AbortSignal;
    /** 推理模型（如 DeepSeek Reasoner）的 reasoning_content 增量 */
    onReasoning?: (s: string) => void;
}

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

    private proxyMode(): AIProxyMode {
        return this.settings.proxy || "auto";
    }

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
        const r = await callProvider(p, messages, false, undefined, undefined, { mode: this.proxyMode() });
        if (!r.content.trim()) throw new Error("AI 返回了空内容，请检查模型或调大 Max Tokens 后重试。");
        return {
            promptId, promptName: tpl.name, content: r.content, model: r.model,
            providerId: p.id, usage: r.usage, generatedAt: Date.now(), durationMs: Date.now() - start,
            viaProxy: r.viaProxy,
        };
    }

    /** 流式 - 实时回调 */
    async stream(article: Article, promptId: string,
        cb: StreamCallbacks,
        providerId?: string,
        options: { maxTokens?: number; disableThinking?: boolean } = {},
    ): Promise<AIResult> {
        const tpl = this.getPrompt(promptId);
        if (!tpl) { cb.onError(new Error("prompt not found")); throw new Error("prompt not found"); }
        return this.streamTemplate(article, tpl, cb, providerId, options);
    }

    async streamTemplate(article: Article, tpl: PromptTemplate,
        cb: StreamCallbacks,
        providerId?: string,
        options: { maxTokens?: number; disableThinking?: boolean } = {},
    ): Promise<AIResult> {
        return this.streamRenderedTemplate(article, tpl, this.render(tpl, article), cb, providerId, options);
    }

    async streamRenderedTemplate(article: Article, tpl: PromptTemplate, renderedPrompt: string,
        cb: StreamCallbacks,
        providerId?: string,
        options: { maxTokens?: number; disableThinking?: boolean } = {},
    ): Promise<AIResult> {
        const p = this.resolveProvider(providerId);
        if (!p) { cb.onError(new Error("no provider")); throw new Error("no provider"); }
        const messages: any[] = [];
        if (tpl.systemPrompt) messages.push({ role: "system", content: tpl.systemPrompt });
        messages.push({ role: "user", content: renderedPrompt });
        const start = Date.now();
        try {
            const r = await callProvider(p, messages, true, cb.onChunk, cb.signal, {
                mode: this.proxyMode(),
                onReasoning: cb.onReasoning,
                maxTokens: options.maxTokens,
                disableThinking: options.disableThinking,
            });
            if (!r.content.trim()) {
                const detail = r.reasoning?.trim()
                    ? `模型只返回了思考过程（${r.reasoning.length} 字），没有返回正文`
                    : "模型返回了空内容";
                const suffix = r.finishReason === "length" ? "生成已达到 Max Tokens 上限。" : "";
                throw new Error(`${detail}。${suffix}请在 AI 提供商设置中调大 Max Tokens，或更换模型后重试。`);
            }
            cb.onDone(r.content, r.usage);
            return {
                promptId: tpl.id, promptName: tpl.name, content: r.content, model: r.model,
                providerId: p.id, usage: r.usage, generatedAt: Date.now(),
                durationMs: Date.now() - start, streamed: !r.viaProxy,
                viaProxy: r.viaProxy,
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
            const r = await callProvider({ ...p, enabled: true }, [{ role: "user", content: "PONG" }], false, undefined, undefined, { mode: this.proxyMode() });
            return { ok: true, msg: r.content.slice(0, 80), latencyMs: Date.now() - start };
        } catch (e) { return { ok: false, msg: (e as Error).message }; }
    }

    async listModels(p: AIProvider): Promise<string[]> {
        if (!p.endpoint) throw new Error("请先填写 Endpoint");
        if (p.type === "anthropic") throw new Error("当前只支持 OpenAI 兼容接口自动获取模型");
        return listOpenAICompatibleModels(p, this.proxyMode());
    }
}

// =============== Provider 适配 ===============

interface ChatResult {
    content: string;
    model: string;
    usage?: any;
    viaProxy: boolean;
    reasoning?: string;
    finishReason?: string;
}

interface CallOptions {
    mode?: AIProxyMode;
    onReasoning?: (s: string) => void;
    maxTokens?: number;
    /** 日报等长任务可关闭 DeepSeek 思考模式，避免思维链耗尽 Token */
    disableThinking?: boolean;
}

function isDeepSeekProvider(p: AIProvider): boolean {
    // 只对 DeepSeek 官方/自建域名发送 thinking 参数，避免其他兼容服务拒绝未知字段
    return (p.endpoint || "").toLowerCase().includes("deepseek");
}

function parseJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error("AI 返回的内容不是合法 JSON");
    }
}

/**
 * 自动模式下：直连失败（CORS / 混合内容 / DNS / TLS）才走内核代理。
 * 已经拿到 HTTP 错误响应（401、403、500 等）时不再重试，避免重复计费。
 */
const runWithProxyFallback = <T>(mode: AIProxyMode, run: (viaProxy: boolean) => Promise<T>, endpoint?: string) =>
    withProxyFallback(mode, run, (error) => {
        const key = (endpoint || "").replace(/\/+$/, "");
        if (key) proxyEndpoints.add(key);
        console.info("[ai-rss] AI 直连失败，改用思源内核代理：", (error as Error)?.message);
    });

async function listOpenAICompatibleModels(p: AIProvider, mode: AIProxyMode): Promise<string[]> {
    const url = `${(p.endpoint || "").replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (p.apiKey) headers["Authorization"] = `Bearer ${p.apiKey}`;
    return runWithProxyFallback(effectiveMode(p, mode), async (viaProxy) => {
        const transport = await openHttp(url, {
            method: "GET",
            headers,
            forceProxy: viaProxy,
            timeoutMs: REQUEST_TIMEOUT,
        });
        const { status, text } = await readTransport(transport);
        if (status < 200 || status >= 300) throw new HttpError(status, text);
        const data = parseJson(text);
        const raw = Array.isArray(data?.data) ? data.data
            : Array.isArray(data?.models) ? data.models
                : Array.isArray(data) ? data
                    : [];
        const ids: string[] = raw
            .map((item: any) => typeof item === "string" ? item : item?.id || item?.name || item?.model)
            .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id: string) => id.trim());
        return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
    }, p.endpoint);
}

async function callProvider(
    p: AIProvider, messages: any[], stream: boolean,
    onChunk?: (s: string) => void, signal?: AbortSignal, options: CallOptions = {},
): Promise<ChatResult> {
    if (p.type === "anthropic") return callAnthropic(p, messages, stream, onChunk, signal, options);
    return callOpenAICompatible(p, messages, stream, onChunk, signal, options);
}

function openAIResult(data: any, p: AIProvider, viaProxy: boolean): ChatResult {
    const choice = data?.choices?.[0];
    const message = choice?.message;
    return {
        content: message?.content || "",
        model: data?.model || p.model,
        usage: data?.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
        } : undefined,
        viaProxy,
        reasoning: message?.reasoning_content || message?.reasoning || undefined,
        finishReason: choice?.finish_reason,
    };
}

async function callOpenAICompatible(
    p: AIProvider, messages: any[], stream: boolean,
    onChunk?: (s: string) => void, signal?: AbortSignal, options: CallOptions = {},
): Promise<ChatResult> {
    const url = `${(p.endpoint || "").replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (p.apiKey) headers["Authorization"] = `Bearer ${p.apiKey}`;

    return runWithProxyFallback(effectiveMode(p, options.mode || "auto"), async (viaProxy) => {
        const body: any = {
            model: p.model, messages,
            // 内核代理只返回完整响应，不支持 SSE，因此代理模式强制非流式
            stream: stream && !viaProxy,
            temperature: p.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? p.maxTokens ?? 2048,
        };
        if (stream && !viaProxy) body.stream_options = { include_usage: true };
        if (options.disableThinking && isDeepSeekProvider(p)) {
            // DeepSeek 默认开启思考模式；日报这类长任务先关闭，避免思维链吃掉全部 Token
            body.thinking = { type: "disabled" };
        }

        const transport = await openHttp(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
            forceProxy: viaProxy,
            timeoutMs: REQUEST_TIMEOUT,
        });

        if (transport.kind === "response") {
            if (!transport.response.ok) {
                const text = await transport.response.text().catch(() => "");
                throw new HttpError(transport.response.status, text);
            }
            if (stream && !viaProxy) return parseSSE(transport.response, p, onChunk, options.onReasoning);
            const data = await transport.response.json().catch(() => ({}));
            return openAIResult(data, p, false);
        }

        if (transport.status < 200 || transport.status >= 300) {
            throw new HttpError(transport.status, transport.text);
        }
        const result = openAIResult(parseJson(transport.text), p, true);
        // 代理模式没有真流式，生成完成后一次性回填，保持 UI 逻辑不变
        if (stream && result.content) onChunk?.(result.content);
        return result;
    }, p.endpoint);
}

async function parseSSE(
    resp: Response, p: AIProvider,
    onChunk?: (s: string) => void,
    onReasoning?: (s: string) => void,
): Promise<ChatResult> {
    if (!resp.body) throw new Error("AI 响应中没有可读取的流");
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", reasoning = "", finishReason = "", model = p.model, usage: any;
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
            let o: any;
            try {
                o = JSON.parse(d);
            } catch {
                continue;
            }
            if (o?.error?.message) throw new Error(o.error.message);
            const choice = o.choices?.[0];
            const delta = choice?.delta?.content;
            if (delta) { content += delta; onChunk?.(delta); }
            const thought = choice?.delta?.reasoning_content || choice?.delta?.reasoning;
            if (thought) {
                reasoning += thought;
                onReasoning?.(thought);
            }
            if (choice?.finish_reason) finishReason = String(choice.finish_reason);
            if (o.usage) {
                usage = {
                    promptTokens: o.usage.prompt_tokens,
                    completionTokens: o.usage.completion_tokens,
                    totalTokens: o.usage.total_tokens,
                };
            }
            if (o.model) model = o.model;
        }
    }
    return { content, model, usage, viaProxy: false, reasoning, finishReason };
}

function anthropicResult(data: any, p: AIProvider, viaProxy: boolean): ChatResult {
    return {
        content: data?.content?.[0]?.text || "",
        model: data?.model || p.model,
        usage: data?.usage ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        } : undefined,
        viaProxy,
        finishReason: data?.stop_reason,
    };
}

async function callAnthropic(
    p: AIProvider, messages: any[], stream: boolean,
    onChunk?: (s: string) => void, signal?: AbortSignal, options: CallOptions = {},
): Promise<ChatResult> {
    const url = `${(p.endpoint || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;
    const sys = messages.find((m) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m) => m.role !== "system");
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": p.apiKey || "",
        "anthropic-version": "2023-06-01",
    };

    return runWithProxyFallback(effectiveMode(p, options.mode || "auto"), async (viaProxy) => {
        const body: any = {
            model: p.model, system: sys,
            messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: options.maxTokens ?? p.maxTokens ?? 2048,
            temperature: p.temperature ?? 0.7,
            stream: stream && !viaProxy,
        };

        const transport = await openHttp(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal,
            forceProxy: viaProxy,
            timeoutMs: REQUEST_TIMEOUT,
        });

        if (transport.kind === "response") {
            if (!transport.response.ok) {
                const text = await transport.response.text().catch(() => "");
                throw new HttpError(transport.response.status, text);
            }
            if (stream && !viaProxy) return parseAnthropicSSE(transport.response, p, onChunk, options.onReasoning);
            const data = await transport.response.json().catch(() => ({}));
            return anthropicResult(data, p, false);
        }

        if (transport.status < 200 || transport.status >= 300) {
            throw new HttpError(transport.status, transport.text);
        }
        const result = anthropicResult(parseJson(transport.text), p, true);
        if (stream && result.content) onChunk?.(result.content);
        return result;
    }, p.endpoint);
}

async function parseAnthropicSSE(
    resp: Response, p: AIProvider,
    onChunk?: (s: string) => void,
    onReasoning?: (s: string) => void,
): Promise<ChatResult> {
    if (!resp.body) throw new Error("AI 响应中没有可读取的流");
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", reasoning = "", finishReason = "", model = p.model;
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
            let o: any;
            try {
                o = JSON.parse(d);
            } catch {
                continue;
            }
            if (o.type === "content_block_delta" && o.delta?.text) {
                content += o.delta.text; onChunk?.(o.delta.text);
            } else if (o.type === "content_block_delta" && o.delta?.thinking) {
                reasoning += o.delta.thinking;
                onReasoning?.(o.delta.thinking);
            } else if (o.type === "message_start" && o.message?.usage) {
                inT = o.message.usage.input_tokens || 0;
            } else if (o.type === "message_delta") {
                outT = o.usage?.output_tokens || outT;
                if (o.delta?.stop_reason) finishReason = String(o.delta.stop_reason);
            } else if (o.message?.model) {
                model = o.message.model;
            } else if (o?.error?.message) {
                throw new Error(o.error.message);
            }
        }
    }
    return {
        content, model,
        usage: { promptTokens: inT, completionTokens: outT, totalTokens: inT + outT },
        viaProxy: false,
        reasoning,
        finishReason,
    };
}
