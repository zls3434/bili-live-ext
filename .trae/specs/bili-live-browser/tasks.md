# Tasks

- [x] Task 1: 项目脚手架搭建
  - [x] 1.1 初始化 VSCode 扩展项目（package.json、tsconfig.json、webpack 配置）
  - [x] 1.2 创建基础项目目录结构（src/services、src/webview、src/utils、media）
  - [x] 1.3 编写 extension.ts 入口文件，注册 activate/deactivate 生命周期
- [x] Task 2: 侧边栏抽屉容器（已在 BiliMainViewProvider 中实现）
  - [x] 2.1 在 package.json 中注册 viewsContainers（explorer 位置）和对应的 views
  - [x] 2.2 实现 WebviewViewProvider（BiliMainViewProvider），承载导航和内容 WebView
  - [x] 2.3 在 extension.ts 中注册 WebviewViewProvider
- [x] Task 3: B站 API 服务层
  - [x] 3.1 实现 B站扫码登录 API 服务（获取 QR 码、轮询登录状态）- biliLogin.ts
  - [x] 3.2 实现会话管理服务（cookie/token 缓存读写、登录态校验）- sessionManager.ts
  - [x] 3.3 实现用户内容 API 服务（关注列表、收藏列表、推荐视频、推荐直播）- biliApi.ts
  - [x] 3.4 实现视频/直播播放地址解析 API 服务和视频弹幕XML获取 - biliApi.ts
- [x] Task 4: 扫码登录与会话缓存（已在 BiliMainViewProvider 中实现）
  - [x] 4.1 在主 WebView 中实现登录界面（QR 码展示区域）
  - [x] 4.2 实现 QR 码轮询逻辑（定时查询扫码状态，每3秒轮询，180秒超时）
  - [x] 4.3 实现登录成功后的 cookie 持久化存储（使用 ExtensionContext.globalState）
  - [x] 4.4 插件启动时自动恢复登录态校验（_restoreSession）
- [x] Task 5: 顶部导航与内容列表（已在 BiliMainViewProvider 中实现）
  - [x] 5.1 在主 WebView 顶部实现4个Tab切换按钮（我的关注/我的收藏/推荐视频/推荐直播间）
  - [x] 5.2 实现内容列表组件（卡片式列表，封面+标题+UP主+播放量+时长）
  - [x] 5.3 实现各视图的数据加载与渲染（关注含直播状态、收藏夹、推荐视频、推荐直播）
  - [x] 5.4 集成 WebView 与扩展主进程的消息通信（switchView/clickVideo/clickLive等）
- [x] Task 6: 视频/直播播放器（已在 BiliMainViewProvider 中实现）
  - [x] 6.1 实现播放器页面（HTML/CSS/JS），通过原生video标签播放
  - [x] 6.2 实现播放器控制栏（播放/暂停、音量、进度条点击跳转、时间显示/LIVE标识）
  - [x] 6.3 实现 WebView 内页面路由（列表页 ↔ 播放器页切换，隐藏/显示Tab栏）
  - [x] 6.4 实现「返回列表」按钮及其状态切换逻辑（含播放器资源清理）
- [x] Task 7: 弹幕输出通道
  - [x] 7.1 实现 OutputChannel 管理服务，创建「bilidm」输出通道 - outputChannelManager.ts
  - [x] 7.2 实现直播弹幕 WebSocket 协议解析服务 - danmakuService.ts (Brotli协议)
  - [x] 7.3 实现视频弹幕XML获取与解析 - danmakuService.parseVideoDanmakuXML
  - [x] 7.4 弹幕数据通过 OutputChannel 输出，不在视频上叠加（集成在 BiliMainViewProvider 中）
- [x] Task 8: 集成测试与错误处理
  - [x] 8.1 全局错误捕获与用户友好的错误提示（所有async方法均有try-catch + showErrorMessage）
  - [x] 8.2 TypeScript编译通过，零错误
  - [x] 8.3 登录态持久化机制完整（globalState存储 + 启动自动恢复 + 有效期校验）

# Task Dependencies

所有任务已完成。项目已具备完整的B站直播和视频浏览功能。