import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createPathsMemory,
    mergeNotebookPaths,
    pathForNotebook,
    type NotebookPaths,
} from "../src/saveTargetStore.ts";

test("mergeNotebookPaths 按笔记本记录路径且不丢其他笔记本", () => {
    const one = mergeNotebookPaths(undefined, "nb1", "/a/b");
    assert.deepEqual(one, { nb1: "/a/b" });
    const two = mergeNotebookPaths(one, "nb2", "/c");
    assert.deepEqual(two, { nb1: "/a/b", nb2: "/c" });
    assert.deepEqual(one, { nb1: "/a/b" }); // 原对象不可变
});

test("mergeNotebookPaths 空路径删除该笔记本记录", () => {
    const withPath: NotebookPaths = { nb1: "/a", nb2: "/b" };
    assert.deepEqual(mergeNotebookPaths(withPath, "nb1", ""), { nb2: "/b" });
});

test("pathForNotebook 返回该笔记本路径或缺省回退", () => {
    const paths: NotebookPaths = { nb1: "/a" };
    assert.equal(pathForNotebook(paths, "nb1", "/fallback"), "/a");
    assert.equal(pathForNotebook(paths, "nb2", "/fallback"), "/fallback");
    assert.equal(pathForNotebook(undefined, "nb2", "/fallback"), "/fallback");
    assert.equal(pathForNotebook({ nb1: "" }, "nb1", "/fallback"), "/fallback");
});

test("createPathsMemory 读写、切换与回退", () => {
    let stored: NotebookPaths | undefined = undefined;
    const memory = createPathsMemory(() => stored, (p) => { stored = p; });
    assert.equal(memory.get("nb1", "/fb"), "/fb");
    memory.remember("nb1", "/a");
    memory.remember("nb2", "/b");
    assert.equal(memory.get("nb1", "/fb"), "/a");
    assert.equal(memory.get("nb2", "/fb"), "/b");
    memory.remember("nb1", "");
    assert.equal(memory.get("nb1", "/fb"), "/fb");
    assert.equal(memory.get("nb2", "/fb"), "/b");
});
