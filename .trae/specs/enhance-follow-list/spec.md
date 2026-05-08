# 关注列表增强 Spec

## Why
当前关注列表只展示了已关注主播的名称和头像，缺乏新视频更新提醒、排序和交互功能，用户无法直观知道哪些主播有新视频发布，也无法快速查看某个主播的视频列表。

## What Changes
- **新增** 关注主播新视频红点提醒功能，红点提示该主播有未查看的新视频发布
- **新增** 关注列表按新视频更新时间排序，有新视频发布的主播排在上面
- **新增** 点击关注列表中的主播条目，进入该主播发布的视频列表（使用已有的 `getUserVideos` API）
- **新增** 用户查看主播视频列表后，取消红点提示，记录查看时间戳（持久化到 globalState）
- **修改** `FollowApiService.getUserVideos` 已存在但目前未被关注列表使用，需要在流程中调用
- **修改** `_loadFollowsData` 方法需要为每个关注者获取最新视频信息并判断是否有更新
- **修改** `buildFollowCards` 前端渲染需要增加红点标记和点击跳转逻辑
- **修改** `ContentView` 枚举新增 `followsUpVideos` 子视图，用于展示某个UP主的视频列表
- **新增** `globalState` 持久化存储：记录用户查看每个UP主视频列表的时间戳

## Impact
- Affected specs: bili-live-browser（主规格）
- Affected code:
  - `src/types/index.ts` — 新增 `ContentView.followsUpVideos` 枚举值和 `FollowUpVideoViewData` 类型
  - `src/services/followApi.ts` — 无需修改（`getUserVideos` 已存在）
  - `src/services/biliApi.ts` — 确认 `getUserVideos` 已暴露
  - `src/webview/viewDataLoader.ts` — 新增 `_loadFollowsUpVideosData` 方法；修改 `_loadFollowsData` 增加新视频判断逻辑
  - `src/webview/BiliMainViewProvider.ts` — 处理新消息类型 `clickFollowUp` 和 `markFollowViewed`
  - `src/webview/htmlTemplate.ts` — 修改关注卡片渲染（红点、排序、点击事件）；新增UP主视频列表视图渲染
  - `src/services/sessionManager.ts` 或新建 `src/services/viewHistoryManager.ts` — 持久化查看时间戳

## ADDED Requirements

### Requirement: 关注主播新视频红点提醒
系统 SHALL 在关注列表中，对有新视频发布的主播显示红点标记，表示有未查看的更新。

#### Scenario: 主播有新视频发布
- **WHEN** 主播发布了新视频（视频发布时间 > 用户上次查看该主播视频列表的时间）
- **THEN** 该主播的关注卡片右侧显示红色圆点（或"有更新"徽标）

#### Scenario: 主播无新视频发布
- **WHEN** 主播最近发布视频的时间 <= 用户上次查看时间，或主播从未发布过视频
- **THEN** 该主播的关注卡片不显示红点

#### Scenario: 用户从未查看过某主播的视频列表
- **WHEN** 用户从未进入过某主播的视频列表（globalState 中无该 mid 的查看记录）
- **THEN** 以 `followViewInitTime`（插件首次初始化关注列表的时间）作为基准时间，在此之后发布的视频视为新视频，显示红点
- **NOTE** `followViewInitTime` 持久化到 globalState，仅首次初始化时创建并保存，后续启动直接读取，不会因插件重启或更新而重置

### Requirement: 有新视频的主播置顶排序
系统 SHALL 将有新视频更新的主播排在关注列表的上方，无更新的主播排在下方。

#### Scenario: 关注列表排序
- **WHEN** 关注列表数据加载完成
- **THEN** 有红点提醒（有新视频）的主排在列表上方
- **THEN** 无红点提醒的主播排在列表下方
- **THEN** 同组内按最新视频发布时间倒序排列

### Requirement: 点击主播进入视频列表
系统 SHALL 允许用户点击关注列表中的主播条目，进入该主播发布的视频列表视图。

#### Scenario: 点击主播条目
- **WHEN** 用户点击关注列表中的某个主播条目
- **THEN** 切换到 `followsUpVideos` 子视图
- **THEN** 显示该主播发布的视频列表（调用 `getUserVideos` API）
- **THEN** 显示返回按钮，可返回关注列表

### Requirement: 查看后取消红点提醒
系统 SHALL 在用户进入某主播的视频列表后，取消该主播的红点提醒。

#### Scenario: 用户查看主播视频列表
- **WHEN** 用户通过点击关注列表进入某主播的视频列表
- **THEN** 记录当前时间戳到 `globalState`（key: `followViewTime.${mid}`）
- **THEN** 返回关注列表后，该主播不再显示红点

#### Scenario: 主播再次发布新视频
- **WHEN** 该主播在用户上次查看后又发布了新视频
- **THEN** 红点提醒重新出现

### Requirement: 视图历史时间戳持久化
系统 SHALL 将用户查看每个主播视频列表的时间戳持久化到 `globalState`，确保插件重启后数据不丢失。

#### Scenario: 时间戳存储
- **WHEN** 用户查看某主播视频列表
- **THEN** 时间戳以 `followViewTime.${mid}` 为 key 存入 `globalState`
- **THEN** 插件重启后时间戳仍然可用

#### Scenario: 初始化基准时间
- **WHEN** 插件首次加载关注列表功能且 `followViewInitTime` 尚不存在于 globalState
- **THEN** 创建 `followViewInitTime`（当前时间戳）并持久化到 globalState（key: `followViewInitTime`）
- **THEN** 后续每次插件启动，直接从 globalState 读取已有的 `followViewInitTime`，不再重新创建
- **WHEN** 插件非首次加载（globalState 中已存在 `followViewInitTime`）
- **THEN** 直接使用已有的 `followViewInitTime` 作为未查看主播的基准时间
- **NOTE** 该机制确保插件重启/更新后不会重置已查看状态或基准时间

## MODIFIED Requirements

### Requirement: 关注列表数据加载增强
原 `_loadFollowsData` 方法仅获取关注列表基本信息（mid、uname、face），现需要同时获取每个关注者的最新视频信息，用于判定是否有新视频发布。

#### Scenario: 增强的关注列表数据加载
- **WHEN** 加载关注列表数据
- **THEN** 对每个关注者调用 `getUserVideos(mid, 1, 1)` 获取最新一条视频
- **THEN** 将最新视频的发布时间与用户上次查看时间对比，决定是否显示红点
- **THEN** 按是否有新视频分组排序后返回前端

### Requirement: ContentView 枚举新增子视图
原 `ContentView` 枚举包含 `follows`、`followsVideos`、`followsLive` 等视图，现新增 `followsUpVideos` 视图用于展示某个UP主的视频列表。

#### Scenario: 新增视图类型
- **WHEN** 用户在关注列表点击某主播
- **THEN** 切换到 `ContentView.followsUpVideos` 视图
- **THEN** 该视图展示特定UP主（通过 mid 标识）的视频列表