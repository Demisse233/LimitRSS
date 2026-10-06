/**
 * AI 总结卡片长按菜单（纯逻辑，可在 Node 中测试）。
 */
import type { DropdownItem } from "./components";

/** 长按 AI 总结卡片：提供“复制文本”，复制卡片可见文本 */
export function summaryCopyMenuItems(
    getText: () => string,
    copy: (text: string) => void,
): DropdownItem[] {
    return [
        {
            label: "复制文本",
            icon: "copy",
            onClick: () => copy(getText()),
        },
    ];
}
