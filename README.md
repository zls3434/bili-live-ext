# B站直播与视频浏览器 (bili-live-ext)

在 VSCode 中浏览 B站（bilibili）直播和视频的扩展插件，无需离开编辑器即可查看关注的动态、收藏的视频以及平台推荐内容。

## 功能特性

- **侧边栏抽屉** — 在资源管理器下方增加 bilibili 浏览抽屉，方便随时切换
- **扫码登录** — 通过 B站 App 扫码登录，登录态自动缓存，重启后无需重新登录
- **四大内容视图**：
  - **我的关注** — 查看关注 UP主列表及直播状态
  - **我的收藏** — 浏览收藏夹及收藏的视频
  - **推荐视频** — 浏览平台推荐的视频
  - **推荐直播间** — 浏览在播的推荐直播间
- **侧边栏内播放** — 点击视频或直播间直接在抽屉中播放，支持基础媒体控制（播放/暂停、音量、进度条）
- **返回列表** — 播放界面一键返回上级列表
- **弹幕输出** — 弹幕不在视频上叠加显示，输出到 VSCode 输出面板的「bilidm」通道

## 安装

### 方式一：从 VSIX 安装

1. 下载最新版本的 `.vsix` 文件（或通过 `./build.sh` 自行构建）
2. 在 VSCode 中按 `Cmd+Shift+P`（macOS）或 `Ctrl+Shift+P`（Windows/Linux）
3. 输入 `Extensions: Install from VSIX...`
4. 选择 `.vsix` 文件完成安装

### 方式二：命令行安装

```bash
code --install-extension bili-live-ext-0.0.1.vsix
```

## 使用说明

1. 安装后，点击 VSCode 侧边栏资源管理器下方的 **bilibili** 图标
2. 首次使用点击「登录」按钮，使用 B站 App 扫描二维码登录
3. 登录成功后，通过顶部 Tab 切换不同内容视图
4. 点击视频或直播间条目可直接在抽屉中播放
5. 播放时弹幕实时输出到输出面板的「bilidm」通道（查看方式：`Cmd+Shift+U` 打开输出面板，选择「bilidm」）

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
```

### 调试

1. 在 VSCode 中打开本项目
2. 按 `F5` 启动扩展开发主机
3. 在新窗口中测试扩展功能

### 项目结构

```
bili-live-ext/
├── src/
│   ├── extension.ts                 # 扩展入口
│   ├── types/index.ts               # 类型定义
│   ├── webview/
│   │   └── BiliMainViewProvider.ts  # 侧边栏主视图
│   ├── services/
│   │   ├── biliLogin.ts             # 扫码登录
│   │   ├── sessionManager.ts        # 会话管理
│   │   ├── biliApi.ts               # B站 API
│   │   └── danmakuService.ts        # 弹幕服务
│   └── utils/
│       └── outputChannelManager.ts  # 输出通道
├── media/
│   └── icon.png                     # 插件图标
├── package.json                     # 扩展清单
├── tsconfig.json                    # TypeScript 配置
├── webpack.config.js                # Webpack 配置
├── build.sh                         # 一键编译打包脚本
└── LICENSE                          # 许可证
```

## 命令

| 命令 | 说明 |
|------|------|
| `bilibili.login` | B站扫码登录 |
| `bilibili.openVideo` | 打开视频（输入 BV 号） |
| `bilibili.openLive` | 打开直播（输入房间号） |
| `bilibili.goBack` | 返回上一页 |

## License

MIT License — 详见 [LICENSE](LICENSE) 文件，包含所有第三方依赖的 license 声明。