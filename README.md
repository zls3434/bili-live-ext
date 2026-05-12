# B站直播与视频浏览器 (bili-live-ext)

在 VSCode / Trae 中浏览 B站（bilibili）直播和视频的扩展插件，无需离开编辑器即可查看关注的动态、收藏的视频以及平台推荐内容。

## 功能特性

- **侧边栏抽屉** — 在资源管理器下方增加 bilibili 浏览抽屉，方便随时切换
- **扫码登录** — 通过 B站 App 扫码登录，登录态自动缓存，重启后无需重新登录
- **五大内容视图**：
  - **我的关注** — 查看关注 UP主列表及直播状态，支持子标签切换（关注动态 / 关注直播中 / UP主视频列表），红点提醒新增视频
  - **我的收藏** — 浏览收藏夹列表及收藏的视频，支持收藏夹子标签快速切换，自动记忆上次浏览位置
  - **推荐视频** — 浏览平台推荐的视频
  - **推荐直播间** — 浏览在播的推荐直播间，展示分区信息
  - **浏览历史** — 查看视频和直播的浏览历史，支持子标签切换（视频历史 / 直播历史），展示观看进度
- **侧边栏内播放** — 点击视频或直播间直接在抽屉中播放，支持基础媒体控制（播放/暂停、音量、进度条）
- **本地代理服务器** — 内置 HTTP 代理服务器绕过 B站 CDN 403 防盗链，支持自动重定向跟随
- **独立弹幕面板** — 底部面板区域提供独立的交互式弹幕面板，支持：
  - 直播弹幕实时推送（WebSocket 连接）
  - 视频弹幕按播放进度同步
  - 发送弹幕（直播弹幕 / 视频弹幕）
  - 入场/关注/分享等交互消息提示
  - 自动滚动与手动滚动切换
- **浏览历史上报** — 观看视频/直播时自动上报浏览记录到 B站
- **返回列表** — 播放界面一键返回上级列表，完整导航历史支持
- **分页加载** — 所有列表视图支持滚动到底部自动加载更多

## 安装

### 方式一：从 VSIX 安装

1. 下载最新版本的 `.vsix` 文件（或通过 `./build.sh` 自行构建）
2. 在 VSCode 中按 `Cmd+Shift+P`（macOS）或 `Ctrl+Shift+P`（Windows/Linux）
3. 输入 `Extensions: Install from VSIX...`
4. 选择 `.vsix` 文件完成安装

### 方式二：命令行安装

```bash
code --install-extension bili-live-ext-0.1.2.vsix
```

## 使用说明

1. 安装后，点击 VSCode 侧边栏资源管理器下方的 **bilibili** 图标
2. 首次使用点击「登录」按钮，使用 B站 App 扫描二维码登录
3. 登录成功后，通过顶部 Tab 切换不同内容视图
4. 点击视频或直播间条目可直接在抽屉中播放
5. 播放时弹幕实时显示在底部面板区域的「弹幕」面板中
6. 在弹幕面板中可输入文字发送弹幕（需登录）

## 开发

### 环境要求

- Node.js >= 18
- npm >= 9

### 构建

```bash
# 安装依赖
npm install

# 开发模式编译（监听文件变化）
npm run watch

# 生产模式编译
npm run package

# 一键编译打包（生成 .vsix）
./build.sh

# 跳过 lint 或类型检查的打包
./build.sh --skip-lint
./build.sh --skip-typecheck
```

### 调试

1. 在 VSCode 中打开本项目
2. 按 `F5` 启动扩展开发主机
3. 在新窗口中测试扩展功能

### 项目结构

