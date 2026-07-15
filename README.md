# 公开交易研究档案

这是一个面向协作者的只读中文研究档案，使用 Astro 构建并部署到 GitHub Pages。站点按股票、分析日期和不可变版本组织公开报告，展示操作建议、指标分析，并提供字节不变的完整 Markdown 下载。

页面内容是有明确分析日期的历史研究快照，不代表当前观点，不构成个性化投资建议。

## 公开输入边界

站点把以下版本化文件视为不可信公开输入：

- `reports/`：不可变公开报告包；
- `publication-events.jsonl`：发布、修订和撤下事件；
- `config/publication-sources.yaml`：经审核的来源再发布政策。

每次构建和部署都会执行全站无模型审计。任何包哈希、路由、生命周期、来源许可或 emergency tombstone 不一致都会阻止新部署。真实报告只能通过受控发布流程加入；开发与测试使用合成夹具。

## 本地验证

```bash
npm ci
npm run audit
npm run check
npm test
npm run build
npm run test:e2e
```

本地开发使用：

```bash
npm run dev
```

测试构建可通过 `REPORT_SITE_ROOT` 指向合成站点树。浏览器测试同时把合成输出隔离到 `dist-e2e/`，不会覆盖待审批的正式 `dist/`。正式 Pages 部署不会设置这些变量，只读取仓库根目录的公开输入。

## 发布规则

`.github/workflows/pages.yml` 只在 `main` 上部署，并在上传 Pages artifact 前依次完成审计、类型检查、单元测试和构建。报告预览、批准、提交与推送由独立的受控发布工作流负责；没有新的显式批准时，不应向 `main` 发布报告或维护候选。
