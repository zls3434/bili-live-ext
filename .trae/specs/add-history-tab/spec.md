# 浏览历史标签页 Spec

## Why
当前插件缺少浏览历史功能，用户无法回顾自己观看过的视频和直播。B站官方提供了完整的浏览历史API（获取、上报、删除），可以直接对接，实现与B站客户端/网页端同步的浏览历史体验。同时需要在用户观看视频/直播时自动上报浏览记录到B站，保持跨设备历史同步。

## What Changes
- **新增** 主标签栏增加"历史"标签按钮
- **新增** 历史标签内包含"视频"和"直播"两个子标签，用于分类浏览历史
- **新增** `ContentView` 枚举增加 `historyVideos` 和 `historyLives` 两个视图值
- **新增** `HistoryApiService` 服务类，封装B站官方浏览历史API（获取历史列表、上报浏览记录、删除单条记录、搜索历史）
- **新增** `HistoryItem` 类型定义，描述历史记录条目的数据结构
- **新增** 历史历史视图数据加载逻辑（`_loadHistoryVideosData` 和 `_loadHistoryLivesData`）
- **新增** 历史视图前端渲染逻辑（子标签栏、视频历史卡片、直播历史卡片）
- **新增** 用户观看视频/直播时自动上报浏览记录到B站API
- **修改** `BiliApiService` 增加 `HistoryApiService` 实例并暴露相关方法
- **修改** `_pageState` 和 `_viewHasData` 增加历史视图的分页和缓存状态
- **修改** `htmlTemplate.ts` 主标签栏增加"历史"按钮，新增子标签切换逻辑和卡片渲染
- **修改** `BiliMainViewProvider.ts` 增加历史视图消息处理、浏览上报触发

## Impact
- Affected specs: enhance-follow-list（关注列表功能，新增浏览上报逻辑）
- Affected code:
  - `src/types/index.ts` — 新增 `HistoryItem` 接口和 `ContentView` 枚举值
  - `src/services/historyApi.ts` — 新建，封装B站浏览历史API
  - `src/services/biliApi.ts` — 增加 `HistoryApiService` 实例和方法代理
  - `src/services/index.ts` — 导出 `HistoryApiService`
  - `src/webview/viewDataLoader.ts` — 新增历史视图数据加载方法
  - `src/webview/BiliMainViewProvider.ts` — 增加历史视图消息处理、浏览上报调用
  - `src/webview/htmlTemplate.ts` — 主标签增加历史按钮，新增历史视图渲染逻辑

## ADDED Requirements

### Requirement: 历史标签页UI
系统 SHALL 在主标签栏增加"历史"标签按钮，点击后展示历史视图。历史视图内包含"视频"和"直播"两个子标签，用于分类浏览历史记录。

#### Scenario: 用户点击历史标签
- **WHEN** 用户点击主标签栏中的"历史"按钮
- **THEN** 切换到历史视图，默认显示"视频"子标签
- **AND** 自动加载用户的视频浏览历史列表
- **AND** 高亮"历史"主标签按钮

#### Scenario: 用户点击直播子标签
- **WHEN** 用户在历史视图中点击"直播"子标签
- **THEN** 切换到直播浏览历史列表
- **AND** 自动加载用户的直播浏览历史

#### Scenario: 视频子标签与直播子标签切换
- **WHEN** 用户在"视频"和"直播"子标签之间切换
- **THEN** 保留各自的滚动位置和数据缓存
- **AND** 仅在首次进入子标签或刷新时加载数据

#### Scenario: 历史列表空数据
- **WHEN** 用户没有浏览历史记录
- **THEN** 显示空状态提示"暂无浏览历史"

### Requirement: B站官方浏览历史数据加载
系统 SHALL 调用B站官方浏览历史API获取用户的浏览历史记录，支持视频和直播两种类型的历史数据。历史列表按浏览时间倒序排列（最近观看的排在最上面），并使用懒加载机制，滚动到底部时自动加载下一页。

#### Scenario: 加载视频浏览历史
- **WHEN** 用户进入历史视图的视频子标签
- **THEN** 调用 `/x/web-interface/history/cursor` API，参数 `type=archive`
- **AND** 解析返回数据为 `HistoryItem` 列表，展示视频标题、封面、UP主、观看进度、观看时间等信息
- **AND** 列表按浏览时间倒序排列（B站API默认返回顺序即为倒序，无需前端额外排序）
- **AND** 首次加载仅请求第一页数据（默认每页20条），不一次性加载全部历史

