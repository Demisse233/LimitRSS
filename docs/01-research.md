# 思源 RSS 插件 — 调研笔记

> 调研时间：2026-07-03  
> 目的：开发一个思源笔记 RSS 订阅插件  
> 调研者：Codex (default mode)

## 1. 思源插件开发规范要点

### 1.1 插件目录结构（来自 `siyuan-note/plugin-sample@0.4.8`）

```
siyuan-rss/
├── plugin.json            # 插件清单（必填）
├── package.json           # npm 配置
├── icon.png               # 160×160 ≤20KB
├── preview.png            # 1024×768 ≤200KB
├── README.md              # 必填
├── README.zh-CN.md        # 推荐
├── src/
│   ├── index.ts           # 前端入口（必须导出默认类继承 Plugin）
│   ├── kernel.ts          # 内核入口（可选，用于后端 RPC）
│   ├── index.scss
│   ├── i18n/
│   │   ├── zh-CN.json     # BCP 47，注意是 - 不是 _
│   │   └── en.json
│   └── declarations.d.ts
├── webpack.config.js          # 前端打包（输出 index.js / index.css）
├── webpack.kernel.config.js   # 内核打包（输出 kernel.js）
└── tsconfig.json
```

### 1.2 `Plugin` 抽象类（来自 `siyuan-note/petal/siyuan.d.ts`）

```ts
abstract class Plugin {
    eventBus: EventBus;
    i18n: IObject;
    kernel: IKernelPlugin;
    data: any;
    displayName: string;
    readonly name: string;
    app: App;
    commands: ICommand[];
    setting: Setting;
    protyleSlash: { ... }[];
    protyleOptions: IProtyleOptions;

    constructor(options: { app, name, i18n });

    // 生命周期
    onload(): void;
    onDataChanged(): void;
    onunload(): void;
    uninstall(): void;
    onLayoutReady(): void;  // v3.3+ 要求 addTopBar/addStatusBar 在此调用

    // UI
    addTopBar(options): HTMLElement;        // 顶栏图标（仅桌面）
    addStatusBar(options): HTMLElement;     // 状态栏
    addTab(options): () => Custom;          // 注册标签页
    addDock(options): { config, model };    // 侧边面板
    addCommand(options): void;              // 命令面板 / 快捷键
    addIcons(svg: string): void;            // 注册 SVG 图标
    addAgentAction(options): string;        // 注册 AI Agent 动作

    // 斜杠菜单
    protyleSlash: { filter, html, id, callback }[];

    // 数据
    loadData(storageName): Promise<any>;
    saveData(storageName, content): Promise<...>;
    removeData(storageName): Promise<...>;

    // 其它
    openSetting(): void;
    getSecret(name): string;
    getVariable(name): string;
    getOpenedTab(): { [k]: Custom[] };
    updateProtyleToolbar(toolbar): string[];  // protyle 工具栏
    updateCards(options): Promise<ICardData>;
    addFloatLayer(options): void;
}
```

### 1.3 `plugin.json` 字段

```json
{
  "name": "siyuan-rss",
  "author": "...",
  "url": "https://github.com/...",
  "version": "0.1.0",
  "minAppVersion": "3.7.0",
  "backends": ["windows", "linux", "darwin", "docker", "android", "ios", "harmony", "all"],
  "frontends": ["desktop", "mobile", "browser-desktop", "browser-mobile", "desktop-window", "all"],
  "disabledInPublish": false,
  "displayName": { "default": "...", "zh-CN": "...", "en": "..." },
  "description": { "default": "...", "zh-CN": "..." },
  "readme": { "default": "README.md", "zh-CN": "README.zh-CN.md" },
  "funding": { "openCollective": "", "patreon": "", "github": "", "custom": [] },
  "keywords": ["..."]
}
```

- `name` 必须和 GitHub 仓库名一致
- 国际化 BCP 47：`zh-CN` 而非旧的 `zh_CN`
- v3.7.0 是 BCP 47 的最低要求版本
- `disabledInPublish: true` 表示发布服务时禁用（可选）

### 1.4 关键内核 API（来自 `siyuan-note/siyuan/API_zh_CN.md`）

| 类别 | 端点 | 用途 |
|------|------|------|
| 笔记本 | `POST /api/notebook/lsNotebooks` | 列笔记本 |
| 笔记本 | `POST /api/notebook/openNotebook` | 打开笔记本 |
| 文档 | `POST /api/filetree/createDocWithMd` | 一键创建带 Markdown 的文档 |
| 文档 | `POST /api/filetree/renameDocByID` | 重命名 |
| 块 | `POST /api/block/insertBlock` | 插入块 |
| 块 | `POST /api/block/prependBlock` | 前置子块 |
| 块 | `POST /api/block/appendBlock` | 后置子块 |
| 块 | `POST /api/block/getBlockKramdown` | 取 kramdown |
| 资源 | `POST /api/asset/upload` | 上传资源 |
| 文件 | `POST /api/file/getFile` | 读 data 下文件 |
| 文件 | `POST /api/file/putFile` | 写 data 下文件 |
| 网络 | `POST /api/network/forwardProxy` | 内核正向代理（绕 CORS） |
| SQL | `POST /api/sqlite/flushTransaction` | 刷事务 |
| 工具 | `POST /api/format/netImg2LocalAssets` | 把远程图片下载到本地 |

### 1.5 关键规范

1. **不要用 `fs` / electron / nodejs API 读写 data 目录**  
   会破坏云同步分块。必须用 `/api/file/*` 接口。
2. **Daily Note 属性**  
   调用 `/api/filetree/createDailyNote` 时会自动加 `custom-dailynote-yyyymmdd`；  
   用 `createDocWithMd` 手动建日记时需要自己加这个属性。
3. **包结构**（`package.zip`）：  
   `i18n/*`、`icon.png`、`index.css`、`index.js`、`plugin.json`、`preview.png`、`README*.md`

## 2. 集市现状

集市中 RSS 相关插件：

- `lnedpaul/siyuan-rss-reader` — v0.1.24，2026-06-01
  - **优点**：功能成熟，31 个内置源，Tab 模式，DOM→MD 转换，深色模式，快捷键
  - **不足**：  
    - 仍用旧版 i18n 命名 `zh_CN`（非 BCP 47）
    - `minAppVersion: 3.3.0`（不能挂新集市）
    - `disabledInPublish: true`
    - 单文件 3500+ 行的巨石，缺少模块化、测试、CI
  - **架构参考价值**：抓取（fetch → forwardProxy 兜底）、保存（createDocWithMd + netImg2LocalAssets）、订阅 / 已读 / 缓存的 `loadData/saveData` 持久化模式

## 3. 关键依赖库

- `siyuan`（官方）— 提供 `Plugin` / `fetchPost` / `fetchSyncPost` / `openTab` / `Dialog` / `Setting` 等
- `dompurify` — HTML 清洗（已有项目用 ^3.x）
- 无需额外 RSS 解析库：浏览器原生 `DOMParser` + `application/xml` 模式

## 4. 已确认的开发环境

- Node ≥ 24（plugin-sample 要求）
- pnpm 11.4+
- TypeScript 6.x（最新 plugin-sample）
- webpack 5
- esbuild-loader 4.x
- 路径：项目位于 `/Users/demisse/个人项目/siyuan-rss/`
