import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { summaryCopyMenuItems } from "../src/aiCardMenu.ts";

const tabSource = readFileSync(fileURLToPath(new URL("../src/tab.ts", import.meta.url)), "utf8");
const selSource = readFileSync(fileURLToPath(new URL("../src/selection.ts", import.meta.url)), "utf8");

test("AI 总结卡片只提供一个“复制文本”菜单项", () => {
    let copied = "";
    const items = summaryCopyMenuItems(() => "总结文本", (text) => { copied = text; });
    assert.equal(items.length, 1);
    assert.equal(items[0].label, "复制文本");
    assert.equal(items[0].icon, "copy");
    items[0].onClick?.();
    assert.equal(copied, "总结文本");
});

test("复制的是点击菜单时的可见文本", () => {
    let text = "第一版";
    let copied = "";
    const items = summaryCopyMenuItems(() => text, (t) => { copied = t; });
    text = "第二版";
    items[0].onClick?.();
    assert.equal(copied, "第二版");
});

test("卡片复制按钮已移除（源码回归）", () => {
    assert.ok(!tabSource.includes("ar-ai-copy-btn"));
    assert.ok(!tabSource.includes("复制 AI 总结文本"));
});

test("桌面右键与手机长按共用 AI 卡片复制菜单（源码回归）", () => {
    assert.ok(selSource.includes("showAICardCopyMenu"));
    assert.ok(selSource.includes("contextmenu"));
});
