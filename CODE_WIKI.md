# Token Monitor · Code Wiki

> 跨中转站 Token 用量监控工具的完整代码文档，涵盖项目整体架构、主要模块职责、关键类与函数说明、依赖关系以及项目运行方式。

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [技术栈与依赖](#3-技术栈与依赖)
4. [目录结构](#4-目录结构)
5. [主要模块职责](#5-主要模块职责)
6. [关键类与函数说明](#6-关键类与函数说明)
7. [关键数据流与业务流程](#7-关键数据流与业务流程)
8. [依赖关系图](#8-依赖关系图)
9. [项目运行方式](#9-项目运行方式)
10. [配置与本地数据](#10-配置与本地数据)
11. [测试说明](#11-测试说明)
12. [约定与扩展点](#12-约定与扩展点)

---

## 1. 项目概述

**Token Monitor** 是一个跨中转站的 Token 用量监控工具，提供 Web 仪表盘和 Windows 桌面挂件两种形态。

### 核心能力

- **多源聚合**：汇总 OneAPI / NewAPI 中转站与无 API 的商业中转站的余额、调用量、Token 和费用
- **浏览器抓取**：通过 Playwright 复用本机 Microsoft Edge 登录态，抓取无开放 API 的中转站
- **可视化分析**：模型分布、近 14/30 天历史趋势、缓存命中率、各站健康度对比
- **桌面挂件**：Electron 无边框窗口、置顶、视频背景，支持记忆窗口尺寸
- **本地化**：数据、配置和登录态仅保存在本机，不上传第三方服务

### 版本与入口

- `name`: token-monitor，`version`: 1.1.0
- 主入口（Electron）：`electron/main.cjs`
- 后端入口：`server/index.js`
- 前端入口：`src/main.jsx` → `index.html`

---

## 2. 整体架构

项目为 **三进程协作** 的桌面 + Web 混合应用，由 Electron 主进程统一编排。

```
┌────────────────────────────────────────────────────────────────────┐
│                  Electron 主进程 (electron/main.cjs)                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  挂件窗口        │  │  仪表盘窗口       │  │  托盘菜单        │   │
│  │  (frameless,    │  │  (BrowserWindow) │  │  (Tray + Menu)   │   │
│  │   always-on-top)│  │  加载 dist/      │  │                  │   │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘   │
│           │                     │                                   │
│           │ IPC (preload.cjs)   │                                   │
│           ▼                     ▼                                   │
│  ensureApiServer() 在打包环境下用 ELECTRON_RUN_AS_NODE 派生后端     │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│           后端 Express 服务 (server/index.js, port 3017)            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────┐  │
│  │ /api/stats   │ │ /api/refresh │ │ /api/history │ │ /api/...  │  │
│  │  聚合统计    │ │  触发刷新    │ │  历史趋势    │ │  config/  │  │
│  └──────┬───────┘ └──────┬───────┘ └──────────────┘ │  browser/ │  │
│         │                │                          └─────┬─────┘  │
│         ▼                ▼                                ▼        │
│  ┌──────────────────────────────────┐  ┌─────────────────────────┐│
│  │  providers.js 适配器层            │  │  browser.js 浏览器抓取   ││
│  │  - oneapi / newapi: HTTP API     │  │  - login (有头 Edge)     ││
│  │  - browser: Playwright           │  │  - fetchViaBrowser       ││
│  │  - mock: 演示                    │  │  - autoDetectSelectors   ││
│  └──────────────────────────────────┘  │  - probeSelectors        ││
│                                        │  - pickSelector          ││
│  ┌──────────────────────────────────┐  └─────────────────────────┘│
│  │  持久化层                          │                            │
│  │  - store.js      缓存 (cache.json, TTL 60s)                  ││
│  │  - history.js    历史快照 (history.json, 90 天)              ││
│  │  - refresh-cache.js  合并/保留失败站点                        ││
│  │  - cache-metrics.js    加权缓存命中率                         ││
│  │  - usage-date.js       时区感知的日期路径                     ││
│  └──────────────────────────────────┘                            │
└────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP /api/*
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│          前端 React 18 + Vite SPA (src/)                            │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐    │
│  │  BrowserRouter│  │  HashRouter (file:// 协议，打包后)        │    │
│  └──────┬───────┘  └──────────────────────────────────────────┘    │
│         ▼                                                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  App.jsx  路由 + 布局                                         │  │
│  │    /  /analytics  /combined  /providers  /settings  /help    │  │
│  │    ?widget=1  →  Widget.jsx (挂件视图，独立)                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────────────┐ │
│  │ api/client │ │ hooks/useApi │ │ components/ (Sidebar/Header/  │ │
│  │  统一封装  │ │  通用数据    │ │   StatCard / 图表卡 / ... )   │ │
│  └────────────┘ └──────────────┘ └──────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 三种运行形态

| 形态 | 入口 | 描述 |
|---|---|---|
| 开发模式 | `npm run dev:desktop` | Vite (5173) + Express (3017) + Electron 三进程并行 |
| Web 预览 | `npm run dev:all` | 仅前后端，浏览器访问 `http://127.0.0.1:5173/?widget=1` |
| 打包版 | `Token Monitor.exe` | Electron 内置 dist/，自动派生 Express 子进程 |

---

## 3. 技术栈与依赖

### 运行时依赖 (`dependencies`)

| 包 | 版本 | 用途 |
|---|---|---|
| `express` | ^4.19.2 | 后端 HTTP 服务 |
| `cors` | ^2.8.5 | CORS 中间件（仅允许本地来源） |
| `playwright` | ^1.62.0 | 浏览器自动化（登录与抓取） |
| `react` / `react-dom` | ^18.3.1 | 前端 UI 框架 |
| `react-router-dom` | ^7.18.1 | 路由（支持 BrowserRouter 与 HashRouter 切换） |
| `recharts` | ^2.12.0 | 图表（Line / Bar / Pie / Area） |
| `lucide-react` | ^0.400.0 | 图标库 |

### 开发依赖 (`devDependencies`)

| 包 | 用途 |
|---|---|
| `vite` ^5.4.0 + `@vitejs/plugin-react` | 前端构建 |
| `concurrently` ^9.0.0 | 多进程并行启动 |
| `electron` ^43.2.0 | 桌面运行时 |
| `electron-builder` ^26.0.12 | 打包 NSIS 安装包 |

### 外部运行环境

- **Node.js 18+**
- **Microsoft Edge**：浏览器抓取复用系统已安装的 Edge（`channel: 'msedge'`），避免内置浏览器二进制
- **Windows x64**：当前打包目标（NSIS）

---

## 4. 目录结构

```text
llm-token-monitor/
├── electron/                     # Electron 主进程与预加载脚本
│   ├── main.cjs                  # 主进程：窗口/托盘/IPC/API 派生
│   └── preload.cjs               # 上下文桥：暴露 desktopWidget API
├── server/                       # Express 后端 + 抓取适配器
│   ├── index.js                  # 服务入口 + 路由 + 聚合函数
│   ├── providers.js              # Provider 适配器（oneapi/newapi/browser/mock）
│   ├── browser.js                # Playwright 登录/抓取/识别/拾取
│   ├── store.js                  # 内存+文件缓存
│   ├── history.js                # 历史快照存储
│   ├── refresh-cache.js          # 刷新合并/保留失败站点数据
│   ├── cache-metrics.js          # 加权缓存命中率
│   ├── usage-date.js             # 时区感知的日期范围
│   ├── config.example.json       # 配置示例
│   └── *.test.mjs                # 后端单元测试
├── src/                          # React 前端
│   ├── main.jsx                  # React 入口（按协议选择 Router）
│   ├── App.jsx                   # 路由与布局
│   ├── index.css                 # 全局样式
│   ├── api/
│   │   └── client.js             # API 客户端 + 工具函数（quotaToUSD/formatTokens）
│   ├── hooks/
│   │   ├── useApi.js             # 通用数据获取 hook
│   │   └── useProviderScope.js   # URL 参数驱动的中转站筛选
│   ├── pages/
│   │   ├── Dashboard/            # 仪表盘（KPI + 图表 + 30 天趋势 + 最近请求）
│   │   ├── Analytics/            # 趋势分析（14 天 Area 图 + 模型明细表）
│   │   ├── Combined/             # 双站合计概览
│   │   ├── Providers/            # 中转站健康度（延迟对比 + 卡片）
│   │   ├── Settings/             # 中转站配置（含登录/拾取/自动识别）
│   │   ├── Widget/               # 挂件视图（视频背景 + 关键指标）
│   │   └── Help/                 # 使用指南 FAQ
│   ├── components/
│   │   ├── Sidebar/              # 侧边导航
│   │   ├── Header/               # 顶部标题栏
│   │   ├── StatCard/             # KPI 卡片
│   │   ├── LineChartCard/        # 折线图卡
│   │   ├── BarChartCard/         # 柱状图卡
│   │   ├── PieChartCard/         # 饼图卡
│   │   ├── RecentActivity/       # 最近请求列表
│   │   └── ProviderScope/        # 中转站范围下拉
│   └── data/mockData.js          # （遗留模板数据，未使用）
├── public/                       # 静态资源（视频、海报、favicon）
├── build/icon.ico                # 安装包图标
├── .gitignore                    # 忽略 dist/ release/ config.json 等
├── index.html                    # Vite HTML 模板
├── package.json                  # 依赖与脚本
├── vite.config.js                # Vite 配置（base + /api 代理）
└── README.md                     # 用户文档
```

---

## 5. 主要模块职责

### 5.1 Electron 主进程层 `electron/`

| 文件 | 职责 |
|---|---|
| [main.cjs](file:///d:/MyTools/llm-token-monitor/electron/main.cjs) | 应用生命周期、单实例锁、挂件窗口（无边框+置顶+可调整尺寸）、仪表盘窗口、托盘菜单、IPC 通信、记忆挂件尺寸（`widget-state.json`）、生产环境下派生 Express 子进程 |
| [preload.cjs](file:///d:/MyTools/llm-token-monitor/electron/preload.cjs) | 通过 `contextBridge` 暴露 `window.desktopWidget` 接口（`hide` / `openDashboard` / `quit`） |

### 5.2 后端服务层 `server/`

| 文件 | 职责 |
|---|---|
| [index.js](file:///d:/MyTools/llm-token-monitor/server/index.js) | Express 应用、CORS 白名单（仅本地）、`/api/*` 路由、定时刷新调度、`aggregate()` 聚合函数、Mock 兜底 |
| [providers.js](file:///d:/MyTools/llm-token-monitor/server/providers.js) | Provider 适配器（oneapi/newapi/browser/mock）、`fetchProvider` 统一入口、`loginProvider`、`loadConfig`（支持环境变量覆盖 token） |
| [browser.js](file:///d:/MyTools/llm-token-monitor/server/browser.js) | Playwright 自动化：登录流程、数据抓取、选择器自动识别、选择器自检、可视化拾取、表格解析、数字解析 |
| [store.js](file:///d:/MyTools/llm-token-monitor/server/store.js) | 内存缓存（TTL 60s）+ 文件持久化（`cache.json`） |
| [history.js](file:///d:/MyTools/llm-token-monitor/server/history.js) | 每日按 provider 写入快照，保留 90 天 |
| [refresh-cache.js](file:///d:/MyTools/llm-token-monitor/server/refresh-cache.js) | 刷新目标解析、新旧 provider 合并、失败站点保留旧数据并标记 `stale` |
| [cache-metrics.js](file:///d:/MyTools/llm-token-monitor/server/cache-metrics.js) | 提取缓存 Token 三元组、加权缓存命中率计算 |
| [usage-date.js](file:///d:/MyTools/llm-token-monitor/server/usage-date.js) | 基于时区生成日期范围与 `/api/v1/usage/stats` 查询路径 |

### 5.3 前端层 `src/`

#### 入口与路由

| 文件 | 职责 |
|---|---|
| [main.jsx](file:///d:/MyTools/llm-token-monitor/src/main.jsx) | React 根渲染；按 `window.location.protocol === 'file:'` 选择 `HashRouter`（打包）或 `BrowserRouter`（开发） |
| [App.jsx](file:///d:/MyTools/llm-token-monitor/src/App.jsx) | 全局布局（Sidebar + Header + 内容区）；检测 `?widget=1` 直接渲染 `<Widget />`；定义 6 条路由 |

#### API 客户端与 Hooks

| 文件 | 职责 |
|---|---|
| [api/client.js](file:///d:/MyTools/llm-token-monitor/src/api/client.js) | 统一 `request()` 封装、`fetchStats` / `fetchHistory` / `triggerRefresh` / `fetchConfig` / `saveConfig` / `triggerBrowserLogin` / `probeBrowserSelectors` / `autoDetectBrowserSelectors` / `pickBrowserSelector`，并提供 `QUOTA_PER_DOLLAR` / `quotaToUSD` / `formatTokens` / `formatUSD` 工具 |
| [hooks/useApi.js](file:///d:/MyTools/llm-token-monitor/src/hooks/useApi.js) | 通用 fetch hook：`{ data, loading, error, refetch }`，依赖变化自动重取 |
| [hooks/useProviderScope.js](file:///d:/MyTools/llm-token-monitor/src/hooks/useProviderScope.js) | 用 URL `?provider=` 维护当前选中的 provider，`setProviderId` 用 `replace: true` 不污染历史 |

#### 页面

| 页面 | 职责 |
|---|---|
| [Dashboard](file:///d:/MyTools/llm-token-monitor/src/pages/Dashboard/Dashboard.jsx) | 主仪表盘：4 张 KPI 卡 + 三张图（Token 趋势/模型分布/缓存命中）+ 30 天历史趋势 + 最近 50 条请求；支持刷新与 provider 切换 |
| [Analytics](file:///d:/MyTools/llm-token-monitor/src/pages/Analytics/Analytics.jsx) | 14 天趋势：tabs 切换 tokens/prompt/completion/cost/calls，Area 图 + 模型明细表 |
| [Combined](file:///d:/MyTools/llm-token-monitor/src/pages/Combined/Combined.jsx) | 双站合计概览：固定 `'all'` 范围，余额合计 KPI + 来源表 + 模型分布 |
| [Providers](file:///d:/MyTools/llm-token-monitor/src/pages/Providers/Providers.jsx) | 中转站健康度：垂直柱状图对比平均延迟（带颜色阈值）+ 各站状态卡 |
| [Settings](file:///d:/MyTools/llm-token-monitor/src/pages/Settings/Settings.jsx) | 配置页：刷新间隔、provider 增删改、登录、自动识别、手动拾取、选择器自检；含预设（WawAPI/OneAPI） |
| [Widget](file:///d:/MyTools/llm-token-monitor/src/pages/Widget/Widget.jsx) | 挂件视图：视频背景 + 标题栏 + provider Tabs + 4 指标 + 自动 25 秒刷新；调用 `window.desktopWidget` 控制窗口 |
| [Help](file:///d:/MyTools/llm-token-monitor/src/pages/Help/Help.jsx) | FAQ 文档页 |

#### 通用组件

| 组件 | 职责 |
|---|---|
| [Sidebar](file:///d:/MyTools/llm-token-monitor/src/components/Sidebar/Sidebar.jsx) | 左侧导航 + 折叠开关 + "数据保留在本机" 提示 |
| [Header](file:///d:/MyTools/llm-token-monitor/src/components/Header/Header.jsx) | 路由驱动的标题/描述 + "本地运行" 状态徽标 |
| [StatCard](file:///d:/MyTools/llm-token-monitor/src/components/StatCard/StatCard.jsx) | KPI 卡：标题/主值/副标题/胶囊文案/图标/主题色 |
| [LineChartCard](file:///d:/MyTools/llm-token-monitor/src/components/LineChartCard/LineChartCard.jsx) | 14 天 Prompt/Completion 折线图 |
| [BarChartCard](file:///d:/MyTools/llm-token-monitor/src/components/BarChartCard/BarChartCard.jsx) | 模型分布堆叠柱状图 |
| [PieChartCard](file:///d:/MyTools/llm-token-monitor/src/components/PieChartCard/PieChartCard.jsx) | 通用环形图（用于缓存命中分布） |
| [RecentActivity](file:///d:/MyTools/llm-token-monitor/src/components/RecentActivity/RecentActivity.jsx) | 最近请求时间线（缓存命中标记、延迟颜色） |
| [ProviderScope](file:///d:/MyTools/llm-token-monitor/src/components/ProviderScope/ProviderScope.jsx) | 中转站范围下拉选择器 |

---

## 6. 关键类与函数说明

### 6.1 `electron/main.cjs`

| 函数 | 说明 |
|---|---|
| `widgetStatePath()` | 返回 `userData/widget-state.json`，用于持久化挂件尺寸 |
| `clamp(value, min, max, fallback)` | 数值范围裁剪，非有限数返回 fallback |
| `loadWidgetSize()` / `saveWidgetSize()` | 读取/写入挂件窗口尺寸（限制 320×360 ~ 480×620） |
| `isApiRunning()` | TCP 探测 `127.0.0.1:3017` 是否在监听 |
| `runtimeDataPath()` | 返回 `userData/data`，作为后端 `TOKEN_MONITOR_DATA_DIR` |
| `ensureApiServer()` | 打包环境下，若后端未运行，用 `ELECTRON_RUN_AS_NODE=1` 派生 `server/index.js` 子进程，最长等待 30×250ms |
| `createWidgetWindow()` | 创建挂件窗口：`frame: false`、`alwaysOnTop: 'floating'`、`visibleOnAllWorkspaces`、resize 防抖保存 |
| `loadWidget(window)` | 开发模式加载 `http://127.0.0.1:5173/?widget=1`（含 30 次重试），打包模式加载 `dist/index.html?widget=1` |
| `openDashboard()` | 开发模式用 `shell.openExternal` 打开 5173；打包模式新建 `BrowserWindow` 加载 `dist/index.html` |
| `createTray()` | 创建托盘菜单：显示挂件 / 打开仪表盘 / 重置挂件大小 / 退出 |

### 6.2 `server/index.js`

#### 核心函数

| 函数 | 签名 | 说明 |
|---|---|---|
| `refresh` | `(requestedProviderId = '') → { providers, isMock, fetchedAt }` | 并行调用 `fetchProvider` 拉取所有启用的 provider；无配置时回退 mock |
| `refreshAndStore` | `(requestedProviderId = '') → cache` | 单飞（`refreshInFlight`）防止并发刷新；调用 `preserveFailedProviderData` + `mergeRefreshedProviders`，写缓存 + 写历史快照 |
| `startRefreshScheduler` | `() → void` | 按 `config.refreshIntervalSec` 启动 setInterval，最小 25 秒；`timer.unref()` 不阻止退出 |
| `aggregate` | `(cacheData, requestedProviderId = '') → AggregateResult` | 跨 provider 聚合：合并 logs 与 browser 模型表、计算总 Token/成本/今日指标/加权缓存命中率/14 天趋势/各站健康度/最近 50 条 logs |

#### 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/stats?providerId=` | 返回 `aggregate()` 结果，缓存为空时触发首次刷新 |
| POST | `/api/refresh?providerId=` | 强制刷新；指定 id 时仅刷新该站并合并到旧缓存 |
| GET | `/api/history?days=` | 返回最近 N 天（≤90）历史快照 |
| GET | `/api/config` | 返回脱敏配置（不含 apiToken 原文，含 `hasToken`/`hasAuth`） |
| PUT | `/api/config` | 合并保存配置（保留未回传的 apiToken） |
| POST | `/api/browser/login/:id` | 触发有头浏览器登录流程，保存 storageState |
| POST | `/api/browser/probe/:id` | 选择器自检：返回每个字段实际抓到的文本 |
| POST | `/api/browser/auto-detect/:id` | 自动识别标量字段与模型表选择器 |
| POST | `/api/browser/pick/:id` | 启动有头浏览器，用户点击元素后返回 CSS 选择器 |

#### `aggregate()` 返回结构

```js
{
  scope: { providerId, providerName },
  availableProviders: [{ id, name, type, ok }],
  summary: {
    totalCalls, totalPromptTokens, totalCompletionTokens, totalTokens,
    totalQuota, totalQuotaRemaining, totalUsedQuota,
    todayTokens, todayCost, cacheHitRate, cacheHitRateMode,
    hasStaleProviders, lastSuccessfulFetch, providerCount, isMock, fetchedAt,
  },
  modelBreakdown: [{ model, calls, promptTokens, completionTokens, quota }],
  dailyTrend: [{ date, promptTokens, completionTokens, quota, calls }],  // 14 天
  providers: [/* providerHealth */],
  recentLogs: [/* 最近 50 条 */],
}
```

### 6.3 `server/providers.js`

| 函数 | 说明 |
|---|---|
| `oneApiFetch(cfg)` | 调用 OneAPI/NewAPI 的 `/api/user/self` 与 `/api/log/self?p=1&type=0&limit=100`，返回 `{ quota, usedQuota, logs }` |
| `browserFetch(cfg)` | 调用 `fetchViaBrowser`，将美元值 ×`QUOTA_PER_DOLLAR`(500000) 转为 OneAPI quota 单位，返回 `balance/todayTokens/todayCost/cacheHitRate/cacheInputTokens/cacheCreationTokens/cacheReadTokens/models/quota/usedQuota/logs/_browserRaw` |
| `mockFetch(cfg)` | 用 `Math.sin(seed * n + now/86400000)` 生成 60 条伪随机 logs，标记 `_mock: true` |
| `fetchProvider(cfg)` | 统一入口：根据 `cfg.type` 选择适配器；失败时不回退 mock，返回 `{ ok: false, error, data: { quota:0, usedQuota:0, logs:[] } }` |
| `loginProvider(cfg)` | 仅 browser 类型，调用 `browserLogin` |
| `providerHasAuth(cfg)` | oneapi/newapi 返回 true；browser 检查 `auth/<id>.json` 是否存在 |
| `loadConfig(configPath)` | 读取 config.json；若环境变量 `PROVIDER_<ID>_TOKEN` 存在则覆盖 apiToken |

#### 单位换算约定

- OneAPI 默认 `quota` 单位：**500000 = $1**
- browser 抓取的 `balance/todayCost/models[].quota` 是美元值，在 `browserFetch` 中统一 ×500000
- 前端通过 `quotaToUSD()` 还原为美元展示

### 6.4 `server/browser.js`

| 函数 | 说明 |
|---|---|
| `hasAuthState(id)` | 检查登录态文件是否存在 |
| `findEdgeExecutable()` | 在 `PROGRAMFILES` / `PROGRAMFILES(X86)` / `LOCALAPPDATA` 下查找 `msedge.exe` |
| `reserveDebugPort()` | 用 `net.createServer` 占用并释放一个随机端口，用于 Edge 远程调试 |
| `connectToNativeEdge(port, timeoutMs)` | 通过 CDP 端点轮询 `/json/version`，用 `chromium.connectOverCDP` 连接原生 Edge |
| `loginFinishScript()` | 注入到登录页的脚本：右上角创建「✓ 完成登录并保存」按钮，点击后置 `window.__tokenMonitorLoginDone = true` |
| `login(cfg)` | 派生 Edge 进程 → 连接 CDP → 注入按钮 → 等待用户点击（最长 10 分钟）→ 可选等待 `loginWaitUrl` → 保存 storageState 到 `auth/<id>.json` |
| `fetchUsageMetrics(page, cfg)` | 访问 `cfg.usageUrl` 或默认 `/usage`，从 localStorage 取 `auth_token` 调用 `/api/v1/usage/stats?start_date=...&end_date=...&timezone=...`，提取 `todayCost/todayTokens/cacheHitRate` 及缓存 Token 三元组 |
| `parseNumber(text)` | 解析 `$1,234.56` / `1.2M tokens` / `5,830,210` / `¥234.5` / `99%` 等格式 |
| `looksLikeModelName(text)` / `hasNumber(text)` | 启发式判断表格列内容 |
| `parseTable(page, tableSelector)` | 在浏览器内 evaluate：取首行作表头；自动识别模型列（≥50% 行像模型名）；按表头关键字匹配 calls/tokens/cost 列；匹配不上时按数字列位置兜底 |
| `parseTableToModels(tableInfo)` | 将 `parseTable` 结果映射为 `[{ model, calls, promptTokens:0, completionTokens, quota }]` |
| `fetchViaBrowser(cfg)` | 加载 storageState → 同时打开数据页与使用页 → 逐字段执行选择器 → 解析 modelTable → 合并 usage 接口数据 → 返回结构化结果 + `_rawText`（用于调试） |
| `autoDetectSelectors(cfg)` | 在浏览器内 evaluate：根据字段提示词（`余额/balance` 等）匹配标签元素 → 在父级 4 层内寻找数字兄弟节点 → 评分（深度/长度/特殊符号）→ 生成稳定 CSS 选择器；同时扫描所有 `<table>` 寻找最优模型表 |
| `probeSelectors(cfg)` | 与 fetch 类似，但返回每个字段的 `{ selector, found, text, value }`，用于设置页调试 |
| `pickSelector(cfg, fieldKey)` | 启动有头浏览器 → 注入拾取 UI（高亮+提示）→ 用户点击元素 → `generateSelector()` 生成选择器 → 3 秒后自动关闭；`fieldKey === 'modelTable'` 时向上 `closest('table')` |

#### CSS 选择器生成算法（`autoDetectSelectors` 内）

1. 优先 `#id`
2. 其次 `data-testid/data-test/data-cy/data-qa`
3. 向上遍历 8 层，每层 `tag.stableClass:nth-of-type(n)`，过滤 Tailwind 工具类
4. 每步用 `querySelectorAll` 验证唯一性

### 6.5 `server/store.js`

| 函数 | 说明 |
|---|---|
| `readLastCache()` | 优先返回内存缓存；否则从 `cache.json` 读取并回填内存（用 `fetchedAt` 或文件 mtime 作为时间戳） |
| `readCache()` | 在 `readLastCache` 基础上检查 TTL（60 秒），过期返回 null |
| `writeCache(data)` | 同步写内存与 `cache.json` |

### 6.6 `server/history.js`

| 函数 | 说明 |
|---|---|
| `dateKey(date)` | 用 `getDailyDateRange(date, 'Asia/Shanghai').startDate` 生成 `YYYY-MM-DD` |
| `recordSnapshot(providers)` | 每次刷新后调用：按当日 key 覆盖写入每个 provider 的 `{ todayTokens, todayCost, balance, cacheHitRate, name, type, ts }`；清理超过 90 天的旧记录 |
| `getHistory(days = 30)` | 返回 `[{ date, providers: { [id]: snapshot } }]`，空日期补空对象 |

### 6.7 `server/refresh-cache.js`

| 函数 | 说明 |
|---|---|
| `resolveRefreshTargets(providers, requestedProviderId)` | 无 id 返回全部；有 id 返回单元素数组；不存在则抛错 |
| `mergeRefreshedProviders(cached, refreshed)` | 用 refreshed 覆盖同 id 的 cached，追加新增 provider（用于单站刷新场景） |
| `preserveFailedProviderData(refreshed, cached)` | 对 `ok === false` 的 provider：保留旧 `data`、置 `stale: true`、记录 `lastSuccessfulFetch`，避免 UI 全 0 |

### 6.8 `server/cache-metrics.js`

| 函数 | 说明 |
|---|---|
| `extractCacheUsage(data)` | 从 `data.total_input_tokens/total_cache_creation_tokens/total_cache_read_tokens` 提取三元组，任一非有限返回 null |
| `calculateWeightedCacheHitRate(providers)` | 按 `readTokens / (input+creation+read)` 加权求和；总和为 0 返回 null（用于回退到简单平均） |

### 6.9 `server/usage-date.js`

| 函数 | 说明 |
|---|---|
| `getDailyDateRange(now, timezone)` | 用 `Intl.DateTimeFormat('en-CA', { timeZone })` 生成 `{ startDate, endDate }`（YYYY-MM-DD） |
| `buildDailyUsagePath(now, timezone)` | 拼接 `/api/v1/usage/stats?start_date=...&end_date=...&timezone=...` |

### 6.10 `src/api/client.js`

| 导出 | 说明 |
|---|---|
| `request(pathname, options)` | 统一 fetch 封装：失败时尝试解析 JSON 错误，抛出含状态码与 detail 的 Error |
| `fetchStats(providerId)` | `GET /stats?providerId=` |
| `fetchHistory(days)` | `GET /history?days=` |
| `triggerRefresh(providerId)` | `POST /refresh?providerId=`，完成后自动 `fetchStats` |
| `fetchConfig()` / `saveConfig(config)` | 配置读写 |
| `triggerBrowserLogin(provider)` | `POST /browser/login/:id`，body 传完整 provider |
| `probeBrowserSelectors(provider)` | `POST /browser/probe/:id` |
| `autoDetectBrowserSelectors(provider)` | `POST /browser/auto-detect/:id` |
| `pickBrowserSelector(provider, fieldKey)` | `POST /browser/pick/:id` |
| `QUOTA_PER_DOLLAR` | 常量 500000 |
| `quotaToUSD(quota)` | `quota / 500000` |
| `formatTokens(n)` | K/M 格式化 |
| `formatUSD(usd)` | `$1.23` / `$1.23K` / `$0.0123` |

**BASE 自动切换**：`file:` 协议（打包版）用 `http://127.0.0.1:3017/api`，其他用 `/api`（走 Vite 代理）。

### 6.11 `src/hooks/useApi.js`

```js
useApi(fetcher, deps = []) → { data, loading, error, refetch }
```

- `fetcher` 是无参函数；`deps` 作为 `useCallback` 依赖
- 依赖变化时自动 `run()`；`refetch` 可手动触发

### 6.12 `src/pages/Widget/Widget.jsx`

- 仅展示 `type === 'browser'` 的前 2 个 provider 作为 Tab
- `AUTO_REFRESH_MS = 25_000` 自动刷新
- 用 `refreshingRef` 防止并发刷新
- 调用 `window.desktopWidget.hide/openDashboard/quit` 控制窗口
- 视频背景：`yukino-scene.mp4` + `yukino-scene-poster.png`

---

## 7. 关键数据流与业务流程

### 7.1 定时刷新流程

```
startRefreshScheduler()
  └─ setInterval (≥25s)
       └─ refreshAndStore()
            ├─ refreshInFlight 单飞检查
            ├─ refresh(requestedProviderId='')
            │    ├─ loadConfig()
            │    ├─ resolveRefreshTargets(enabled, '')
            │    └─ Promise.all( targets.map(p => fetchProvider(p)) )
            │         └─ ADAPTERS[p.type](p)
            │              ├─ oneApiFetch: fetch /api/user/self + /api/log/self
            │              ├─ browserFetch: fetchViaBrowser (Playwright)
            │              └─ mockFetch: 生成伪数据
            ├─ previous = readLastCache()
            ├─ safeProviders = preserveFailedProviderData(refreshed, previous)
            │    （失败站点保留旧 data，置 stale:true）
            ├─ cache = { ...refreshed, providers: safeProviders }
            ├─ writeCache(cache)  （内存 + cache.json）
            └─ recordSnapshot(cache.providers)  （history.json，按日覆盖）
```

### 7.2 浏览器登录流程

```
用户在 Settings 页点击「登录」
  └─ triggerBrowserLogin(provider) → POST /api/browser/login/:id
       └─ loginProvider(cfg) → browserLogin(cfg)
            ├─ findEdgeExecutable() 查找系统 Edge
            ├─ reserveDebugPort() 申请随机 CDP 端口
            ├─ spawn(msedge, [--remote-debugging-port, --user-data-dir, loginUrl])
            ├─ connectToNativeEdge(port) 轮询 /json/version
            ├─ context.addInitScript(loginFinishScript) 注入「完成登录」按钮
            ├─ page.waitForFunction(() => window.__tokenMonitorLoginDone, { timeout: 600_000 })
            ├─ 可选 page.waitForURL(loginWaitUrl)
            └─ context.storageState({ path: auth/<id>.json }) 保存登录态
```

### 7.3 浏览器抓取流程

```
fetchProvider({ type: 'browser', ... })
  └─ browserFetch(cfg)
       └─ fetchViaBrowser(cfg)
            ├─ launchHeadlessBrowser() (channel: 'msedge', headless: true)
            ├─ newContext({ storageState: auth/<id>.json })
            ├─ page = 数据页, usagePage = 使用页（并行）
            ├─ fetchUsageMetrics(usagePage, cfg)
            │    ├─ goto usageUrl 或 /usage
            │    ├─ buildDailyUsagePath(now, timezone)
            │    ├─ page.evaluate: localStorage 取 auth_token → fetch /api/v1/usage/stats
            │    └─ calculateCacheHitRate(payload) + extractCacheUsage(payload)
            ├─ page.goto(dataUrl, waitUntil: 'domcontentloaded')
            ├─ page.waitForTimeout(waitMs)  （给 SPA 渲染时间）
            ├─ for each selector in selectors:
            │    ├─ field === 'modelTable' → parseTable + parseTableToModels
            │    └─ 其他 → page.$(selector) + textContent + parseNumber
            ├─ 合并 usageMetrics 覆盖标量字段
            └─ return { balance, todayTokens, todayCost, cacheHitRate,
                       cacheInput/Creation/ReadTokens, models, _rawText, _fetchedAt }
```

### 7.4 聚合查询流程

```
GET /api/stats?providerId=xxx
  ├─ readCache() (TTL 60s)
  │    └─ 为空 → refreshAndStore() 首次刷新
  └─ aggregate(cache, providerId)
       ├─ selectedProvider ? [selected] : all
       ├─ allLogs = providers.flatMap(p => p.data.logs)
       ├─ browserModelStats = 合并 p.data.models 的 calls/tokens/quota
       ├─ todayTokens/todayCost = 直接累加 browser 字段（不用 modelTable 回退）
       ├─ cacheHitRate:
       │    ├─ 加权（calculateWeightedCacheHitRate）优先
       │    ├─ 否则 browser 站点简单平均
       │    └─ 否则 logs 的 cacheHit 占比
       ├─ modelMap = logs 聚合 ∪ browser models 合并
       ├─ dayMap = 最近 14 天 + logs 按日归档
       ├─ providerHealth = 各站 KPI + avgLatency
       └─ recentLogs = allLogs 按 time desc 取 50 条
```

### 7.5 选择器自动识别流程

```
POST /api/browser/auto-detect/:id
  └─ autoDetectSelectors(cfg)
       ├─ launchHeadlessBrowser + newContext(storageState)
       ├─ page.goto(dataUrl) + waitForTimeout
       └─ page.evaluate(fieldHints):
            ├─ 收集可见 label 元素 (p/span/label/dt/h*/div)
            ├─ 对每个字段提示词匹配 → 评分 (完全匹配 100 / 包含 70)
            ├─ 在 label 父级 4 层内找数字兄弟节点 → 评分 (depth×15 + 文本长度×0.1 + 兄弟节点 +25)
            ├─ 余额/今日消费 额外加分（含 $¥€ +20）
            ├─ 缓存命中率 额外加分（含 % +25）
            ├─ 生成稳定 CSS 选择器 (id > data-* > class+nth-of-type)
            ├─ 扫描所有 <table>，按表头关键字评分选最优模型表
            └─ 返回 { selectors, samples, confidence, missing }
```

### 7.6 失败站点保留策略

针对「中转站偶发登录态失效导致全 0 覆盖」的问题：

```
refreshed = [..., { ok: false, error, data: { quota:0, logs:[] } }, ...]
previous  = [..., { ok: true,  data: { ...真实数据... }, lastSuccessfulFetch }]

preserveFailedProviderData(refreshed, previous):
  对每个 ok === false 的 provider:
    return { ...previous, ok: false, error, fetchedAt, lastSuccessfulFetch, stale: true }

UI 端：
  - providerHealth.stale = true
  - summary.hasStaleProviders = true
  - Header 显示「数据延迟 · 上次成功 HH:MM:SS」
```

---

## 8. 依赖关系图

### 8.1 后端模块依赖

```
index.js
  ├─ providers.js
  │    └─ browser.js
  │         ├─ usage-date.js
  │         └─ cache-metrics.js
  ├─ browser.js (直接导入 autoDetectSelectors/hasAuthState/probeSelectors/pickSelector)
  ├─ store.js
  ├─ history.js
  │    └─ usage-date.js
  ├─ refresh-cache.js
  └─ cache-metrics.js
```

### 8.2 前端模块依赖

```
main.jsx
  └─ App.jsx
       ├─ Sidebar / Header
       ├─ pages/* (Dashboard / Analytics / Combined / Providers / Settings / Help / Widget)
       │    ├─ components/* (StatCard / LineChartCard / BarChartCard / PieChartCard /
       │    │               RecentActivity / ProviderScope)
       │    ├─ hooks/useApi
       │    ├─ hooks/useProviderScope
       │    └─ api/client
       └─ (widget=1) → Widget.jsx
```

### 8.3 运行时依赖

```
Electron 主进程
  ├─ (打包) 派生 → server/index.js (ELECTRON_RUN_AS_NODE=1)
  └─ 加载 → dist/index.html (生产) 或 http://127.0.0.1:5173 (开发)

前端 SPA
  └─ /api/* → Express (3017)
                  ├─ OneAPI/NewAPI: 外部 HTTP API
                  └─ Browser: Playwright + 系统 Edge
                              └─ auth/<id>.json (登录态)
```

### 8.4 数据持久化文件

```
userData/
├── widget-state.json          # 挂件窗口尺寸
└── data/                      # = TOKEN_MONITOR_DATA_DIR
    ├── config.json            # Provider 配置（含 apiToken，敏感）
    ├── cache.json             # 最近一次抓取结果
    ├── history.json           # 90 天历史快照
    └── auth/
        ├── <id>.json          # Playwright storageState（敏感）
        └── edge-profiles/<id>/  # Edge 用户数据目录
```

---

## 9. 项目运行方式

### 9.1 环境要求

- **Node.js 18+**
- **Microsoft Edge**（浏览器抓取所需）
- Windows / macOS / Linux 均可运行开发环境；打包仅支持 Windows x64

### 9.2 安装依赖

```bash
npm ci
```

### 9.3 开发模式

#### 完整桌面开发（推荐）

```bash
npm run dev:desktop
```

并行启动三个进程：

| 进程 | 端口/地址 | 说明 |
|---|---|---|
| Vite 前端 | http://127.0.0.1:5173 | HMR 热更新 |
| Express 后端 | http://127.0.0.1:3017 | API 服务 |
| Electron 挂件 | — | 加载 `?widget=1`，开发重试 30 次 |

#### 仅前后端（Web 预览）

```bash
npm run dev:all
```

浏览器访问 `http://127.0.0.1:5173/?widget=1` 可预览挂件视图。

#### 单独启动某一进程

```bash
npm run dev          # 仅前端
npm run dev:server   # 仅后端
npm run desktop      # 仅 Electron（需先启动前后端）
```

### 9.4 生产构建

```bash
npm run build          # Vite 构建到 dist/
npm run package:win    # 构建 + electron-builder 生成 NSIS 安装包到 release/
```

`package:win` 内部执行 `npm run build && electron-builder --win nsis`，配置见 `package.json` 的 `build` 字段：

- `appId: com.cc.tokenmonitor`
- `asar: true`
- 打包时排除 `server/config.json` / `cache.json` / `history.json` / `auth/` / `*.test.mjs` / 各 dev 依赖
- NSIS：`oneClick: false`，允许选择安装目录，创建桌面与开始菜单快捷方式

### 9.5 安装版运行

- 安装后启动 `Token Monitor.exe`
- 挂件自动显示，托盘图标提供「显示挂件/打开仪表盘/重置挂件大小/退出」
- 首次启动无 config.json 时显示示例数据（mock）

### 9.6 Vite 配置要点

```js
// vite.config.js
{
  base: './',          // 支持 file:// 协议加载
  server: {
    proxy: { '/api': 'http://localhost:3017' }
  }
}
```

### 9.7 常见启动问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `EADDRINUSE:3017` | 旧进程未退出 | 终止占用 3017 端口的进程 |
| `Lock file creation errors` | Edge profile 被占用 | 启动时加 `--user-data-dir=.dev-userdata` |
| 挂件 `ERR_CONNECTION_REFUSED` | Vite 未启动或未监听 5173 | `vite --host` 或检查端口 |
| 浏览器抓取失败 | 未找到系统 Edge | 安装/修复 Microsoft Edge |
| 登录态丢失 | `auth/<id>.json` 被删 | 在设置页重新登录 |

---

## 10. 配置与本地数据

### 10.1 `config.json` 结构

```json
{
  "refreshIntervalSec": 300,
  "providers": [
    {
      "id": "oneapi-prod",
      "name": "OneAPI 主站",
      "type": "oneapi",
      "baseUrl": "https://your-host.com",
      "apiToken": "...",
      "enabled": true
    },
    {
      "id": "site-a",
      "name": "某商业中转站A",
      "type": "browser",
      "loginUrl": "https://example.com/login",
      "loginWaitUrl": "**/dashboard**",
      "dataUrl": "https://example.com/dashboard",
      "usageUrl": "",                    // 可选，默认 /usage
      "selectors": {
        "balance": ".balance-value",
        "todayTokens": ".today-tokens",
        "todayCost": ".today-cost",
        "modelTable": "table.models"
      },
      "waitMs": 3000,
      "timezone": "Asia/Shanghai",
      "enabled": true
    }
  ]
}
```

### 10.2 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3017 | 后端监听端口 |
| `TOKEN_MONITOR_DATA_DIR` | `server/` 或 `userData/data` | 数据目录（config/cache/history/auth 的根） |
| `AUTH_DIR` | `<DATA_DIR>/auth` | 登录态目录（覆盖默认） |
| `PROVIDER_<ID>_TOKEN` | — | 覆盖 `<id>` provider 的 apiToken（id 大写、`-` 转 `_`） |
| `PLAYWRIGHT_BROWSERS_PATH` | `<project>/.playwright` | Playwright 浏览器二进制路径 |
| `NODE_ENV` | — | `development` 时 Electron 直接加载 5173 |

### 10.3 数据位置

| 形态 | 路径 |
|---|---|
| 开发 | `server/config.json` / `server/cache.json` / `server/history.json` / `server/auth/` |
| 安装版 | `%APPDATA%\Token Monitor\data\` 下的同名文件 |

### 10.4 敏感数据保护

- `config.json` 含 apiToken，`auth/` 含 Cookie/storageState — **不要提交或外传**
- `.gitignore` 已排除上述文件
- `GET /api/config` 脱敏：不返回 apiToken 原文，仅返回 `hasToken: boolean`
- `PUT /api/config` 合并保存：前端不回传 apiToken 时保留原值
- CORS 仅允许 `localhost / 127.0.0.1 / [::1]` 来源

---

## 11. 测试说明

### 11.1 后端单元测试

```bash
npm run test:server
```

执行 `node --test` 跑以下测试文件：

| 文件 | 覆盖内容 |
|---|---|
| [usage-date.test.mjs](file:///d:/MyTools/llm-token-monitor/server/usage-date.test.mjs) | 时区日期范围与 `/api/v1/usage/stats` 路径生成 |
| [cache-metrics.test.mjs](file:///d:/MyTools/llm-token-monitor/server/cache-metrics.test.mjs) | `extractCacheUsage` 三元组提取、`calculateWeightedCacheHitRate` 加权计算与零值回退 |
| [refresh-cache.test.mjs](file:///d:/MyTools/llm-token-monitor/server/refresh-cache.test.mjs) | `resolveRefreshTargets` / `mergeRefreshedProviders` / `preserveFailedProviderData` |

### 11.2 测试风格

- 使用 Node 内置 `node:test` + `node:assert/strict`
- 无外部测试框架依赖
- 每个文件以 `console.log('xxx test passed')` 结尾作为通过标记

### 11.3 前端测试

当前前端无单元测试覆盖。

---

## 12. 约定与扩展点

### 12.1 单位换算

- OneAPI quota 单位 = 500000 = $1（常量 `QUOTA_PER_DOLLAR`）
- browser 抓取的美元值在 `browserFetch` 中统一 ×500000 转为 quota 单位
- 前端用 `quotaToUSD()` 还原展示，避免各处分别换算

### 12.2 缓存命中率计算优先级

1. **加权**（`calculateWeightedCacheHitRate`）：所有 browser 站点的 `readTokens / (input+creation+read)`
2. **简单平均**：browser 站点 `cacheHitRate` 字段平均（兼容旧缓存）
3. **logs 占比**：OneAPI logs 中 `cacheHit=true` 的比例

返回时附带 `cacheHitRateMode: 'weighted' | 'average'` 标识实际使用的方式。

### 12.3 浏览器抓取的字段优先级

`fetchUsageMetrics` 抓到的 `todayTokens/todayCost/cacheHitRate/cacheInput/Creation/ReadTokens` 会**覆盖**选择器抓到的同名标量字段，因为使用趋势接口更准确。`balance` 与 `modelTable` 仍走选择器。

### 12.4 失败站点保留策略

`preserveFailedProviderData` 确保 `ok === false` 的 provider 不会用全 0 覆盖上次成功数据，避免偶发登录态失效导致 UI 清空。UI 通过 `stale: true` + `hasStaleProviders` 显示「数据延迟」提示。

### 12.5 扩展新的中转站类型

1. 在 [server/providers.js](file:///d:/MyTools/llm-token-monitor/server/providers.js) 中实现 `xxxFetch(cfg)` 函数，返回 `{ quota, usedQuota, logs, ... }`
2. 在 `ADAPTERS` 对象中注册：`xxx: xxxFetch`
3. 在 [Settings.jsx](file:///d:/MyTools/llm-token-monitor/src/pages/Settings/Settings.jsx) 的 `PROVIDER_TYPES` 数组中添加选项
4. 若需要登录流程，在 `loginProvider` 中添加分支

### 12.6 路由约定

- 前端路由：`/` `/analytics` `/combined` `/providers` `/settings` `/help`，`/reports` 重定向到 `/analytics`
- `?widget=1` 查询参数切换挂件视图（在 `App.jsx` 顶层短路渲染 `<Widget />`）
- `?provider=xxx` 查询参数指定中转站范围（由 `useProviderScope` 管理）
- 打包版用 `HashRouter`（`file://` 协议），开发版用 `BrowserRouter`

### 12.7 IPC 通道

| 通道 | 方向 | 说明 |
|---|---|---|
| `widget:hide` | renderer → main | 隐藏挂件 |
| `widget:open-dashboard` | renderer → main | 打开仪表盘窗口 |
| `widget:quit` | renderer → main | 退出应用（置 `app.isQuiting = true`） |

### 12.8 单实例锁

`app.requestSingleInstanceLock()` 确保全局只运行一个实例；二次启动触发 `second-instance` 事件，调用 `showWidget()` 唤起已有实例。

### 12.9 挂件窗口限制

- 默认尺寸：480 × 454
- 范围：宽 320–480，高 360–620
- resize 防抖 250ms 保存
- `close` 事件被拦截：仅 `hide()` 而非真正关闭，除非 `app.isQuiting`

### 12.10 模块封装风格

按用户偏好，模块**自包含**优先于共享抽象：

- `server/refresh-cache.js`、`server/cache-metrics.js`、`server/usage-date.js` 都是单一职责的小模块
- 前端组件就近放置 `.jsx` + `.module.css`，无全局共享样式系统
- API 工具函数集中在 `src/api/client.js`，未拆分

---

## 附录：常用命令速查

```bash
# 开发
npm ci                              # 安装依赖
npm run dev:desktop                 # 三进程开发（前端+后端+挂件）
npm run dev:all                     # 前后端 Web 预览
npm run dev                         # 仅前端
npm run dev:server                  # 仅后端

# 测试
npm run test:server                 # 后端单元测试

# 构建
npm run build                       # 前端构建到 dist/
npm run package:win                 # 生成 Windows NSIS 安装包到 release/

# 单独运行
npm run desktop                     # 仅 Electron（需前后端已启动）
npm run preview                     # Vite 预览构建产物
```

---

*文档生成时间：2026-07-29 · 对应仓库版本 v1.1.0*
