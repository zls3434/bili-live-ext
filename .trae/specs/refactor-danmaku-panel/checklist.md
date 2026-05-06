# Checklist

- [x] package.json 中注册了 bilibili-danmaku-panel 视图（弹幕发送通过 Webview 消息机制实现，无需独立命令）
- [x] extension.ts 中注册了 DanmakuPanelProvider 并绑定到弹幕面板视图
- [x] 弹幕面板 HTML 包含弹幕列表区域、输入框和发送按钮
- [x] 弹幕面板支持自动滚动（距底部 ≤100px 时自动滚动，否则显示回到底部按钮）
- [x] 弹幕面板未登录时输入框显示为禁用状态并提示"请先登录"
- [x] DanmakuPanelProvider 实现了 appendDanmaku、clearDanmaku、activate 方法
- [x] 直播弹幕通过 DanmakuPanelProvider 推送到弹幕面板
- [x] 视频弹幕通过 DanmakuPanelProvider 推送到弹幕面板
- [x] BiliMainViewProvider 在 openVideo/openLive 时激活弹幕面板
- [x] BiliMainViewProvider 在 goBack 时清理弹幕面板内容
- [x] biliApi.ts 实现了 sendLiveDanmaku 方法（直播弹幕发送接口）
- [x] biliApi.ts 实现了 sendVideoDanmaku 方法（视频弹幕发送接口）
- [x] 弹幕面板发送弹幕后清空输入框
- [x] 弹幕发送失败时显示错误提示
- [x] 视频弹幕发送时携带当前播放时间
- [x] OutputChannelManager 中弹幕相关方法已移除
- [x] TypeScript 编译通过，零错误