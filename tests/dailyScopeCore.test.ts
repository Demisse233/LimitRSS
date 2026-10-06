import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyCategoryToggle,
    applySubToggle,
    categoryCheckState,
    scopePanelNeedsRebuild,
    scopeSummaryLabel,
    selectAll,
    selectNone,
    toggleCategoryExpanded,
} from "../src/dailyScopeCore.ts";

test("toggleCategoryExpanded 翻转展开状态且不修改原集合", () => {
    const original = new Set<string>(["A"]);
    const next = toggleCategoryExpanded(original, "B");
    assert.ok(next.has("A"));
    assert.ok(next.has("B"));
    assert.ok(!original.has("B"));
    const collapsed = toggleCategoryExpanded(next, "A");
    assert.ok(!collapsed.has("A"));
    assert.ok(collapsed.has("B"));
});

test("categoryCheckState 区分全选/部分选/未选", () => {
    const selected = ["a", "b", "c"];
    assert.equal(categoryCheckState(selected, ["a", "b"]), "checked");
    assert.equal(categoryCheckState(selected, ["a", "z"]), "indeterminate");
    assert.equal(categoryCheckState(selected, ["z", "y"]), "unchecked");
    assert.equal(categoryCheckState(selected, []), "unchecked");
});

test("applyCategoryToggle 勾选/取消勾选整组订阅源", () => {
    assert.deepEqual(applyCategoryToggle([], ["a", "b"], true).sort(), ["a", "b"]);
    assert.deepEqual(applyCategoryToggle(["a", "c"], ["a", "b"], false), ["c"]);
});

test("applySubToggle 勾选/取消单个订阅源且去重", () => {
    assert.deepEqual(applySubToggle(["a"], "b", true), ["a", "b"]);
    assert.deepEqual(applySubToggle(["a", "b"], "b", true), ["a", "b"]);
    assert.deepEqual(applySubToggle(["a", "b"], "a", false), ["b"]);
});

test("selectAll / selectNone", () => {
    assert.deepEqual(selectAll(["a", "b"]), ["a", "b"]);
    assert.deepEqual(selectNone(), []);
});

test("scopeSummaryLabel 文案", () => {
    assert.equal(scopeSummaryLabel(0, 0), "（无订阅源）");
    assert.equal(scopeSummaryLabel(3, 3), "全部订阅源");
    assert.equal(scopeSummaryLabel(2, 5), "2 个订阅源");
});

test("scopePanelNeedsRebuild 仅打开面板时重建（展开/勾选必须原地更新）", () => {
    assert.equal(scopePanelNeedsRebuild("open"), true);
    assert.equal(scopePanelNeedsRebuild("toggle-cat"), false);
    assert.equal(scopePanelNeedsRebuild("check"), false);
});
