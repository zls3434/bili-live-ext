# Checklist

- [x] ViewHistoryManager 已创建，支持 getViewTime、setViewTime、getInitTime、getViewTimesBatch 方法
- [x] ContentView 枚举新增 followsUpVideos 视图类型
- [x] FollowUpVideoViewData 接口定义完成（包含 mid、uname、face、videos 字段）
- [x] _loadFollowsData 能获取每个关注者的最新视频并判断红点状态
- [x] 关注列表数据按 hasNewVideo 分组排序（有新视频排在上方）
- [x] 前端关注卡片正确渲染红点标记
- [x] 关注卡片点击事件正确发送 clickFollowUp 消息
- [x] UP主视频列表数据加载逻辑（_loadFollowsUpVideosData）实现完成
- [x] UP主视频列表视图渲染完成（含返回按钮、UP主信息、视频卡片列表）
- [x] clickFollowUp 消息处理逻辑实现（设置 currentUpMid、标记已查看、切换视图）
- [x] markFollowViewed 消息处理逻辑实现（记录查看时间戳到 globalState）
- [x] 从 followsUpVideos 视图返回关注列表时重新加载数据（刷新红点状态）
- [x] _pageState 和 _viewHasData 新增 followsUpVideos 条目
- [x] TypeScript 编译通过，零错误
- [x] 初始化基准时间（followViewInitTime）正确创建并持久化到 globalState，仅首次创建，后续启动直接读取已有值