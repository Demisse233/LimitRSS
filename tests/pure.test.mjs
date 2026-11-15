import test from "node:test";
import assert from "node:assert/strict";

import {
    normalizeSaveDir,
    buildSavePath,
    sanitizePathSegment,
    notebookIcon,
    dailySignature,
    isEditableElement,
    isHttpUrl,
} from "../.test-dist/util.js";

test("normalizeSaveDir handles empty, relative and repeated separators", () => {
    assert.equal(normalizeSaveDir(""), "/");
    assert.equal(normalizeSaveDir("RSS/2026"), "/RSS/2026");
    assert.equal(normalizeSaveDir("/a//b/"), "/a/b");
    assert.equal(normalizeSaveDir("\\a\\b"), "/a/b");
    assert.equal(normalizeSaveDir("/a/./b"), "/a/b");
});

test("normalizeSaveDir drops traversal segments", () => {
    assert.equal(normalizeSaveDir("../etc"), "/etc");
    assert.equal(normalizeSaveDir("/a/../../b"), "/b");
    assert.equal(normalizeSaveDir("/.."), "/");
});

test("normalizeSaveDir strips characters illegal in file paths", () => {
    assert.equal(normalizeSaveDir("/a:b*c?"), "/a b c");
    assert.equal(normalizeSaveDir('/a<b>c|d"e'), "/a b c d e");
});

test("sanitizePathSegment trims and collapses whitespace", () => {
    assert.equal(sanitizePathSegment("  a   b  "), "a b");
    assert.equal(sanitizePathSegment("a/b:c"), "a b c");
    assert.equal(sanitizePathSegment(""), "");
});

test("buildSavePath combines directory and document name", () => {
    assert.equal(buildSavePath("/", "标题"), "/标题");
    assert.equal(buildSavePath("/RSS", "标题:1"), "/RSS/标题 1");
    assert.equal(buildSavePath("RSS/2026", "  "), "/RSS/2026/untitled");
    assert.equal(buildSavePath("/", "../../x"), "/.. .. x");
});

test("notebookIcon decodes SiYuan hex code points", () => {
    assert.equal(notebookIcon("1f4d3"), "📓");
    assert.equal(notebookIcon("1F600"), "😀");
    assert.equal(notebookIcon("2328-fe0f"), "⌨️");
    assert.equal(notebookIcon("1f4bc"), "💼");
});

test("notebookIcon passes emoji and falls back for empty/custom icons", () => {
    assert.equal(notebookIcon("📚"), "📚");
    assert.equal(notebookIcon(""), "📓");
    assert.equal(notebookIcon(undefined), "📓");
    assert.equal(notebookIcon("iconNotebook"), "📓");
    assert.equal(notebookIcon("AI.png"), "📓");
    assert.equal(notebookIcon("openGauss.png"), "📓");
});

test("dailySignature is order-independent", () => {
    assert.equal(dailySignature(["b", "a", "c"]), dailySignature(["a", "b", "c"]));
    assert.notEqual(dailySignature(["a"]), dailySignature(["a", "b"]));
});

test("isEditableElement ignores shortcuts in form controls", () => {
    assert.equal(isEditableElement(null), false);
    assert.equal(isEditableElement({ tagName: "INPUT" }), true);
    assert.equal(isEditableElement({ tagName: "TEXTAREA" }), true);
    assert.equal(isEditableElement({ tagName: "SELECT" }), true);
    assert.equal(isEditableElement({ tagName: "DIV", isContentEditable: true }), true);
});

test("isEditableElement covers role=textbox, contenteditable and Protyle", () => {
    const roleTextbox = {
        tagName: "DIV",
        getAttribute: (name) => (name === "role" ? "textbox" : null),
    };
    assert.equal(isEditableElement(roleTextbox), true);

    const editable = {
        tagName: "DIV",
        getAttribute: (name) => (name === "contenteditable" ? "true" : null),
    };
    assert.equal(isEditableElement(editable), true);

    const protyle = {
        tagName: "DIV",
        closest: () => ({}),
    };
    assert.equal(isEditableElement(protyle), true);
});

test("isEditableElement allows shortcuts on normal page content", () => {
    assert.equal(isEditableElement({ tagName: "BODY" }), false);
    assert.equal(isEditableElement({ tagName: "DIV", closest: () => null }), false);
});

test("isHttpUrl only accepts http and https URLs", () => {
    assert.equal(isHttpUrl("https://example.com/icon.png"), true);
    assert.equal(isHttpUrl("http://127.0.0.1:8799/icon.png"), true);
    assert.equal(isHttpUrl("  https://example.com/icon.png  "), true);
    assert.equal(isHttpUrl(""), false);
    assert.equal(isHttpUrl("example.com/icon.png"), false);
    assert.equal(isHttpUrl("javascript:alert(1)"), false);
    assert.equal(isHttpUrl("data:image/png;base64,AAAA"), false);
});
