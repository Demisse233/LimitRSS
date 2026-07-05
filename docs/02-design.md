# LimitRSS — 设计稿（已实现）

> 思源笔记 AI RSS 阅读器
> 版本：v0.1.0  
> 日期：2026-07-03  
> 状态：已实现并构建通过

## 1. 定位

- **差异化**：相比集市现有的 `siyuan-rss-reader`，本插件主打 **AI 驱动 + 知识网络**
- **多提供商 AI**：OpenAI / Anthropic / DeepSeek / 智谱 GLM / Groq / Mistral / Ollama / 自定义
- **架构现代化**：分层（domain / application / adapter / features / ui），不照搬 lnedpaul

## 2. 原创特色（不依赖现有项目）

### 2.1 AI 能力（11 个原创 prompt）
- 📋 **结构化总结** - 1 句话 + 核心论点 + 关键论据 + 适用读者
- 💡 **关键观点** - 提取作者核心论点（独立 prompt）
- 🤔 **三个问题** - 批判性阅读：回答了 / 没回答 / 引出了什么问题
- 🌐 **翻译成中文** - 保留链接和专有名词
- ✅ **可执行项** - 把文章转化为行动清单
- 🧭 **思维导图** - Mermaid 语法
- 🔍 **实体抽取** - 人/地/产品/概念/组织（JSON 输出，可链接到思源笔记）
- 🔗 **联想与延伸** - 推荐相关阅读 + 思考实验
- 📰 **主题日报** - 批量文章聚合
- 🏷️ **智能标签** - 简洁标签生成
- 🧒 **大白话解释** - 5 岁小孩都能懂

### 2.2 流式 AI 响应（SSE）
- 实时显示 token 流入
- 可随时取消
- 显示 token 用量与耗时
- 不阻塞 UI

### 2.3 AI Chat 模式（与你的 RSS 对话）
- 不同于"读文章"的另一种用法
- 上下文自动注入相关订阅文章
- 多轮对话
- 自动起标题
- 切换提供商
- 引用管理

### 2.4 TTS 朗读
- 浏览器原生 SpeechSynthesis
- 选语言/语速/音调
- 句级进度
- 暂停/继续

### 2.5 高亮与批注
- 选中文本加批注
- 4 色色阶
- 高亮列表
- 全文搜索高亮
- 一键导出为 Markdown

### 2.6 实体抽取与链接
- AI 自动抽取人名/地名/产品/概念/组织
- 在思源里搜索已有笔记
- 一键创建实体笔记（自动加 custom-ai-rss-* 属性）
- 实体点击跳转

### 2.7 阅读时长统计
- 自动追踪每篇文章阅读时长
- 连续天数（streak）
- 标签分布
- 主题分布

### 2.8 增量抓取
- ETag / Last-Modified 支持
- 304 跳过正文
- 失败重试

## 3. 技术架构（hexagonal / ports & adapters）

```
src/
├── core/
│   ├── domain/            # 纯领域（无 UI / 无 siyuan 依赖）
│   │   ├── models.ts      # 实体、值对象
│   │   ├── defaults.ts    # 默认值
│   │   └── featured-feeds.ts  # 原创精选源
│   ├── application/       # 业务逻辑
│   │   ├── ai-service.ts  # AI 编排（流式/回退/缓存）
│   │   ├── fetcher.ts     # fetch + forwardProxy
│   │   ├── rss-parser.ts  # RSS 2.0 / Atom 解析
│   │   ├── sanitizer.ts   # DOMPurify 包装
│   │   ├── readability.ts # 简易 Readability
│   │   ├── html-to-md.ts  # HTML→MD / MD→HTML
│   │   └── opml.ts        # 2.0 导入导出
│   └── adapter/           # 外部适配
│       ├── storage.ts     # siyuan loadData/saveData 适配
│       └── ai-provider.ts # 多提供商适配（含流式）
├── features/              # 特色功能
│   ├── tts/               # TTS 服务
│   ├── highlights/        # 高亮批注
│   ├── chat/              # AI 对话
│   ├── entities/          # 实体抽取
│   └── analytics/         # 阅读统计（内嵌于 storage）
├── ui/
│   ├── tab/               # 主 3 栏
│   ├── ai-panel/          # AI Chat 视图
│   ├── components/        # 通用组件
│   ├── settings/          # 设置面板
│   ├── dialogs/           # 弹窗
│   └── styles/            # SCSS
├── utils/                 # 工具
├── i18n/                  # zh-CN, en
├── index.ts               # 入口
├── index.scss
└── declarations.d.ts
```

## 4. 持久化（不与 lnedpaul 重复）

| Key | 内容 |
|---|---|
| `ai_rss_subscriptions` | 订阅列表 |
| `ai_rss_categories` | 分类 |
| `ai_rss_articles` | 文章（含 AI 结果 / 高亮 / 实体 / 阅读时长） |
| `ai_rss_read_status` | 已读标记 |
| `ai_rss_star_status` | 星标 |
| `ai_rss_ai_settings` | AI 提供商 & 提示词 |
| `ai_rss_settings` | 通用设置（含 TTS / 阅读时长） |
| `ai_rss_token_usage` | 用量统计 |
| `ai_rss_highlights` | 高亮（嵌入 article） |
| `ai_rss_reading_stats` | 阅读统计 |
| `ai_rss_chat_sessions` | AI 对话会话 |

## 5. 配色（避免抄袭 Folo）

主色变量：
- `--ai-rss-accent`：跟随思源主色（默认 `#6366f1`）
- `--ai-rss-ai`：`#8b5cf6`（紫色，专属 AI 元素）
- `--ai-rss-success/warning/error` 状态色

## 6. 上架集市

- v0.1.0 发布时，PR 到 `siyuan-note/bazaar` 修改 `plugins.txt`，加入 `Demisse233/LimitRSS`
- minAppVersion: 3.7.0（BCP 47 i18n 要求）

## 7. 构建产物

```
dist/
├── icon.png
├── index.css        (50KB)
├── index.js         (178KB)
├── i18n/
├── plugin.json
├── preview.png
└── README*.md
```

压缩后 `package.zip` 约 88KB。
