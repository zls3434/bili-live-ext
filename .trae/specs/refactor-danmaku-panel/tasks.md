# Tasks

- [x] Task 1: 注册弹幕面板视图
  - [x] 1.1 在 package.json 的 contributes.views 中注册 bilibili-danmaku-panel 视图（explorer 位置）
  - [x] 1.2 弹幕发送通过 Webview 消息机制实现，无需在 package.json 注册独立命令
  - [x] 1.3 在 extension.ts 中注册 DanmakuPanelProvider 并绑定到 bilibili-danmaku-panel 视图
- [x] Task 2: 创建弹幕面板 HTML 模板
  - [x] 2.1 创建 src/webview/danmakuPanelHtml.ts，生成弹幕面板 Webview 的完整 HTML
  - [x] 2.2 实现弹幕列表区域（纯文字展示，自动滚动，回到底部按钮）
  - [x] 2.3 实现底部输入框 + 发送按钮（未登录时禁用）
  - [x] 2.4 实现前端消息处理逻辑（接收弹幕数据、发送弹幕消息、自动滚动控制）
- [x] Task 3: 创建弹幕面板提供者
  - [x] 3.1 创建 src/webview/DanmakuPanelProvider.ts，实现 WebviewViewProvider 接口
  - [x] 3.2 实现 appendDanmaku 方法：向弹幕面板推送弹幕数据
  - [x] 3.3 实现 clearDanmaku 方法：清空弹幕面板内容
  - [x] 3.4 实现激活/显示弹幕面板逻辑
  - [x] 3.5 处理前端发送弹幕消息，调用后端发送 API
- [x] Task 4: 实现弹幕发送 API
  - [x] 4.1 在 biliApi.ts 中实现 sendLiveDanmaku 方法（调用 msg/send 直播弹幕发送接口）
  - [x] 4.2 在 biliApi.ts 中实现 sendVideoDanmaku 方法（调用 dmpost/post 视频弹幕发送接口）
- [x] Task 5: 重构弹幕输出目标
  - [x] 5.1 修改 BiliMainViewProvider，将直播弹幕回调从 OutputChannel 改为 DanmakuPanelProvider
  - [x] 5.2 修改 VideoDanmakuTracker，将弹幕推送目标从 OutputChannel 改为 DanmakuPanelProvider
  - [x] 5.3 修改 BiliMainViewProvider 在 openVideo/openLive 时激活弹幕面板
  - [x] 5.4 修改 BiliMainViewProvider 在 goBack 时清理弹幕面板
  - [x] 5.5 移除 OutputChannelManager 中弹幕相关方法（showDanmakuChannel、clearDanmakuChannel、appendDanmaku、getDanmakuChannel）
- [x] Task 6: 视频弹幕发送携带当前播放时间
  - [x] 6.1 在 BiliMainViewProvider 中维护当前视频播放时间（从 videoProgress 消息更新）
  - [x] 6.2 将当前视频播放时间传递给 DanmakuPanelProvider，用于发送视频弹幕时附带进度时间
- [x] Task 7: 编译验证与错误处理
  - [x] 7.1 TypeScript 编译通过，零错误
  - [x] 7.2 所有弹幕发送场景的错误处理（未登录、发送失败、网络错误）

# Task Dependencies
- Task 2 依赖 Task 3（HTML 模板由 Provider 引用）
- Task 4 依赖 Task 3（发送 API 由 Provider 调用）
- Task 5 依赖 Task 1 和 Task 3（重构需要弹幕面板 Provider 已创建）
- Task 6 依赖 Task 3 和 Task 5
- Task 7 依赖以上所有 Task