```
bili-live-ext/
├── src/
│   ├── extension.ts                  # 扩展入口，注册视图和命令
│   ├── types/index.ts                # 全局类型定义（接口、枚举）
│   ├── webview/
│   │   ├── BiliMainViewProvider.ts   # 侧边栏主视图提供者
│   │   ├── DanmakuPanelProvider.ts   # 独立弹幕面板提供者
│   │   ├── htmlTemplate.ts          # 主视图 HTML 模板生成
│   │   ├── danmakuPanelHtml.ts      # 弹幕面板 HTML 模板生成
│   │   ├── videoDanmakuTracker.ts   # 视频弹幕进度追踪器
│   │   └── viewDataLoader.ts        # 视图数据加载器
│   ├── services/
│   │   ├── baseBiliApi.ts           # B站 API 基础服务（请求封装）
│   │   ├── biliApi.ts               # B站 API 聚合服务（委托子服务）
│   │   ├── biliLogin.ts             # 扫码登录服务
│   │   ├── sessionManager.ts       # 会话管理（Cookie 持久化）
│   │   ├── userApi.ts              # 用户信息 API
│   │   ├── followApi.ts            # 关注列表 API
│   │   ├── favoriteApi.ts          # 收藏夹 API
│   │   ├── videoApi.ts             # 视频信息与播放 API
│   │   ├── liveApi.ts              # 直播间信息与播放 API
│   │   ├── recommendApi.ts         # 推荐内容 API
│   │   ├── danmakuApi.ts           # 弹幕发送 API
│   │   ├── danmakuService.ts       # 弹幕 WebSocket 服务
│   │   ├── historyApi.ts          # 浏览历史 API
│   │   ├── viewHistoryManager.ts  # 观看时间戳管理（红点提醒）
│   │   ├── proxyServer.ts         # 本地代理服务器
│   │   └── index.ts               # 服务层统一导出
│   └── utils/
│       ├── index.ts                # 工具函数
│       ├── logger.ts               # 全局日志管理器
│       └── outputChannelManager.ts # 输出通道管理
├── media/
│   ├── icon.png                    # 插件图标
│   └── flv.min.js                  # FLV 播放库
├── package.json                    # 扩展清单
├── tsconfig.json                    # TypeScript 配置
├── webpack.config.js                # Webpack 配置
├── build.sh                         # 一键编译打包脚本
└── LICENSE                          # 许可证
```

## 命令

| 命令                   | 说明            |
| -------------------- | ------------- |
| `bilibili.login`     | B站扫码登录        |
| `bilibili.openVideo` | 打开视频（输入 BV 号） |
| `bilibili.openLive`  | 打开直播（输入房间号）   |
| `bilibili.goBack`    | 返回上一页         |

## 技术架构

- **前端渲染**：Webview + 原生 HTML/CSS/JS，B站粉色主题（#FB7299）
- **状态保持**：`retainContextWhenHidden` 保留 Webview 上下文，前端 `vscode.getState/setState` 恢复 UI
- **媒体播放**：视频（MP4/DASH）、直播（FLV via flv.js）
- **弹幕系统**：直播弹幕（WebSocket 实时通信）、视频弹幕（按播放进度同步），支持弹幕发送
- **代理转发**：内置 HTTP 代理服务器，自动添加 Referer 头绕过 CDN 防盗链，支持最多 5 次重定向跟随
- **API 架构**：`BiliApiService` 委托模式，按业务领域拆分为 `UserApiService`、`FollowApiService`、`VideoApiService` 等子服务
- **数据缓存**：视图级数据缓存 + 分页状态管理，避免切换 Tab 时重复加载
- **持久化**：登录态 Cookie 通过 `globalState` 持久化，收藏夹选中状态自动记忆

## AI 开发声明

本项目在开发过程中完全使用 AI 辅助编程工具（Claude Code / Trae AI）进行代码生成和优化。声明如下：

- **免责声明**：本软件按「原样」提供，不提供任何明示或暗示的保证，包括但不限于适销性、特定用途的适用性和非侵权性。使用本软件所产生的任何风险由用户自行承担
- **问题与缺陷**：本项目不保证软件完全没有 bug 或问题，亦不对因使用本软件造成的任何直接、间接、附带、特殊或后果性损害承担责任
- **版权声明**：本项目尊重他人知识产权。如认为本项目内容涉及版权侵权，请通过 [GitHub Issues](https://github.com/zls3434/bili-live-ext/issues) 联系维护者，核实后将及时删除相关内容

## License

MIT License — 详见 [LICENSE](LICENSE) 文件，包含所有第三方依赖的 license 声明。
