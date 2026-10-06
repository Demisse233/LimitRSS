import { test } from "node:test";
import assert from "node:assert/strict";
import {
    articleSetHash,
    buildDeepDiveBatches,
    buildDeepDivePrompt,
    buildPanoramaPrompt,
    composeFinalReport,
    fallbackSelect,
    mapBatchCitations,
    mapChunkCitations,
    normalizeDeepBatchMarkdown,
    runWithConcurrency,
    selectTopArticles,
    splitPanoramaArticles,
    stripCitationMarkers,
    stripSelectionSection,
} from "../src/dailyReportCore.ts";

test("buildPanoramaPrompt 每篇一行紧凑元数据且相同标题去重", () => {
    const arts = [
        { id: "a1", title: "标题 A", source: "源1", category: "科技" },
        { id: "a2", title: "标题 A ", source: "源2", category: "科技" },
        { id: "a3", title: "标题 B", source: "源3", category: "财经" },
    ];
    const p = buildPanoramaPrompt("2026-08-07", arts);
    assert.equal(p.lineCount, 2);
    assert.ok(p.prompt.includes("编号：1"));
    assert.ok(p.prompt.includes("编号：3"));
    assert.ok(p.prompt.includes("标题 B"));
    assert.ok(p.estimateChars > 0);
});

test("splitPanoramaArticles 超长时按字符切块且不丢文章", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
        id: `a${i}`, title: `标题${i}`, source: "源", category: "分类",
    }));
    const chunks = splitPanoramaArticles(many, 100);
    assert.ok(chunks.length >= 2);
    assert.deepEqual(chunks.flat().map((a) => a.id), many.map((a) => a.id));
});

test("selectTopArticles 解析多种编号格式并忽略非法/元数据行", () => {
    const arts = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`, title: `T${i}`, source: "源", category: "分类",
    }));
    const text = [
        "- 3 重点关注",
        "12. 超出范围",
        "[5]",
        "编号：7 | 分类：x | 来源：y | 标题：z",
        "99",
    ].join("\n");
    const sel = selectTopArticles(text, arts, 3);
    assert.deepEqual(sel.map((a) => a.id), ["a2", "a4"]);
});

test("selectTopArticles 空结果时回退为分类均匀抽样", () => {
    const arts = Array.from({ length: 8 }, (_, i) => ({
        id: `a${i}`, title: `T${i}`, source: "源", category: i % 2 ? "B" : "A",
    }));
    const sel = selectTopArticles("没有任何编号的正文", arts, 5);
    assert.ok(sel.length > 0);
    assert.ok(sel.length <= 5);
});

test("selectTopArticles 优先解析「值得深读」小节而非正文引用", () => {
    const arts = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`, title: `T${i}`, source: "源", category: "分类",
    }));
    const text = [
        "今日科技热点 [1][2] 值得关注。",
        "",
        "## 值得深读的文章编号",
        "- 5",
        "- 7",
    ].join("\n");
    const sel = selectTopArticles(text, arts, 5);
    assert.deepEqual(sel.map((a) => a.id), ["a4", "a6"]);
});

