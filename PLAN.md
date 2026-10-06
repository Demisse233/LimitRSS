# PLAN.md

## 当前实施计划

### 已完成阶段

1. 开发准备：克隆 `YOGEMOW/LimitRSS` 到 `E:\Git\repositoris\LimitRSS`，梳理构建链路。
2. 阶段一：依据原项目 issue #1 / #3 设计插件优化方案并实现基础功能（入口、Dock、保存、AI、图标、多端）。
3. 阶段二及多轮迭代：按用户逐轮问题清单修复（保存目标、日报范围、AI 卡片、图片菜单、手机适配等）。
4. TDD 修复轮：为三组问题建立回归测试（红 → 绿），实现面板触发、长按复制、按笔记本路径记忆。
5. AI 日报全量化改造：两阶段生成（全景扫描 + 重点深读）、三档覆盖模式、组件级缓存，新增 `dailyReportCore` 纯逻辑模块与 11 例测试。
6. 排版校正与设置独立化：速览链接、深读标题链接、AI 日报独立设置标签页、链接清理与导出格式修复（本地验证通过）。
7. 工程收尾：构建（type-check / build / dev:once）、部署思源、提交、维护项目文档。

### 当前进行中

- 发布 v0.1.7：版本 bump、构建 Release（package.zip）、推送远端并更新文档。

### 后续待办

- 思源内最终实测：面板点击外部关闭与展开不跳顶、AI 卡片桌面右键/手机长按复制、日报保存路径按笔记本记忆与切换、手机笔记本下拉完整显示。
- 千篇级日期分别用快速/均衡/全面三档生成日报，确认进度显示、停止、缓存复用与引用链接。
- 向原项目（Demisse233/LimitRSS）发起 Pull Request。
- 可选优化：路径记忆改为失焦/切换时持久化以降低写入频率；将 node_modules 中 siyuan 类型补丁（foldRecursive）上游化。

### 执行流程约定（每次改动）

1. 在仓库直接打补丁（E 盘已可写）。
2. 依次运行 `node --experimental-strip-types --test "tests/*.test.ts"`、`npm run type-check`、`npm run build`、`npm run dev:once`。
3. 复制 `dist/*` 到 `G:\思源-工作空间\siyuan\data\plugins\LimitRSS`，MD5 校验后由用户在思源中验证。
