# 独立弹幕面板重构 Spec

## Why
当前弹幕输出到 VSCode 的输出面板通道（bilidm），用户体验不佳：输出面板与代码输出混在一起，不便于阅读和交互。改为独立弹幕面板后，弹幕可集中展示、自动滚动，并支持用户发送弹幕，形成更好的实时互动体验。

## What Changes
- **新增** 独立弹幕面板（VSCode WebviewView），替代原 OutputChannel 弹幕输出方式
- **新增** 弹幕面板 UI：纯文字弹幕列表区域（支持自动滚动到底部）+ 底部发送弹幕输入框
- **新增** 发送弹幕功能：直播弹幕发送（调用 B站 msg/send API）、视频弹幕发送（调用 B站 dmpost/post API）
- **重构** 直播弹幕输出：从 OutputChannel 转发到弹幕面板 Webview
- **重构** 视频弹幕输出：从 OutputChannel 转发到弹幕面板 Webview
- **移除** OutputChannelManager 中弹幕相关方法（showDanmakuChannel、clearDanmakuChannel、appendDanmaku、getDanmakuChannel），保留日志通道

## Impact
- Affected specs: bili-live-browser（弹幕输出方式变更）
- Affected code:
  - `src/utils/outputChannelManager.ts` - 移除弹幕通道相关方法
  - `src/webview/BiliMainViewProvider.ts` - 弹幕连接逻辑转发到弹幕面板
  - `src/webview/videoDanmakuTracker.ts` - 弹幕推送目标变更
  - `src/webview/danmakuPanelProvider.ts` - 新增弹幕面板提供者
  - `src/webview/danmakuPanelHtml.ts` - 新增弹幕面板 HTML 模板
  - `src/services/danmakuService.ts` - 新增弹幕发送方法
  - `src/services/biliApi.ts` - 新增弹幕发送 API 调用
  - `src/extension.ts` - 注册弹幕面板视图
  - `package.json` - 注册弹幕面板视图和命令

## ADDED Requirements

### Requirement: 独立弹幕面板
系统 SHALL 在 VSCode 侧边栏下方注册一个独立的弹幕面板（WebviewView），用于实时展示弹幕和发送弹幕。

#### Scenario: 打开直播时弹幕面板自动激活
- **WHEN** 用户点击直播间进入播放
- **THEN** 弹幕面板自动显示并开始接收实时弹幕
- **THEN** 弹幕面板底部显示输入框，带有当前登录用户标识

#### Scenario: 打开视频时弹幕面板自动激活
- **WHEN** 用户点击视频进入播放
- **THEN** 弹幕面板自动显示并开始按视频进度输出弹幕
- **THEN** 弹幕面板底部显示输入框

#### Scenario: 关闭播放时弹幕面板清理
- **WHEN** 用户从播放器返回列表
- **THEN** 弹幕面板清空弹幕内容，断开连接

### Requirement: 弹幕自动滚动
系统 SHALL 在弹幕面板中实现自动滚动功能，新弹幕到达时自动滚动到底部。

#### Scenario: 新弹幕到达时自动滚动
- **WHEN** 弹幕面板接收到新弹幕且当前滚动位置在底部附近（距底部 ≤100px）
- **THEN** 自动滚动到最新弹幕位置

#### Scenario: 用户向上浏览时暂停自动滚动
- **WHEN** 用户手动向上滚动弹幕（距底部 >100px）
- **THEN** 新弹幕到达时不自动滚动，保留用户浏览位置
- **THEN** 显示"回到底部"悬浮按钮，点击后恢复自动滚动

### Requirement: 弹幕面板发送弹幕
系统 SHALL 在弹幕面板底部提供输入框，允许已登录用户发送弹幕。

#### Scenario: 直播间发送弹幕
- **WHEN** 用户在弹幕面板输入弹幕文本并按回车或点击发送按钮
- **THEN** 调用 B站 msg/send API 发送弹幕到当前直播间
- **THEN** 发送成功后清空输入框
- **THEN** 发送失败时显示错误提示

#### Scenario: 视频中发送弹幕
- **WHEN** 用户在弹幕面板输入弹幕文本并按回车或点击发送按钮
- **THEN** 调用 B站 dmpost/post API 发送弹幕到当前视频（附带当前播放时间）
- **THEN** 发送成功后清空输入框并本地追加显示该弹幕
- **THEN** 发送失败时显示错误提示

#### Scenario: 未登录时发送弹幕
- **WHEN** 用户未登录时尝试在弹幕面板发送弹幕
- **THEN** 输入框显示为禁用状态并提示"请先登录"

### Requirement: 弹幕面板 UI 样式
系统 SHALL 为弹幕面板提供清晰美观的 UI 样式。

#### Scenario: 弹幕列表样式
- **WHEN** 弹幕面板显示弹幕列表时
- **THEN** 直播弹幕格式为 `[HH:mm:ss] <用户名> 弹幕内容`
- **THEN** 视频弹幕格式为 `[mm:ss] 弹幕内容`
- **THEN** 醒目留言（SC）弹幕带有特殊颜色标识
- **THEN** 礼物弹幕带有礼物图标标识

#### Scenario: 弹幕面板布局
- **WHEN** 弹幕面板显示时
- **THEN** 上部为弹幕滚动列表区域（占大部分高度）
- **THEN** 下部为输入框和发送按钮（固定在底部）
- **THEN** 输入框在未登录时显示为禁用状态

## MODIFIED Requirements

### Requirement: 弹幕输出到弹幕面板
系统 SHALL 将弹幕内容输出到独立弹幕面板，不再输出到 VSCode 输出面板通道。

直播弹幕和视频弹幕都通过弹幕面板 Webview 展示，弹幕面板提供自动滚动和发送弹幕功能。

> 原需求"弹幕输出到输出面板"已被此需求完全替代。

## REMOVED Requirements

### Requirement: 弹幕输出到输出面板通道
**Reason**: 已被新的独立弹幕面板需求完全替代，弹幕不再使用 OutputChannel 输出方式。
**Migration**: OutputChannelManager 中的弹幕通道方法将被移除，所有弹幕输出改为通过弹幕面板 Webview 显示。