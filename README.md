# Token Monitor

跨中转站的 Token 用量监控工具，提供 Web 仪表盘和 Windows 桌面挂件。

## 功能

- 汇总 OneAPI / NewAPI 的余额、调用量、Token 和费用
- 通过浏览器登录态读取没有开放 API 的中转站
- 查看模型分布、历史趋势和缓存命中率
- 桌面挂件常驻显示关键指标，支持记忆窗口大小
- 数据、配置和登录态保存在本机，不上传到第三方服务

## Windows 安装

1. 在项目的 `release/` 目录找到 `Token Monitor Setup 1.1.0.exe`。
2. 双击安装，可选择安装目录，并创建桌面和开始菜单快捷方式。
3. 安装完成后启动 Token Monitor。挂件会自动显示，托盘图标提供更多操作。
4. 点击挂件中的“打开仪表盘”，在“设置”页添加中转站。

当前安装包未做代码签名，Windows SmartScreen 可能显示提醒。确认安装包来源可信后再继续。

### 首次配置

没有配置时，应用会显示示例数据，不代表真实账户数据。

OneAPI / NewAPI 中转站：

1. 在设置页新建 Provider，类型选择 `oneapi` 或 `newapi`。
2. 填写中转站 `baseUrl` 和系统访问令牌。
3. 保存后点击刷新，确认余额和日志能够读取。

需要浏览器登录的中转站：

1. 类型选择 `browser`，填写登录地址和数据页地址。
2. 填写页面字段对应的 CSS 选择器，或使用页面上的选择器拾取功能。
3. 点击登录，在打开的 Microsoft Edge 窗口中完成登录，再点击“完成登录并保存”。
4. 回到仪表盘刷新数据。

浏览器抓取功能使用 Microsoft Edge 的已安装版本。请先确保电脑已安装 Edge。这样可以避免安装包内置数百 MB 的重复浏览器运行时。

## 桌面挂件

右键托盘图标可以：

- 显示挂件
- 打开仪表盘
- 重置挂件大小
- 退出应用

默认挂件大小为 `480 × 454`，可拖动窗口边缘调整，关闭后会记住上次尺寸。视频背景会自动播放、静音和循环。

## 本机数据位置

安装版数据位于：

```text
%APPDATA%\Token Monitor\data
```

其中包括：

- `config.json`：Provider 配置和 API Token
- `auth\`：浏览器登录态
- `cache.json`：最近一次抓取结果
- `history.json`：历史汇总数据

这些文件包含敏感信息，不要提交到 Git 或发送给他人。删除 `data` 目录会清除本机配置、登录态和历史数据。

## 开发运行

环境要求：Node.js 18 或更高版本，Windows / macOS / Linux 均可运行开发环境。

```bash
npm ci
npm run dev:desktop
```

开发模式会同时启动：

- Vite 前端：`http://127.0.0.1:5173`
- Express 后端：`http://127.0.0.1:3002`
- Electron 桌面挂件

只启动前后端网页：

```bash
npm run dev:all
```

## 构建与打包

构建前端：

```bash
npm run build
```

生成 Windows x64 NSIS 安装包：

```bash
npm run package:win
```

安装包输出到 `release/`。打包时不会包含 `server/config.json`、缓存、历史记录或 `server/auth/` 中的本地登录态；安装版会在 `%APPDATA%\Token Monitor\data` 中创建自己的运行数据。

运行服务端测试：

```bash
npm run test:server
```

## 常见问题

### 启动后显示示例数据

这是未配置 Provider 的默认状态。打开仪表盘的“设置”页，添加并保存至少一个中转站后再刷新。

### 浏览器 Provider 显示未登录

在设置页重新执行登录流程。登录态保存在本机 `data\auth\`，清理该目录后需要重新登录。

### 安装后修改源码没有生效

安装版读取打包后的 `dist/`。源码修改后需要重新运行 `npm run package:win` 并安装新生成的安装包；开发调试请使用 `npm run dev:desktop`。

## 项目结构

```text
src/        React 前端和页面
server/     Express API、Provider 适配器和浏览器抓取
electron/   Electron 主进程与桌面挂件通信
public/     视频、海报和静态资源
dist/       Vite 前端构建产物
release/    Electron 安装包输出目录
```
