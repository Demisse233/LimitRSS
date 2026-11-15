/**
 * Runtime HTTP client: direct browser fetch with a SiYuan kernel proxy fallback.
 */

import { fetchSyncPost } from "siyuan";
import { createHttpClient } from "./http-core";

export { HttpError, isAbortError, isHttpError, readTransport, withProxyFallback } from "./http-core";
export type { HttpInit, ProxyMode, Transport } from "./http-core";

export const openHttp = createHttpClient({
    fetch: (input, init) => fetch(input, init),
    post: (url, payload) => fetchSyncPost(url, payload),
});
