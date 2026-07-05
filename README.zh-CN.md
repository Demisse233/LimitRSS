# LimitRSS · 思源笔记 AI RSS 阅读器

> 打破信息获取与知识内化的壁垒。订阅、阅读、让 AI 帮你总结、翻译，把文章变成你的知识库。

[English](./README.en.md) · [反馈问题](https://github.com/Demisse233/LimitRSS/issues) · [功能建议](https://github.com/Demisse233/LimitRSS/issues)

## 核心特性

### 基础
- **完整 RSS / Atom 支持**：订阅、分类、刷新、错误处理
- **OPML 导入导出**：从其它阅读器迁移、备份
- **星标 / 已读 / 未读**：标记重要文章、自动已读
- **搜索与筛选**：全文搜索、按状态和来源筛选
- **分类管理**：自定义分类、配色、排序
- **主题跟随**：自动适配思源的亮色与暗色主题

### AI 能力（用户自配）
- **通用 OpenAI 兼容接口**：配置 Endpoint、API Key 和模型即可使用
- **AI 总结**：把文章总结成一段话，直接插入正文顶部
- **AI 翻译**：保留原文结构，支持流式替换翻译
- **AI 日报**：按日期聚合文章，生成分类摘要并附文章跳转
- **自定义提示词**：用 `{{title}}`、`{{content}}` 等变量编写模板

### 保存到思源
- **一键保存**：把文章转成思源文档，支持模板
- **自动属性**：写来源、原文链接、自定义标签到块属性
- **图片本地化**：远程图片下载到本地资源
- **多笔记本**：选择保存到哪个笔记本
- **模板系统**：自定义输出格式

### 快捷键
| 键 | 操作 |
|---|---|
| `J` / `K` | 下一篇 / 上一篇 |
| `M` | 切换已读/未读 |
| `S` | 切换星标 |
| `O` | 打开原文 |
| `⌘S` | 保存到思源 |
| `R` | 刷新 |
| `⌘F` | 搜索 |
| `I` | 切换 AI 面板 |
| `?` | 显示帮助 |

## 安装

### 从集市（推荐）
1. 打开思源 → 设置 → 集市
2. 搜索 "LimitRSS"
3. 点击安装

### 手动安装
1. 从 [Releases](https://github.com/Demisse233/LimitRSS/releases) 下载最新 `package.zip`
2. 解压到 `{工作空间}/data/plugins/LimitRSS/`
3. 重启思源或重新加载插件

### 从源码
```bash
git clone https://github.com/Demisse233/LimitRSS.git
cd LimitRSS
npm install
npm run dev      # 监听模式
# 或
npm run build    # 生产构建
```
将 `dist/` 目录复制到 `{工作空间}/data/plugins/LimitRSS/`。

## 配置

### 配置 AI 提供商
1. 点击侧栏底部的设置按钮
2. 进入 **AI 提供商** 面板
3. 添加或展开通用提供商
4. 填入 Endpoint、API Key、模型等参数
5. 点击 **测试** 验证连通
6. 打开启用开关

LimitRSS 使用 OpenAI 兼容接口。OpenAI、DeepSeek、Ollama、硅基流动、OpenRouter 等兼容服务都可以通过自定义 Endpoint 接入。

> API Key 仅存储在你的思源工作空间内，AI 请求直接从浏览器发到对应提供商，不经过任何中间服务器。

### 自定义提示词
1. 设置 → 提示词模板
2. 点击 **+ 新建提示词**
3. 设置名称、图标、系统提示、用户提示
4. 可用变量：`{{title}}` `{{content}}` `{{author}}` `{{link}}` `{{date}}` `{{description}}` `{{source}}`

## 开发

- Node.js >= 18
- npm >= 9
- TypeScript 5

```bash
# 安装依赖
npm install

# 开发（监听）
npm run dev

# 类型检查
npm run type-check

# 生产构建
npm run build
```

构建产物在 `dist/` 目录，复制到 `{工作空间}/data/plugins/LimitRSS/` 即可。

## 贡献

欢迎 Issue 和 PR！到 [Issues](https://github.com/Demisse233/LimitRSS/issues) 反馈。

## 许可

MIT © 2026 demisse

## 致谢

- [思源笔记](https://github.com/siyuan-note/siyuan) — 强大的块级个人知识管理系统
