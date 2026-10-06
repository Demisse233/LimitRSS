import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanMarkdownLinks, stripMarkdownLinks, stripPluginFrontmatter } from "../src/markdownClean.ts";

const saveSource = readFileSync(fileURLToPath(new URL("../src/save.ts", import.meta.url)), "utf8");

test("cleanMarkdownLinks 保留标签文本并去除链接", () => {
    const md = "正文 [链接文字](https://a.com/x) 结束";
    assert.equal(cleanMarkdownLinks(md), "正文 链接文字 结束");
});

test("cleanMarkdownLinks 保留图片与 keepUrl 指定链接", () => {
    const md = "![图](https://a.com/i.png) [原文](https://x.com/a) [其他](https://b.com)";
    const out = cleanMarkdownLinks(md, { keepUrl: "https://x.com/a" });
    assert.ok(out.includes("![图](https://a.com/i.png)"));
    assert.ok(out.includes("[原文](https://x.com/a)"));
    assert.ok(out.includes("其他"));
    assert.ok(!out.includes("https://b.com"));
});

test("cleanMarkdownLinks 连续链接不残留空标签链接", () => {
    const md = "[↗︎](article:a1)[↗︎](article:a2)。";
    const out = cleanMarkdownLinks(md);
    assert.ok(!out.includes("[](article:"));
    assert.ok(!out.includes("article:"));
    assert.equal(out, "↗︎↗︎。");
});

test("cleanMarkdownLinks 去除 HTML 锚点保留文字", () => {
    assert.equal(cleanMarkdownLinks('<a href="https://a.com">锚点</a> 文本'), "锚点 文本");
});

test("stripMarkdownLinks 移除链接与箭头标记", () => {
    const md = "### [标题](article:x1)\n\n[↗︎](article:x2) 内容";
    const out = stripMarkdownLinks(md);
    assert.ok(out.includes("### 标题"));
    assert.ok(!out.includes("article:"));
    assert.ok(!out.includes("↗︎"));
});

test("stripPluginFrontmatter 去除插件 frontmatter", () => {
    const md = "---\ncustom-ai-rss-source: \ncustom-ai-rss-link: https://x.com\n---\n\n# 标题";
    assert.equal(stripPluginFrontmatter(md), "# 标题");
});

test("stripPluginFrontmatter 保留非插件 frontmatter", () => {
    const md = "---\ntags: note\n---\n\n# 标题";
    assert.equal(stripPluginFrontmatter(md), md);
});

test("htmlToMd 链接输出为标准 Markdown 链接（源码回归）", () => {
    assert.ok(saveSource.includes("[${label}](${href})"));
    assert.ok(!saveSource.includes("inlineToStr(n)}(${href})]"));
});
