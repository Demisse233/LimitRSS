# LimitRSS · AI-powered RSS reader for SiYuan

> 📡 打破信息获取与知识内化的壁垒。订阅、阅读、让 AI 帮你总结、翻译，把文章变成你的知识库。

[中文文档](./README.md) · [Report Bug](https://github.com/Demisse233/LimitRSS/issues) · [Request Feature](https://github.com/Demisse233/LimitRSS/issues)

## ✨ Features

### Core
- 📡 **Full RSS/Atom Support** — Subscribe, organize, refresh, manage errors
- 🗂 **OPML Import/Export** — Migrate from other readers, backup easily
- ⭐ **Star / Read / Unread** — Track important articles, automatic read state
- 🔍 **Search & Filter** — Full-text search across title, author, summary, body and fetched full text; filter by read state and source
- 📦 **Categorization** — Custom categories, filter by category, move subscriptions
- 🖼 **Custom Icons** — Set an icon URL while adding or editing a subscription, with live preview
- 🌗 **Theme Aware** — Follows SiYuan's light/dark mode

### 🤖 AI-Powered (user-provided)
- 🧠 **OpenAI-Compatible + Anthropic** — Configure the endpoint, API key and model yourself
- 🌐 **Network Auto-Fallback** — When direct requests are blocked by CORS or mixed content, requests switch to SiYuan's kernel `forwardProxy`
- 📝 **Summarize / Translate** — Streamed results, with structure-preserving translation
- 💡 **Custom Prompts** — Write your own prompt templates with `{{title}} {{content}}` variables
- 🗞 **Daily Digest** — Group articles into a thematic briefing with citation links; regenerate, stop and cache supported. DeepSeek thinking is disabled for digest generation so reasoning tokens cannot consume the whole answer budget

### 💾 Save to SiYuan
- 📥 **One-Click Save** — Convert article to SiYuan document with template
- 🏷 **Auto Attributes** — Write source, URL, and custom tags as block attributes
- 🖼 **Image Localization** — Download remote images to local assets
- 📋 **Multiple Notebooks** — Remember the default notebook
- 📁 **Custom Paths** — Save into any folder, creating parent documents automatically
- 📑 **Template System** — Customize output format with variables

### ⌨️ Keyboard
> Shortcuts are disabled while typing in inputs, search boxes, settings fields or SiYuan editors.

| Key | Action |
|---|---|
| `J` / `K` | Next / Previous article |
| `M` | Toggle read/unread |
| `S` | Toggle star |
| `O` | Open original |
| `⌘S` (`Ctrl+S` on Windows/Linux) | Save to SiYuan |
| `R` | Refresh current list |
| `⌘F` (`Ctrl+F` on Windows/Linux) | Focus search |
| `I` | Show/hide AI summary |
| `?` | Show keyboard help |

## 🚀 Installation

### From Bazaar (recommended)
1. Open SiYuan → Settings → Marketplace
2. Search "LimitRSS"
3. Click Install

### Manual
1. Download the latest `package.zip` from [Releases](https://github.com/Demisse233/LimitRSS/releases)
2. Extract to `{workspace}/data/plugins/LimitRSS/`
3. Restart SiYuan or reload plugins

### From Source
```bash
git clone https://github.com/Demisse233/LimitRSS.git
cd LimitRSS
npm install
npm run dev      # watch mode
# or
npm run build    # production
```
Copy the `dist/` folder to `{workspace}/data/plugins/LimitRSS/`.

## ⚙️ Configuration

### AI Provider Setup
1. Click the ⚙️ button in the sidebar
2. Go to **AI Providers** section
3. Click **+ Add Provider**
4. Fill in API Key, endpoint and model
5. Click **Test** to verify connection
6. Enable the provider you want to use

**Supported endpoints**:
- **OpenAI**: `https://api.openai.com/v1`, model `gpt-4o-mini`
- **Anthropic**: `https://api.anthropic.com`, model `claude-3-5-sonnet-20241022`
- **DeepSeek**: `https://api.deepseek.com/v1`, model `deepseek-chat`
- **Zhipu GLM**: `https://open.bigmodel.cn/api/paas/v4`, model `glm-4-flash`
- **Ollama** (local): `http://localhost:11434/v1`, any model
- **Custom**: Any OpenAI-compatible endpoint

> 🔒 Your API keys are stored only in your local SiYuan workspace. Requests go directly from your browser to the provider, or through your local SiYuan kernel when direct access is blocked. They never pass through a third-party intermediary.
>
> For Docker or browser access, keep **Network mode** on **Auto**. It retries through SiYuan's kernel `forwardProxy` when CORS or mixed content blocks the direct request. Proxy mode does not support streaming.

### Custom Prompts
1. Settings → Prompt Templates
2. Edit a built-in prompt
3. Set name, system prompt, user prompt
4. Use variables: `{{title}}` `{{content}}` `{{author}}` `{{link}}` `{{date}}` `{{description}}`

## 📁 Project Structure

```
LimitRSS/
├── plugin.json            # Plugin manifest
├── package.json
├── src/
│   ├── index.ts           # Plugin entry, tab registration
│   ├── tab.ts             # Sidebar, article list, reader, shortcuts
│   ├── settings.ts        # Settings panels
│   ├── storage.ts         # loadData/saveData + in-memory indexes
│   ├── ai.ts              # Provider adapters and streaming
│   ├── http.ts            # Direct fetch + kernel proxy wiring
│   ├── http-core.ts       # Testable HTTP transport
│   ├── fetcher.ts         # RSS/Atom parsing, favicon resolution
│   ├── save.ts            # Save to SiYuan documents
│   ├── fulltext.ts        # Readability-style full-text extraction
│   ├── components.ts      # Button, modal, toast, dropdown
│   ├── sanitizer.ts       # DOMPurify wrapper
│   ├── types.ts           # Models and defaults
│   ├── util.ts            # Path, icon and shortcut helpers
│   └── i18n/              # zh-CN, en
├── tests/                 # Node unit tests
├── docs/
└── README*.md
```

## 🛠 Development

- Node.js >= 18
- npm >= 9
- TypeScript 5

```bash
# Install
npm install

# Dev (watch mode)
npm run dev

# Type check
npm run type-check

# Build production
npm run build
```

The build output goes to `dist/`. Copy its contents into `{workspace}/data/plugins/LimitRSS/`.

## Contributing

Issues and PRs welcome! See [Issues](https://github.com/Demisse233/LimitRSS/issues).

## License

MIT © 2026 demisse

## Acknowledgments

- [SiYuan Note](https://github.com/siyuan-note/siyuan) — A powerful block-level personal knowledge management system
