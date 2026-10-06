/**
 * 日报汇总范围面板的纯逻辑（可在 Node 中直接测试）。
 * 约束：展开/折叠分类与勾选只能原地更新 DOM，绝不能重建面板，否则面板滚动位置会跳回顶部。
 */

export type ScopeCheckState = "checked" | "indeterminate" | "unchecked";
export type ScopePanelRebuildKind = "open" | "toggle-cat" | "check";

/** 翻转某个分类的展开状态，返回新集合，不改动原集合 */
export function toggleCategoryExpanded(expanded: ReadonlySet<string>, label: string): Set<string> {
    const next = new Set(expanded);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    return next;
}

/** 分类复选框状态：全选 / 部分选 / 未选 */
export function categoryCheckState(selected: readonly string[], subIds: readonly string[]): ScopeCheckState {
    if (!subIds.length) return "unchecked";
    const set = new Set(selected);
    let hit = 0;
    for (const id of subIds) {
        if (set.has(id)) hit += 1;
    }
    if (hit === subIds.length) return "checked";
    if (hit > 0) return "indeterminate";
    return "unchecked";
}

/** 勾选/取消勾选整组订阅源 */
export function applyCategoryToggle(selected: readonly string[], subIds: readonly string[], checked: boolean): string[] {
    const set = new Set(selected);
    for (const id of subIds) {
        if (checked) set.add(id);
        else set.delete(id);
    }
    return Array.from(set);
}

/** 勾选/取消勾选单个订阅源 */
export function applySubToggle(selected: readonly string[], id: string, checked: boolean): string[] {
    const set = new Set(selected);
    if (checked) set.add(id);
    else set.delete(id);
    return Array.from(set);
}

export function selectAll(ids: readonly string[]): string[] {
    return Array.from(ids);
}

export function selectNone(): string[] {
    return [];
}

export function scopeSummaryLabel(selectedCount: number, total: number): string {
    if (!total) return "（无订阅源）";
    return selectedCount >= total ? "全部订阅源" : `${selectedCount} 个订阅源`;
}

/** 只有打开面板才允许整体重建；分类展开/折叠与勾选必须原地更新，避免滚动跳顶 */
export function scopePanelNeedsRebuild(kind: ScopePanelRebuildKind): boolean {
    return kind === "open";
}
