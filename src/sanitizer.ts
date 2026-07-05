/**
 * HTML 清洗（DOMPurify）
 */
import DOMPurify from "dompurify";

let configured = false;
function configure() {
    if (configured) return;
    configured = true;
    DOMPurify.setConfig({
        ALLOWED_TAGS: [
            "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
            "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
            "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "main",
            "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strong",
            "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time",
            "tr", "u", "ul", "var", "video", "audio", "source", "iframe",
        ],
        ALLOWED_ATTR: [
            "href", "title", "alt", "src", "srcset", "width", "height", "class", "id",
            "style", "lang", "dir", "colspan", "rowspan", "align", "valign",
            "datetime", "target", "rel", "loading", "data-src", "data-original",
            "aria-label", "role", "controls", "frameborder", "allowfullscreen",
        ],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|ftp|file|data):|#|\/|\.\/|\.\.\/)/i,
        FORBID_TAGS: ["script", "object", "embed", "base", "form"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
    });
}

export function sanitizeHtml(html: string): string {
    configure();
    if (!html) return "";
    return DOMPurify.sanitize(html) as string;
}

export function postProcessLinks(html: string): string {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("a").forEach((a) => {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
    });
    div.querySelectorAll("img").forEach((i) => {
        i.setAttribute("loading", "lazy");
        const src = i.getAttribute("src");
        if (src && !src.startsWith("data:")) i.setAttribute("referrerpolicy", "no-referrer");
    });
    return div.innerHTML;
}

export function prepareForDisplay(html: string): string {
    return postProcessLinks(sanitizeHtml(html));
}
