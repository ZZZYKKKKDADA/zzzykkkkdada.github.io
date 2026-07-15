# 公开交易研究档案

这是一个使用 Astro 构建并部署到 GitHub Pages 的只读中文研究档案。站点按股票、分析日期和不可变版本组织公开报告，展示操作建议与指标证据，并提供字节不变的完整 Markdown 下载。

页面是有明确分析日期的历史研究快照，不代表当前观点，不构成个性化投资建议。GitHub Pages 完全公开，`noindex` 不是访问控制。

## 公开输入边界

站点只把以下 Schema V2 文件视为不可信公开输入：

- `reports/` 下不可变报告包中的 `manifest.json`、`summary.json` 和 `complete_report.md`；
- 根目录的 append-only `publication-events.jsonl` 生命周期事件。

站点不保存 provider policy、来源追踪、权利状态或公开 attribution 元数据。发布器也不验证用户所选 Markdown 的所有权、版权或许可状态。用户必须在每个精确候选预览中明确批准其公开发布意图，批准记录保留在站点之外的私有状态中。

每次构建和部署都会执行全站结构审计与版本化公开内容安全扫描。扫描结果只包含规则、文件位置和命中哈希，不回显敏感值或报告摘录。包哈希、路由、生命周期、完整安全影响集或 emergency tombstone 不一致都会阻止部署。页面渲染使用安全 Markdown；下载仍保持原始 Markdown 字节不变。

## 本地验证

```bash
npm ci
npm run audit
npm run check
npm test
npm run test:stale
npm run build
npm run audit:dist
npm run test:e2e
```

本地开发使用：

```bash
npm run dev
```

测试构建可通过 `REPORT_SITE_ROOT` 指向合成站点树。浏览器测试把合成输出隔离到 `dist-e2e/`，不会覆盖正式 `dist/`。正式 Pages 部署不设置这些变量，只读取仓库根目录的公开输入。

## 发布规则

`.github/workflows/pages.yml` 只在 `main` 上部署，并在上传 Pages artifact 前依次完成依赖安装、站点审计、类型检查、单元测试、stale-state 检查、生产构建、构建产物扫描和 Chromium/WebKit 浏览器测试。报告预览、批准、提交与推送由独立的受控发布工作流负责；没有新的精确候选明确批准时，不得向 `main` 发布报告或维护候选。
