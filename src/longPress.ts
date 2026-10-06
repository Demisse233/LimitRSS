/**
 * 通用长按（触摸）控制器：按下 delay 毫秒后触发，滑动超过容差或提前抬手则取消。
 * 纯逻辑实现，可在 Node 中配合 mock.timers 测试。
 */

export interface LongPressOptions {
    /** 长按触发延迟，默认 600ms */
    delay?: number;
    /** 移动容差，默认 10px */
    moveTolerance?: number;
    /** 按下时先判断是否命中目标，false 则不启动计时 */
    match?: (target: EventTarget | null) => boolean;
    onTrigger: (ev: Event) => void;
}

/** 挂载长按监听，返回卸载函数 */
export function attachLongPress(target: EventTarget, opts: LongPressOptions): () => void {
    const delay = opts.delay ?? 600;
    const tolerance = opts.moveTolerance ?? 10;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const onStart = (ev: Event) => {
        if (opts.match && !opts.match(ev.target)) return;
        const t = (ev as TouchEvent).touches?.[0];
        startX = t?.clientX ?? 0;
        startY = t?.clientY ?? 0;
        clearTimer();
        timer = setTimeout(() => {
            timer = null;
            opts.onTrigger(ev);
        }, delay);
    };

    const onMove = (ev: Event) => {
        if (timer === null) return;
        const t = (ev as TouchEvent).touches?.[0];
        if (t && (Math.abs(t.clientX - startX) > tolerance || Math.abs(t.clientY - startY) > tolerance)) {
            clearTimer();
        }
    };

    const onEnd = () => clearTimer();

    target.addEventListener("touchstart", onStart, { passive: true });
    target.addEventListener("touchmove", onMove, { passive: true });
    target.addEventListener("touchend", onEnd);
    target.addEventListener("touchcancel", onEnd);

    return () => {
        clearTimer();
        target.removeEventListener("touchstart", onStart);
        target.removeEventListener("touchmove", onMove);
        target.removeEventListener("touchend", onEnd);
        target.removeEventListener("touchcancel", onEnd);
    };
}
