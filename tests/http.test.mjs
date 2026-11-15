import test from "node:test";
import assert from "node:assert/strict";

import {
    createHttpClient,
    readTransport,
    withProxyFallback,
    HttpError,
} from "../.test-dist/http-core.js";

function jsonResponse(body, status = 200) {
    return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("openHttp uses direct fetch when it succeeds", async () => {
    const calls = [];
    const client = createHttpClient({
        fetch: async (input, init) => {
            calls.push([input, init]);
            return jsonResponse('{"ok":true}');
        },
        post: async () => { throw new Error("proxy must not be called"); },
    });

    const transport = await client("https://api.test/chat", {
        method: "POST",
        headers: { Authorization: "Bearer key" },
        body: '{"model":"m"}',
    });

    assert.equal(transport.kind, "response");
    assert.equal(transport.via, "direct");
    assert.equal(calls.length, 1);
    assert.equal(await transport.response.text(), '{"ok":true}');
});

test("openHttp returns direct HTTP error responses without throwing", async () => {
    const client = createHttpClient({
        fetch: async () => jsonResponse("unauthorized", 401),
        post: async () => { throw new Error("proxy must not be called"); },
    });

    const transport = await client("https://api.test/chat");
    assert.equal(transport.kind, "response");
    assert.equal(transport.response.status, 401);
});

test("openHttp maps forceProxy into the forwardProxy payload", async () => {
    let received;
    const client = createHttpClient({
        fetch: async () => { throw new TypeError("Failed to fetch"); },
        post: async (url, payload) => {
            received = { url, payload };
            return { code: 0, data: { status: 200, body: '{"ok":true}', headers: {} } };
        },
    });

    const transport = await client("https://api.test/chat", {
        method: "POST",
        headers: { Authorization: "Bearer key", "X-Test": "1" },
        body: '{"model":"m","stream":false}',
        forceProxy: true,
        timeoutMs: 1234,
    });

    assert.equal(transport.kind, "buffer");
    assert.equal(transport.via, "proxy");
    assert.equal(transport.status, 200);
    assert.equal(transport.text, '{"ok":true}');
    assert.equal(received.url, "/api/network/forwardProxy");
    assert.equal(received.payload.url, "https://api.test/chat");
    assert.equal(received.payload.method, "POST");
    assert.equal(received.payload.timeout, 1234);
    assert.equal(received.payload.payloadEncoding, "json");
    assert.equal(received.payload.responseEncoding, "text");
    assert.deepEqual(received.payload.headers, [
        { Authorization: "Bearer key" },
        { "X-Test": "1" },
    ]);
    assert.deepEqual(received.payload.payload, { model: "m", stream: false });
});

test("openHttp surfaces proxy HTTP failures as buffer status", async () => {
    const client = createHttpClient({
        fetch: async () => { throw new TypeError("Failed to fetch"); },
        post: async () => ({ code: 0, data: { status: 403, body: "forbidden" } }),
    });

    const transport = await client("https://api.test/models", { forceProxy: true });
    assert.equal(transport.kind, "buffer");
    assert.equal(transport.status, 403);
    assert.equal(transport.text, "forbidden");
});

test("openHttp rejects when the kernel proxy itself fails", async () => {
    const client = createHttpClient({
        fetch: async () => { throw new TypeError("Failed to fetch"); },
        post: async () => ({ code: 1, msg: "proxy disabled" }),
    });

    await assert.rejects(
        client("https://api.test/models", { forceProxy: true }),
        /proxy disabled/,
    );
});

test("openHttp can be aborted while waiting for the kernel proxy", async () => {
    let release;
    const client = createHttpClient({
        fetch: async () => { throw new TypeError("Failed to fetch"); },
        post: () => new Promise((resolve) => { release = resolve; }),
    });
    const controller = new AbortController();
    const pending = client("https://api.test/models", { forceProxy: true, signal: controller.signal });
    controller.abort();

    await assert.rejects(pending, (error) => error.name === "AbortError");
    release?.({ code: 0, data: { status: 200, body: "" } });
});

test("readTransport consumes buffered and streaming transports", async () => {
    const buffered = await readTransport({ kind: "buffer", status: 201, text: "created", via: "proxy" });
    assert.deepEqual(buffered, { status: 201, text: "created" });

    const streamed = await readTransport({ kind: "response", response: jsonResponse("ok", 202), via: "direct" });
    assert.deepEqual(streamed, { status: 202, text: "ok" });
});

test("withProxyFallback retries on network errors in auto mode", async () => {
    const attempts = [];
    const result = await withProxyFallback("auto", async (viaProxy) => {
        attempts.push(viaProxy);
        if (!viaProxy) throw new TypeError("Failed to fetch");
        return "proxied";
    });

    assert.equal(result, "proxied");
    assert.deepEqual(attempts, [false, true]);
});

test("withProxyFallback never retries HTTP errors", async () => {
    let attempts = 0;
    await assert.rejects(
        withProxyFallback("auto", async () => {
            attempts += 1;
            throw new HttpError(401, "unauthorized");
        }),
        HttpError,
    );
    assert.equal(attempts, 1);
});

test("withProxyFallback respects direct and proxy modes", async () => {
    const directAttempts = [];
    await assert.rejects(withProxyFallback("direct", async (viaProxy) => {
        directAttempts.push(viaProxy);
        throw new TypeError("Failed to fetch");
    }));
    assert.deepEqual(directAttempts, [false]);

    const proxyAttempts = [];
    const result = await withProxyFallback("proxy", async (viaProxy) => {
        proxyAttempts.push(viaProxy);
        return "proxy-only";
    });
    assert.equal(result, "proxy-only");
    assert.deepEqual(proxyAttempts, [true]);
});

test("withProxyFallback does not retry aborted requests", async () => {
    let attempts = 0;
    await assert.rejects(
        withProxyFallback("auto", async () => {
            attempts += 1;
            throw new DOMException("Aborted", "AbortError");
        }),
        (error) => error.name === "AbortError",
    );
    assert.equal(attempts, 1);
});
