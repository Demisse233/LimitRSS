/**
 * HTTP transport used by AI requests.
 *
 * This module is intentionally free of `siyuan` and DOM-only imports so it can
 * be unit-tested in Node. `http.ts` wires it to the real runtime.
 */

export class HttpError extends Error {
    status: number;
    body: string;

    constructor(status: number, body: string) {
        super(`HTTP ${status}: ${body.slice(0, 200)}`);
        this.name = "HttpError";
        this.status = status;
        this.body = body;
    }
}

export interface HttpInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Skip the direct fetch and go straight to the kernel forward proxy. */
    forceProxy?: boolean;
}

export type Transport =
    | { kind: "response"; response: Response; via: "direct" }
    | { kind: "buffer"; status: number; text: string; via: "proxy" };

export interface HttpDeps {
    fetch: (input: string, init: RequestInit) => Promise<Response>;
    /** Wrapper around SiYuan's fetchSyncPost("/api/network/forwardProxy", ...). */
    post: (url: string, payload: unknown) => Promise<any>;
}

export type ProxyMode = "auto" | "direct" | "proxy";

export function isAbortError(error: unknown): boolean {
    return !!error && (error as { name?: string }).name === "AbortError";
}

export function isHttpError(error: unknown): error is HttpError {
    return error instanceof HttpError;
}

/**
 * auto 模式下直连失败（CORS / 混合内容 / DNS / TLS）才走内核代理。
 * 已经拿到 HTTP 错误响应（401、403、500 等）时不再重试，避免重复计费。
 */
export async function withProxyFallback<T>(
    mode: ProxyMode,
    run: (viaProxy: boolean) => Promise<T>,
    onFallback?: (error: unknown) => void,
): Promise<T> {
    if (mode === "proxy") return run(true);
    try {
        return await run(false);
    } catch (error) {
        if (mode === "direct" || isAbortError(error) || isHttpError(error)) throw error;
        onFallback?.(error);
        return run(true);
    }
}

function parseJsonOrRaw(body?: string): unknown {
    if (body == null || body === "") return undefined;
    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

function headersToArray(headers: Record<string, string> = {}) {
    return Object.entries(headers).map(([key, value]) => ({ [key]: value }));
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

/**
 * Build an `openHttp` function with injected dependencies.
 *
 * Direct fetch errors are thrown so the caller can decide whether to retry via
 * the kernel proxy. HTTP error *responses* are returned as-is (status >= 400)
 * so an auth failure is never mistaken for a CORS failure and retried.
 */
export function createHttpClient(deps: HttpDeps) {
    return async function openHttp(url: string, init: HttpInit = {}): Promise<Transport> {
        if (!init.forceProxy) {
            const response = await deps.fetch(url, {
                method: init.method || "GET",
                headers: init.headers,
                body: init.body,
                signal: init.signal,
            });
            return { kind: "response", response, via: "direct" };
        }

        const result: any = await raceAbort(deps.post("/api/network/forwardProxy", {
            url,
            method: init.method || "GET",
            timeout: init.timeoutMs ?? 120_000,
            contentType: "application/json",
            headers: headersToArray(init.headers),
            payload: parseJsonOrRaw(init.body),
            payloadEncoding: "json",
            responseEncoding: "text",
        }), init.signal);

        if (!result || result.code !== 0) {
            throw new Error(result?.msg || "思源内核代理请求失败");
        }

        return {
            kind: "buffer",
            status: Number(result.data?.status) || 0,
            text: String(result.data?.body ?? ""),
            via: "proxy",
        };
    };
}

export async function readTransport(transport: Transport): Promise<{ status: number; text: string }> {
    if (transport.kind === "buffer") return { status: transport.status, text: transport.text };
    return { status: transport.response.status, text: await transport.response.text() };
}