#### Scenario: 加载直播浏览历史
- **WHEN** 用户进入历史视图的直播子标签
- **THEN** 调用 `/x/web-interface/history/cursor` API，参数 `type=live`
- **AND** 解析返回数据为 `HistoryItem` 列表，展示直播间标题、封面、主播信息等
- **AND** 列表按浏览时间倒序排列（最近观看的直播排在最上面）
- **AND** 首次加载仅请求第一页数据，不一次性加载全部历史

#### Scenario: 懒加载更多历史数据
- **WHEN** 用户滚动到历史列表底部附近（距离底部 50px 以内）
- **AND** 当前还有更多数据未加载（`hasMore` 为 true）
- **AND** 当前没有正在进行的加载请求（`loading` 为 false）
- **THEN** 使用上次返回的 `cursor.view_at` 作为下一页请求的 `view_at` 参数
- **AND** 调用 API 获取下一页数据
- **AND** 将新数据追加到现有列表末尾（保持浏览时间倒序）
- **AND** 当 API 返回空列表或没有更多数据时，标记 `hasMore` 为 false，停止懒加载
- **AND** 懒加载期间显示加载指示器（旋转动画 + "加载更多..." 文字）

#### Scenario: 分页状态管理
- **WHEN** 历史视图首次进入或刷新时
- **THEN** 重置分页游标（`view_at` 清空）和 `hasMore` 标记
- **AND** 清空当前列表数据，重新从第一页开始加载

### Requirement: 浏览记录自动上报
系统 SHALL 在用户观看视频或直播时，自动调用B站官方API上报浏览记录，确保B站客户端/网页端的浏览历史与插件同步。

#### Scenario: 用户开始观看视频
- **WHEN** 用户在插件中点击视频卡片开始播放视频
- **THEN** 调用 `/x/web-interface/history/report` API，上报视频浏览记录
- **AND** 上报参数包含 `bvid`、`cid`（如有）、`progress=0`、`csrf`
- **AND** 上报失败时仅记录日志，不影响用户观看体验

#### Scenario: 用户开始观看直播
- **WHEN** 用户在插件中点击直播卡片开始观看直播
- **THEN** 调用 `/x/web-interface/history/report` API，上报直播浏览记录
- **AND** 上报参数包含 `aid=roomId`、`type=2`、`csrf`
- **AND** 上报失败时仅记录日志，不影响用户观看体验

### Requirement: 浏览历史卡片渲染
系统 SHALL 将浏览历史条目渲染为卡片列表，与现有的视频/直播卡片样式保持一致，并额外展示观看进度和观看时间信息。

#### Scenario: 视频历史卡片渲染
- **WHEN** 渲染一条视频类型的浏览历史
- **THEN** 卡片展示：封面图、标题、UP主名称、播放次数、视频时长
- **AND** 如果有观看进度（`progress > 0` 且 `progress !== -1`），在封面图上叠加进度条
- **AND** 显示观看时间（如"2小时前"、"昨天 14:30"）

#### Scenario: 直播历史卡片渲染
- **WHEN** 渲染一条直播类型的浏览历史
- **THEN** 卡片展示：直播间封面图、标题、主播名称
- **AND** 在卡片右上角显示"LIVE"标签（如果直播间仍在直播中）
- **AND** 显示观看时间

### Requirement: 历史视图点击跳转播放
系统 SHALL 支持用户点击历史卡片直接跳转播放对应的视频或直播。

#### Scenario: 点击视频历史卡片
- **WHEN** 用户点击一条视频类型的浏览历史卡片
- **THEN** 使用卡片中的 `bvid` 调用 `openVideo(bvid)` 开始播放视频

#### Scenario: 点击直播历史卡片
- **WHEN** 用户点击一条直播类型的浏览历史卡片
- **THEN** 使用卡片中的 `roomId` 调用 `openLive(roomId)` 开始观看直播

## MODIFIED Requirements

### Requirement: ContentView 枚举新增历史视图
原 `ContentView` 枚举仅包含关注、收藏、推荐等视图，现新增 `historyVideos` 和 `historyLives` 两个视图值，用于展示视频和直播浏览历史。

#### Scenario: 新增视图类型
- **WHEN** 用户切换到历史标签
- **THEN** 根据当前子标签设置 `currentView` 为 `ContentView.historyVideos` 或 `ContentView.historyLives`
- **AND** 对应的数据加载、消息处理、前端渲染逻辑均基于 `ContentView` 枚举值分发