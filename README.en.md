# LimitRSS · AI-powered RSS reader for SiYuan

> 📡 打破信息获取与知识内化的壁垒。订阅、阅读、让 AI 帮你总结、翻译，把文章变成你的知识库。

[中文文档](./README.md) · [Report Bug](https://github.com/Demisse233/LimitRSS/issues) · [Request Feature](https://github.com/Demisse233/LimitRSS/issues)

## ✨ Features

### Core
- 📡 **Full RSS/Atom Support** — Subscribe, organize, refresh, manage errors
- 🗂 **OPML Import/Export** — Migrate from other readers, backup easily
- ⭐ **Star / Read / Unread** — Track important articles, automatic read state
- 🔍 **Search & Filter** — Full-text search, filter by read state, source, AI status
- 📦 **Categorization** — Custom categories with colors, drag-to-reorder
- 🌗 **Theme Aware** — Follows SiYuan's light/dark mode

### 🤖 AI-Powered (user-provided)
- 🧠 **Multiple Providers** — OpenAI, Anthropic, DeepSeek, Zhipu GLM, Ollama, any OpenAI-compatible
- 📝 **One-Click Actions** — Summarize, translate, extract key points, action items, mind map, smart tags
- 💡 **Custom Prompts** — Write your own prompt templates with `{{title}} {{content}}` variables
- 🗞 **Daily Digest** — Group multiple articles into a thematic briefing
- 📊 **Token Usage Tracking** — See how much you've spent
- ⚡ **Result Caching** — Same article + same prompt = no double-spend

### 💾 Save to SiYuan
- 📥 **One-Click Save** — Convert article to SiYuan document with template
- 🏷 **Auto Tagging** — Write source, URL, and custom tags as block attributes
- 🖼 **Image Localization** — Download remote images to local assets
- 📋 **Multiple Notebooks** — Choose where to save each article
- 📑 **Template System** — Customize output format with variables

### ⌨️ Keyboard
| Key | Action |
|---|---|
| `J` / `K` | Next / Previous article |
| `M` | Toggle read/unread |
| `S` | Toggle star |
| `O` | Open original |
| `⌘S` | Save to SiYuan |
| `R` | Refresh |
| `⌘F` | Search |
| `I` | Toggle AI panel |
| `?` | Show help |

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
3. Click **+ Add Provider** and select your service
4. Fill in API Key, endpoint, model
5. Click **Test** to verify connection
6. Optionally set as **Default**

**Supported providers**:
- **OpenAI**: `https://api.openai.com/v1`, model `gpt-4o-mini`
- **Anthropic**: `https://api.anthropic.com`, model `claude-3-5-sonnet-20241022`
- **DeepSeek**: `https://api.deepseek.com/v1`, model `deepseek-chat`
- **Zhipu GLM**: `https://open.bigmodel.cn/api/paas/v4`, model `glm-4-flash`
- **Ollama** (local): `http://localhost:11434/v1`, any model
- **Custom**: Any OpenAI-compatible endpoint

> 🔒 Your API keys are stored only in your local SiYuan workspace. AI requests go directly from your browser to the provider, never through any intermediary server.

### Custom Prompts
1. Settings → Prompt Templates
2. Click **+ New Prompt**
3. Set name, icon, system prompt, user prompt
4. Use variables: `{{title}}` `{{content}}` `{{author}}` `{{link}}` `{{date}}` `{{description}}` `{{source}}`

## 📁 Project Structure

```
LimitRSS/
├── plugin.json            # Plugin manifest
├── package.json
├── src/
│   ├── index.ts          # Main entry
│   ├── index.scss        # Styles
│   ├── core/             # Core (no UI deps)
│   │   ├── types.ts
│   │   ├── storage.ts
│   │   ├── fetcher.ts    # browser fetch + SiYuan forwardProxy fallback
│   │   ├── rss-parser.ts
│   │   ├── sanitizer.ts  # HTML sanitizer
│   │   ├── readability.ts
│   │   ├── html-to-md.ts
│   │   ├── opml.ts
│   │   └── featured-feeds.ts
│   ├── ai/
│   │   ├── provider-base.ts
│   │   └── ai-service.ts
│   ├── ui/
│   │   ├── tab/          # Main 3-pane layout
│   │   ├── components/   # Reusable UI
│   │   ├── settings/
│   │   ├── dialogs/
│   │   └── styles/       # SCSS partials
│   ├── utils/
│   └── i18n/             # zh-CN, en
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

The build output goes to `dist/`. Copy `dist/*` (along with `package.json`, `icon.png`, `preview.png`) into `{workspace}/data/plugins/LimitRSS/`.

## Contributing

Issues and PRs welcome! See [Issues](https://github.com/Demisse233/LimitRSS/issues).

## License

MIT © 2026 demisse

## Acknowledgments

- [SiYuan Note](https://github.com/siyuan-note/siyuan) — A powerful block-level personal knowledge management system
