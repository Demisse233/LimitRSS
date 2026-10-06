import { test } from "node:test";
import assert from "node:assert/strict";
import { attachLongPress } from "../src/longPress.ts";

function touchEvent(type: string, x: number, y: number): Event {
    const ev = new Event(type);
    (ev as any).touches = [{ clientX: x, clientY: y }];
    return ev;
}

test("长按超过 600ms 触发一次", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = new EventTarget();
    let fired = 0;
    attachLongPress(target, { onTrigger: () => { fired += 1; } });
    target.dispatchEvent(touchEvent("touchstart", 0, 0));
    assert.equal(fired, 0);
    t.mock.timers.tick(599);
    assert.equal(fired, 0);
    t.mock.timers.tick(1);
    assert.equal(fired, 1);
    t.mock.timers.tick(1000);
    assert.equal(fired, 1);
});

test("提前抬手取消长按", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = new EventTarget();
    let fired = 0;
    attachLongPress(target, { onTrigger: () => { fired += 1; } });
    target.dispatchEvent(touchEvent("touchstart", 0, 0));
    target.dispatchEvent(new Event("touchend"));
    t.mock.timers.tick(1000);
    assert.equal(fired, 0);
});

test("滑动超过 10px 取消长按", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = new EventTarget();
    let fired = 0;
    attachLongPress(target, { onTrigger: () => { fired += 1; } });
    target.dispatchEvent(touchEvent("touchstart", 0, 0));
    target.dispatchEvent(touchEvent("touchmove", 11, 0));
    t.mock.timers.tick(1000);
    assert.equal(fired, 0);
});

test("match 不命中时不启动长按", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = new EventTarget();
    let fired = 0;
    attachLongPress(target, { match: () => false, onTrigger: () => { fired += 1; } });
    target.dispatchEvent(touchEvent("touchstart", 0, 0));
    t.mock.timers.tick(1000);
    assert.equal(fired, 0);
});

test("detach 后不再触发", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = new EventTarget();
    let fired = 0;
    const detach = attachLongPress(target, { onTrigger: () => { fired += 1; } });
    target.dispatchEvent(touchEvent("touchstart", 0, 0));
    detach();
    t.mock.timers.tick(1000);
    assert.equal(fired, 0);
});