test("selectTopArticles 支持小节标题行内编号", () => {
    const arts = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`, title: `T${i}`, source: "源", category: "分类",
    }));
    const text = "值得深读：3、8";
    assert.deepEqual(selectTopArticles(text, arts, 5).map((a) => a.id), ["a2", "a7"]);
});

test("stripSelectionSection 移除编号小节且保留正文", () => {
    const text = [
        "## 今日速览",
        "科技板块活跃 [1]。",
        "",
        "## 值得深读的文章编号",
        "- 1",
        "- 2",
    ].join("\n");
    const stripped = stripSelectionSection(text);
    assert.ok(stripped.includes("科技板块活跃"));
    assert.ok(!stripped.includes("值得深读"));
    assert.ok(!stripped.includes("- 2"));
});

test("stripCitationMarkers 移除正文中的引用编号", () => {
    assert.equal(stripCitationMarkers("热点 [1][2] 关注 [5]"), "热点  关注 ");
    assert.equal(stripCitationMarkers("无编号"), "无编号");
});

test("mapChunkCitations 按分块本地编号映射链接", () => {
    const chunk = [
        { id: "x1", title: "t", source: "s", category: "c" },
        { id: "x2", title: "t", source: "s", category: "c" },
    ];
    assert.equal(mapChunkCitations("热点 [2] 与 [1]", chunk), "热点 [↗︎](article:x2) 与 [↗︎](article:x1)");
});

test("normalizeDeepBatchMarkdown 生成标题链接小标题并去除裸编号", () => {
    const batch = [
        { id: "a1", title: "文章一" },
        { id: "a2", title: "文章二" },
        { id: "a3", title: "文章三" },
    ];
    const md = normalizeDeepBatchMarkdown(
        "[1] 摘要内容一\n\n[2] 标题：文章二\n摘要内容二",
        batch,
    );
    assert.ok(md.includes("### [文章一](article:a1)"));
    assert.ok(md.includes("### [文章二](article:a2)"));
    assert.ok(md.includes("摘要内容一"));
    assert.ok(md.includes("摘要内容二"));
    assert.ok(!md.includes("[1]"));
    assert.ok(!md.includes("标题：文章二"));
});

test("normalizeDeepBatchMarkdown 无编号标记时保留原文", () => {
    assert.equal(normalizeDeepBatchMarkdown("普通文本", [{ id: "a1", title: "t" }]), "普通文本");
});

test("fallbackSelect 确定性且覆盖多个分类", () => {
    const mixed = [
        { id: "a", title: "a", source: "s", category: "A" },
        { id: "b", title: "b", source: "s", category: "B" },
        { id: "c", title: "c", source: "s", category: "A" },
        { id: "d", title: "d", source: "s", category: "B" },
    ];
    assert.deepEqual(fallbackSelect(mixed, 2).map((a) => a.id).sort(), ["a", "b"]);
});

test("buildDeepDiveBatches 按批次大小切分", () => {
    assert.deepEqual(buildDeepDiveBatches([1, 2, 3, 4, 5], 2).map((b) => b.length), [2, 2, 1]);
    assert.deepEqual(buildDeepDiveBatches([1, 2, 3], 0).flat(), [1, 2, 3]);
});

test("buildDeepDivePrompt 包含批次信息与文章内容", () => {
    const batch = [{
        id: "x1", title: "文章一", source: "源", category: "科技",
        link: "https://example.com/1", description: "这是摘要内容",
    }];
    const p = buildDeepDivePrompt("2026-08-07", batch, 0);
    assert.ok(p.includes("第 1 批"));
    assert.ok(p.includes("文章一"));
    assert.ok(p.includes("这是摘要内容"));
});

test("mapBatchCitations 把批次内编号映射为文章链接", () => {
    const batch = [
        { id: "x1", title: "t", source: "s", category: "c" },
        { id: "x2", title: "t", source: "s", category: "c" },
        { id: "x3", title: "t", source: "s", category: "c" },
    ];
    assert.equal(mapBatchCitations("[1] 标题", batch), "[↗︎](article:x1) 标题");
    assert.equal(mapBatchCitations("跳过 [9]", batch), "跳过 [9]");
});

test("composeFinalReport 拼接全景、深读与跳过提示", () => {
    const md = composeFinalReport(
        "全景内容",
        [{ articles: [{ id: "x2" }], markdown: "### [文章二](article:x2)\n\n摘要正文" }],
        { skipped: ["x9"] },
    );
    assert.ok(md.includes("## 今日速览"));
    assert.ok(md.includes("## 重点文章摘要"));
    assert.ok(md.includes("### [文章二](article:x2)"));
    assert.ok(!md.includes("值得深读的文章编号"));
    assert.ok(md.includes("1 篇文章深读失败已跳过"));
});

test("composeFinalReport 去除全景中重复的今日速览标题", () => {
    const md = composeFinalReport("## 今日速览\n\n内容 [1]", []);
    const count = (md.match(/## 今日速览/g) || []).length;
    assert.equal(count, 1);
    assert.ok(md.includes("内容 [1]"));
});

test("articleSetHash 与顺序无关且集合不同则不同", () => {
    assert.equal(articleSetHash([{ id: "b" }, { id: "a" }]), articleSetHash([{ id: "a" }, { id: "b" }]));
    assert.notEqual(articleSetHash([{ id: "a" }]), articleSetHash([{ id: "b" }]));
});

test("runWithConcurrency 全部执行且并发受限", async () => {
    let active = 0;
    let maxActive = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (v) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return v * 2;
    });
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
    assert.ok(maxActive <= 2);
});
