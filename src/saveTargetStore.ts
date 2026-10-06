/**
 * 保存目标“笔记本 → 路径”记忆的纯逻辑（可在 Node 中测试）。
 * 数据随插件设置持久化（Settings.save.pathsByNotebook），桌面与手机端一致。
 */

export type NotebookPaths = Record<string, string>;

/** 记录某笔记本的路径；空值删除该记录；返回新对象，不改动原数据 */
export function mergeNotebookPaths(paths: NotebookPaths | undefined, notebook: string, path: string): NotebookPaths {
    const next: NotebookPaths = { ...(paths || {}) };
    if (path) next[notebook] = path;
    else delete next[notebook];
    return next;
}

/** 读取某笔记本路径；无记录或空串时回退默认值 */
export function pathForNotebook(paths: NotebookPaths | undefined, notebook: string, fallback: string): string {
    const v = paths?.[notebook];
    return v ? v : fallback;
}

export interface PathMemory {
    get(notebook: string, fallback: string): string;
    remember(notebook: string, path: string): void;
}

/** 由“读取当前设置 + 写回设置”构造路径记忆适配器 */
export function createPathsMemory(
    getPaths: () => NotebookPaths | undefined,
    onPathsChange: (paths: NotebookPaths) => void,
): PathMemory {
    return {
        get: (notebook, fallback) => pathForNotebook(getPaths(), notebook, fallback),
        remember: (notebook, path) => onPathsChange(mergeNotebookPaths(getPaths(), notebook, path)),
    };
}
