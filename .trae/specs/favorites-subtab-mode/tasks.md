# Tasks

- [x] Task 1: 后端改造 — 收藏夹 ID 持久化与视频列表数据加载
  - [x] SubTask 1.1: 在 BiliMainViewProvider 中新增 `lastFavoriteFolderId` 的 globalState 读写方法
  - [x] SubTask 1.2: 修改消息处理，新增 `clickFavoriteTab` 消息类型，用于子标签切换时保存收藏夹 ID 到 globalState 并加载视频列表
  - [x] SubTask 1.3: 修改 ViewDataLoader._loadFavoritesData，加载收藏夹列表后自动加载默认收藏夹（或上次打开的收藏夹）的视频列表数据，并将收藏夹列表和视频列表一起发送到前端
  - [x] SubTask 1.4: 修改 ViewDataLoader，新增收藏夹视频列表的分页加载逻辑（_loadFavoriteVideos），复用 getFavoriteVideos API
  - [x] SubTask 1.5: 在 BiliMainViewProvider 中新增 `_currentFavoriteId` 属性的管理逻辑，替换现有的简单数字，使其与 globalState 同步

- [x] Task 2: 前端改造 — 收藏夹子标签 UI 与交互逻辑
  - [x] SubTask 2.1: 新增 `buildFavoriteSubTabs(folders, activeId)` 函数，生成收藏夹子标签栏 HTML，复用 `.follow-sub-tab` 样式
  - [x] SubTask 2.2: 修改 `renderFavoriteFolders` 函数名和内容为 `renderFavorites`，渲染子标签栏 + 默认收藏夹视频列表
  - [x] SubTask 2.3: 新增 `renderFavoriteVideos(videos)` 函数，渲染收藏夹内的视频卡片列表（复用 buildVideoCards）
  - [x] SubTask 2.4: 在 contentEl 的 click 事件委托中新增收藏夹子标签 `.fav-sub-tab` 的点击事件处理，发送 `clickFavoriteTab` 消息并切前端子标签状态
  - [x] SubTask 2.5: 在 `appendListData` 中新增 `favoriteVideos` 视图类型的追加支持
  - [x] SubTask 2.6: 在 `renderListByView` 中修改 `favorites` 分支，调用新的 `renderFavorites` 渲染函数
  - [x] SubTask 2.7: 修改前端 state 管理，新增 `currentFavoriteId` 状态变量，恢复时从 savedState 中读取并同步到 globalState

- [x] Task 3: 前后端联调与持久化
  - [x] SubTask 3.1: 确保前端 `clickFavoriteTab` 消息能正确触发后端加载指定收藏夹的视频列表
  - [x] SubTask 3.2: 确保后端 `_loadFavoritesData` 返回的数据同时包含收藏夹列表和默认收藏夹的视频列表
  - [x] SubTask 3.3: 确保滚动懒加载在收藏夹视频列表中正常工作
  - [x] SubTask 3.4: 确保刷新按钮在收藏界面能重新加载收藏夹列表和当前收藏夹的视频列表

# Task Dependencies
- Task 2 依赖 Task 1（前端需要后端提供完整数据结构才能渲染）
- Task 3 依赖 Task 1 和 Task 2（联调需要前后端都完成）