# Tasks

- [x] Task 1: 新增视图历史时间戳持久化管理器（ViewHistoryManager）
  - [x] 1.1 创建 `src/services/viewHistoryManager.ts`，封装 globalState 读写逻辑
  - [x] 1.2 实现 `getViewTime(mid)` 方法：返回用户上次查看某UP主视频列表的时间戳（毫秒），若无记录返回 null
  - [x] 1.3 实现 `setViewTime(mid)` 方法：记录当前时间戳到 globalState（key: `followViewTime.${mid}`）
  - [x] 1.4 实现 `getInitTime()` 方法：从 globalState 读取 `followViewInitTime`；若不存在则创建当前时间戳并持久化（仅首次创建，后续启动直接读取已有值，不会因插件重启/更新而重置）
  - [x] 1.5 实现 `getViewTimesBatch(mids: number[])` 方法：批量获取多个UP主的查看时间，若无记录则使用 `getInitTime()` 作为回退值返回

- [x] Task 2: 新增 ContentView.followsUpVideos 枚举值和类型定义
  - [x] 2.1 在 `src/types/index.ts` 中 ContentView 枚举新增 `followsUpVideos = 'followsUpVideos'`，表示"某UP主的视频列表"视图
  - [x] 2.2 在 `src/types/index.ts` 中新增 `FollowUpVideoViewData` 接口，包含 `mid`（UP主ID）、`uname`（UP主名称）、`face`（头像URL）、`videos`（视频列表）字段

- [x] Task 3: 增强关注列表数据加载逻辑（viewDataLoader.ts）
  - [x] 3.1 修改 `_loadFollowsData` 方法：加载关注列表后，并发调用 `getUserVideos(mid, 1, 1)` 获取每个关注者的最新一条视频信息
  - [x] 3.2 在 `_loadFollowsData` 中引入 ViewHistoryManager，获取每个 mid 的上次查看时间和初始化基准时间
  - [x] 3.3 为每个关注者数据增加 `latestVideo`、`hasNewVideo`（是否有新视频红点）、`latestPubDate`（最新视频发布时间戳）字段
  - [x] 3.4 按 `hasNewVideo` 分组排序：有新视频的排在上面，同组内按 `latestPubDate` 倒序排列
  - [x] 3.5 在 BiliMainViewProvider 的 `_pageState` 和 `_viewHasData` 中新增 `followsUpVideos` 条目

- [x] Task 4: 新增"UP主视频列表"数据加载逻辑
  - [x] 4.1 在 `viewDataLoader.ts` 中新增 `_loadFollowsUpVideosData(mid)` 方法，调用 `getUserVideos(mid)` 获取UP主的视频列表
  - [x] 4.2 在 `loadViewData` 中根据当前视图类型和 `currentUpMid` 分支调用 `_loadFollowsUpVideosData`
  - [x] 4.3 在 BiliMainViewProvider 中新增 `currentUpMid` 临时状态，记录当前查看的UP主 mid
  - [x] 4.4 在 BiliMainViewProvider 消息监听中新增 `clickFollowUp` 消息处理

- [x] Task 5: 前端关注卡片渲染增强（红点 + 排序 + 点击跳转）
  - [x] 5.1 修改 `buildFollowCards` 函数：为有新视频的卡片增加红点/徽标标记 CSS
  - [x] 5.2 修改 `renderFollowingList` 函数：数据已由后端排序，前端直接渲染
  - [x] 5.3 为关注卡片添加 `onclick` 事件，发送 `clickFollowUp` 消息（携带 `mid`、`uname`、`face`）
  - [x] 5.4 新增关注卡片红点 CSS 样式（红色小圆点或"新视频"标记）

- [x] Task 6: 新增UP主视频列表视图的前端渲染
  - [x] 6.1 新增 `renderFollowsUpVideos(videos, upInfo)` 函数，显示UP主头像+名称+返回按钮+视频卡片列表
  - [x] 6.2 新增 `buildFollowSubTabs` 中的返回按钮（从UP主视频列表返回关注列表）
  - [x] 6.3 在 `renderListByView` 中新增 `followsUpVideos` 视图的渲染分支
  - [x] 6.4 在关注子Tab切换逻辑中支持 `followsUpVideos` 视图

- [x] Task 7: 消息通信与状态管理
  - [x] 7.1 在 BiliMainViewProvider `onDidReceiveMessage` 中处理 `clickFollowUp` 消息：设置 `currentUpMid`，记录查看时间戳，切换到 `followsUpVideos` 视图并加载数据
  - [x] 7.2 在 BiliMainViewProvider 中通过 `clickFollowUp` 消息处理调用 ViewHistoryManager.setViewTime(mid)
  - [x] 7.3 修改 `goBack` 方法：从 `followsUpVideos` 返回时，重新加载关注列表数据以刷新红点状态
  - [x] 7.4 在 `_loadViewData` 中增加 `followsUpVideos` 视图的加载分支

- [ ] Task 8: 集成测试与验证
  - [ ] 8.1 验证关注列表加载时能正确显示红点提醒
  - [ ] 8.2 验证有新视频的主播排在列表上方
  - [ ] 8.3 验证点击主播条目可进入视频列表
  - [ ] 8.4 验证查看视频列表后红点消失
  - [ ] 8.5 验证主播发布新视频后红点重新出现
  - [ ] 8.6 验证插件重启后查看时间戳仍然有效

# Task Dependencies
- Task 1 是 Task 3 和 Task 7 的前置依赖（ViewHistoryManager 需要先实现）
- Task 2 是 Task 3、4、6、7 的前置依赖（类型定义需要先确定）
- Task 3 依赖 Task 1 和 Task 2
- Task 4 依赖 Task 2
- Task 5 依赖 Task 3（前端渲染依赖后端数据结构变更）
- Task 6 依赖 Task 2 和 Task 4
- Task 7 依赖 Task 1、Task 4、Task 6
- Task 8 依赖所有其他 Task 完成