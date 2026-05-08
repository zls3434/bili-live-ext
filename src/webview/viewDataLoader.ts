/**
 * @file src/webview/viewDataLoader.ts
 * @description 视图数据加载服务
 *
 * 主要功能：
 * - 从 B站 API 加载各视图的数据（关注、动态、直播、收藏、推荐等）
 * - 通过回调将数据发送到 Webview 前端
 * - 管理加载状态和分页参数
 *
 * @author zls3434
 * @date 2026-05-02
 * @modification 2026-05-05 zls3434 修复关注直播中列表的两个 Bug：
 *           1. 主播名称显示为"未知主播"：原 getUserLiveStatus 使用的 getRoomInfoOld API 不返回 uname 字段，
 *              改用 batchGetUsersLiveStatus 批量查询 API（get_status_info_by_uids）
 *           2. 直播列表不完整：原 getMyFollowing 只获取前50个关注，改用 getAllFollowings 自动分页获取全部关注
 * @modification 2026-05-06 zls3434 性能优化——关注直播中列表加载耗时从约4秒降到1秒以内：
 *           1. getAllFollowings 串行分页改为并发分页（14次串行请求→1次+并发13次）
 *           2. batchGetUsersLiveStatus 串行批次改为并发批次（14次串行请求→并发14次）
 * @modification 2026-05-07 zls3434 增强关注列表数据加载，增加新视频红点判断逻辑
 * @modification 2026-05-07 zls3434 新增关注UP主视频列表视图数据加载：
 *           1. 新增 currentUpMid 和 currentUpInfo 公开属性，用于存储当前查看的UP主信息
 *           2. 新增 _loadFollowsUpVideosData 私有方法，调用 getUserVideos API 获取UP主视频列表
 *           3. 在 loadViewData 中新增 ContentView.followsUpVideos 分支
 *           4. 响应数据中合并 currentUpInfo（mid/uname/face）与 videos，供前端渲染UP主信息栏
 */

import { ContentView, LiveRoomInfo, VideoInfo } from '../types';
import { BiliApiService } from '../services/biliApi';
import { DanmakuService } from '../services/danmakuService';
import { ViewHistoryManager } from '../services/viewHistoryManager';
import { OutputChannelManager } from '../utils/outputChannelManager';
import { logger } from '../utils/logger';

type PageState = { page: number; hasMore: boolean; loading: boolean; feedOffset?: string };

export type PostMessageFn = (message: Record<string, unknown>) => void;

export interface ViewDataLoaderDeps {
  /** B站 API 服务实例，用于调用各类 B站接口 */
  apiService: BiliApiService;
  /** 弹幕服务实例，用于直播间弹幕相关功能 */
  danmakuService: DanmakuService;
  /** 查看历史管理器，用于追踪用户上次查看各UP主视频列表的时间戳，判断是否有新视频 */
  viewHistoryManager: ViewHistoryManager;
  /** 输出通道管理器，用于日志输出 */
  outputChannelManager: OutputChannelManager;
  /** 向 Webview 前端发送消息的回调函数 */
  postMessage: PostMessageFn;
  /** 各视图的分页状态映射 */
  pageState: Record<string, PageState>;
  /** 各视图是否已有数据的标记映射 */
  viewHasData: Record<string, boolean>;
}

export class ViewDataLoader {
  /** B站 API 服务实例 */
  private apiService: BiliApiService;
  /** 弹幕服务实例 */
  private danmakuService: DanmakuService;
  /** 查看历史管理器，追踪用户查看UP主视频列表的时间，用于判断是否有新视频 */
  private viewHistoryManager: ViewHistoryManager;
  /** 输出通道管理器 */
  private outputChannelManager: OutputChannelManager;
  /** 向 Webview 前端发送消息的回调 */
  private postMessage: PostMessageFn;
  /** 各视图的分页状态 */
  private pageState: Record<string, PageState>;
  /** 各视图是否已有数据的标记 */
  private viewHasData: Record<string, boolean>;

  /**
   * 当前查看的UP主 mid
   *
   * 用于 ContentView.followsUpVideos 视图加载时确定要查询哪个UP主的视频列表。
   * 外部在切换到 followsUpVideos 视图前需要先设置此值。
   * 默认值为 0 表示未选择任何UP主。
   */
  currentUpMid: number = 0;

  /**
   * 当前查看的UP主信息
   *
   * 存储UP主的基本资料（mid、用户名、头像），用于在前端渲染UP主信息栏。
   * 外部在切换到 followsUpVideos 视图前通过消息将UP主信息传入并设置到此属性。
   * 默认值为 null 表示未选择任何UP主。
   */
  currentUpInfo: { mid: number; uname: string; face: string } | null = null;

  /**
   * 清除关注列表全局排序缓存
   *
   * 用于强制刷新（用户点击刷新按钮）时清除缓存，
   * 使下次加载关注列表时重新完整获取数据。
   *
   * 修改日期：2026-05-07
   * 修改人：zls3434
   */
  clearFollowsCache(): void {
    this._followsSortedCache = null;
  }

  /**
   * 重新排序关注列表缓存（不重新获取数据）
   *
   * 当用户从UP主视频列表返回关注列表时调用。
   * 仅重新计算红点状态并排序，不发起任何网络请求。
   * 原理：重新读取 globalState 中的查看时间戳，与缓存中的视频发布时间对比，
   * 更新 hasNewVideo 标记后重新排序。
   *
   * 修改日期：2026-05-07
   * 修改人：zls3434
   */
  async reorderFollowsCache(): Promise<void> {
    if (!this._followsSortedCache || this._followsSortedCache.length === 0) {
      return;
    }

    /* 重新获取所有关注UP主的查看时间戳 */
    const mids = this._followsSortedCache.map(f => f.mid);
    const viewTimesMap = await this.viewHistoryManager.getViewTimesBatch(mids);

    /* 更新缓存中每个关注者的红点状态 */
    for (const item of this._followsSortedCache) {
      const latestPubDateMs = item.latestPubDate * 1000;
      const viewTimeMs = viewTimesMap[item.mid] ?? 0;
      item.hasNewVideo = item.latestVideo !== null && latestPubDateMs > viewTimeMs;
    }

    /* 重新全局排序 */
    this._followsSortedCache.sort((a, b) => {
      if (a.hasNewVideo !== b.hasNewVideo) {
        return a.hasNewVideo ? -1 : 1;
      }
      return (b.latestPubDate ?? 0) - (a.latestPubDate ?? 0);
    });
  }

  constructor(deps: ViewDataLoaderDeps) {
    this.apiService = deps.apiService;
    this.danmakuService = deps.danmakuService;
    this.viewHistoryManager = deps.viewHistoryManager;
    this.outputChannelManager = deps.outputChannelManager;
    this.postMessage = deps.postMessage;
    this.pageState = deps.pageState;
    this.viewHasData = deps.viewHasData;
  }

  private _markViewHasData(view: string): void {
    this.viewHasData[view] = true;
  }

  async loadViewData(view: ContentView): Promise<void> {
    switch (view) {
      case ContentView.follows:
        await this._loadFollowsData();
        break;
      case ContentView.followsVideos:
        await this._loadFollowsVideosData();
        break;
      case ContentView.followsLive:
        await this._loadFollowsLiveData();
        break;
      case ContentView.favorites:
        await this._loadFavoritesData();
        break;
      case ContentView.recommendedVideos:
        await this._loadRecommendedVideosData();
        break;
      case ContentView.followsUpVideos:
        /* 仅当已设置当前UP主 mid 时才加载数据，否则跳过 */
        if (this.currentUpMid) {
          await this._loadFollowsUpVideosData(this.currentUpMid);
        }
        break;
      case ContentView.recommendedLives:
        await this._loadRecommendedLivesData();
        break;
    }
  }

  /**
   * 全局排序后的关注列表数据缓存
   *
   * 由于 B站关注列表 API 不支持按最新视频排序，
   * 需要先获取全部关注者、批量查询最新视频后全局排序，
   * 再基于排序后的数据做内存分页展示。
   *
   * 修改日期：2026-05-07
   * 修改人：zls3434
   */
  private _followsSortedCache: Array<{
    mid: number; uname: string; face: string; liveRoom: LiveRoomInfo | null;
    videos: VideoInfo[]; latestVideo: VideoInfo | null; hasNewVideo: boolean; latestPubDate: number;
  }> | null = null;

  /**
   * 加载关注列表视图数据
   *
   * 加载策略（三种模式）：
   * 1. 无缓存（首次加载）：获取全部关注者 → 并发查询最新视频 → 全局排序 → 缓存
   * 2. 有缓存（Tab切换、翻页）：直接从缓存分页返回，不发起网络请求
   * 3. 强制刷新（用户点击刷新按钮）：先清除缓存，再走模式1
   *
   * 从UP主视频列表返回时，调用 reorderFollowsCache() 仅重算红点排序，不走此方法。
   *
   * 并发控制：
   * 使用并发池模式，最大30个并发请求，所有请求尽快发出，
   * 完成一个立即发起下一个，避免批次等待造成的延迟。
   *
   * @modification 2026-05-07 zls3434 增强关注列表数据加载，增加新视频红点判断逻辑
   * @modification 2026-05-07 zls3434 改为全局排序+内存分页，确保有新视频的主播排在整个列表最前面
   * @modification 2026-05-07 zls3434 优化并发策略，从批次并发改为并发池模式，大幅提升加载速度
   * @modification 2026-05-07 zls3434 优化加载策略：有缓存时直接分页返回，不重新获取数据
   */
  private async _loadFollowsData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this.postMessage({ type: 'updateListData', view: ContentView.follows, data: [], error: '请先登录后再查看关注列表', hasMore: false });
      return;
    }

    const state = this.pageState['follows'];
    if (state.loading) { return; }
    state.loading = true;

    const PAGE_SIZE = 20;

    try {
      /* 有缓存时直接从缓存分页返回，不重新获取数据（Tab切换、翻页等场景） */
      if (!this._followsSortedCache) {
        /* 无缓存（首次加载）：获取全部关注者并全局排序 */
        const allFollows = await this.apiService.getAllFollowings(mid);

        /* 并发池请求每个关注UP主的最新一条视频
         * 并发池模式：最多同时进行 MAX_CONCURRENT 个请求，完成一个立即发起下一个 */
        const MAX_CONCURRENT = 30;
        const latestVideoMap = new Map<number, VideoInfo | null>();
        const followQueue = [...allFollows];
        let queueIndex = 0;

        const processNext = async (): Promise<void> => {
          while (queueIndex < followQueue.length) {
            const follow = followQueue[queueIndex++];
            try {
              const videos = await this.apiService.getUserVideos(follow.mid, 1, 1);
              latestVideoMap.set(follow.mid, videos.length > 0 ? videos[0] : null);
            } catch {
              latestVideoMap.set(follow.mid, null);
            }
          }
        };

        const poolTasks: Promise<void>[] = [];
        for (let i = 0; i < Math.min(MAX_CONCURRENT, followQueue.length); i++) {
          poolTasks.push(processNext());
        }
        await Promise.all(poolTasks);

        /* 批量获取每个关注UP主的上次查看时间戳（本地读取，几乎瞬时完成） */
        const mids = allFollows.map(f => f.mid);
        const viewTimesMap = await this.viewHistoryManager.getViewTimesBatch(mids);

        /* 构建关注列表数据，判断是否有新视频 */
        const allFollowItems = allFollows.map((follow) => {
          const latestVideo = latestVideoMap.get(follow.mid) ?? null;
          const latestPubDate = latestVideo?.pubdate ?? 0;
          const latestPubDateMs = latestPubDate * 1000;
          const viewTimeMs = viewTimesMap[follow.mid] ?? 0;
          const hasNewVideo = latestVideo !== null && latestPubDateMs > viewTimeMs;

          return {
            mid: follow.mid,
            uname: follow.uname,
            face: follow.face ? follow.face.replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://') : '',
            liveRoom: null as LiveRoomInfo | null,
            videos: [] as VideoInfo[],
            latestVideo,
            hasNewVideo,
            latestPubDate,
          };
        });

        /* 全局排序——有新视频的主播排在整个列表最上面 */
        allFollowItems.sort((a, b) => {
          if (a.hasNewVideo !== b.hasNewVideo) {
            return a.hasNewVideo ? -1 : 1;
          }
          return (b.latestPubDate ?? 0) - (a.latestPubDate ?? 0);
        });

        /* 缓存全局排序后的数据 */
        this._followsSortedCache = allFollowItems;
      }

      /* 基于缓存做内存分页 */
      const cache = this._followsSortedCache!;
      const totalCount = cache.length;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
      const currentPage = state.page;
      const startIndex = (currentPage - 1) * PAGE_SIZE;
      const pageData = cache.slice(startIndex, startIndex + PAGE_SIZE);
      const hasMore = currentPage < totalPages;

      state.hasMore = hasMore;
      this._markViewHasData('follows');
      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.follows,
        data: pageData,
        hasMore,
      });
    } catch (error) {
      this.postMessage({ type: 'updateListData', view: ContentView.follows, data: [], error: `获取关注列表失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  private async _loadFollowsVideosData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this.postMessage({ type: 'updateListData', view: ContentView.followsVideos, data: [], error: '请先登录后再查看关注动态', hasMore: false });
      return;
    }

    const state = this.pageState['followsVideos'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const feedResult = await this.apiService.getFollowFeedVideos(state.feedOffset || '');
      const videos = [...feedResult.videos].sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0));

      logger.info(`关注动态: 获取 ${videos.length} 条视频, hasMore=${feedResult.hasMore}`);

      state.feedOffset = feedResult.offset;
      state.hasMore = feedResult.hasMore;
      this._markViewHasData('followsVideos');

      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.followsVideos,
        data: videos,
        hasMore: feedResult.hasMore,
      });
    } catch (error) {
      this.postMessage({ type: 'updateListData', view: ContentView.followsVideos, data: [], error: `获取关注动态失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 加载关注直播中视图数据
   *
   * 修改日期：2026-05-05
   * 修改人：zls3434
   * 修改目的：
   * 1. 使用 batchGetUsersLiveStatus 批量查询 API 替代原有的 getUserLiveStatus 逐个查询，
   *    解决 getRoomInfoOld API 返回数据缺少 uname 字段导致主播名显示为"未知主播"的问题，
   *    同时大幅减少 HTTP 请求数量（从 N 降到 ceil(N/50)）
   * 2. 使用 getAllFollowings 替代 getMyFollowing 单页获取，自动分页获取全部关注，
   *    解决只获取前50个关注导致直播列表不完整的问题
   * 3. 批量 API 返回数据包含分区信息，直接映射到 parentAreaName/areaName
   * 修改日期：2026-05-06
   * 修改人：zls3434
   * 修改目的：性能优化——将串行批量查询改为并发批量查询。
   *          原实现逐批串行请求（678关注需14批串行请求），改为并发请求所有批次，
   *          整体耗时从 O(n) 降到 O(1) 级别，配合 getAllFollowings 的并发优化可实现秒内响应
   */
  private async _loadFollowsLiveData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this.postMessage({ type: 'updateListData', view: ContentView.followsLive, data: [], error: '请先登录后再查看直播列表', hasMore: false });
      return;
    }

    const state = this.pageState['followsLive'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      /* 自动分页获取全部关注的UP主列表（并发优化） */
      const followList = await this.apiService.getAllFollowings(mid);

      if (followList.length === 0) {
        this._markViewHasData('followsLive');
        state.hasMore = false;
        this.postMessage({
          type: 'updateListData',
          view: ContentView.followsLive,
          data: [],
          hasMore: false,
        });
        return;
      }

      /* 提取所有关注的UP主 mid，用于批量查询 */
      const allMids = followList.map(f => f.mid);

      /* 将 mid 数组按每批 50 个分组，并发请求所有批次 */
      const BATCH_SIZE = 50;
      const batchPromises: Promise<LiveRoomInfo[]>[] = [];

      for (let i = 0; i < allMids.length; i += BATCH_SIZE) {
        const batchMids = allMids.slice(i, i + BATCH_SIZE);
        batchPromises.push(this.apiService.batchGetUsersLiveStatus(batchMids));
      }

      /* 并行等待所有批量查询请求完成 */
      const batchResults = await Promise.all(batchPromises);
      const liveRooms: LiveRoomInfo[] = batchResults.flat();

      logger.info(`关注直播中: 共检查 ${allMids.length} 个关注，${liveRooms.length} 个正在直播`);

      this._markViewHasData('followsLive');

      state.hasMore = false;
      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.followsLive,
        data: liveRooms,
        hasMore: false,
      });
    } catch (error) {
      this.postMessage({ type: 'updateListData', view: ContentView.followsLive, data: [], error: `获取关注直播失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  private async _loadFavoritesData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: [],
        error: '请先登录后再查看收藏夹',
      });
      return;
    }

    try {
      const favorites = await this.apiService.getFavorites(mid);
      this.postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: favorites,
      });
    } catch (error) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: [],
        error: `获取收藏夹失败: ${error}`,
      });
    }
  }

  private async _loadRecommendedVideosData(): Promise<void> {
    const state = this.pageState['recommendedVideos'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const result = await this.apiService.getRecommendedVideos(state.page);
      state.hasMore = result.hasMore;
      this._markViewHasData('recommendedVideos');
      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.recommendedVideos,
        data: result.list,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this.postMessage({ type: 'updateListData', view: ContentView.recommendedVideos, data: [], error: `获取推荐视频失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 加载关注UP主视频列表视图数据
   *
   * 根据当前设置的 currentUpMid 调用 getUserVideos API 获取该UP主的视频列表，
   * 并将 currentUpInfo（mid、uname、face）与视频列表合并后发送到前端。
   *
   * @param {number} upMid - 要查看的UP主 mid
   * @modification 2026-05-07 zls3434 新增方法，支持从关注列表点击进入UP主视频列表
   */
  private async _loadFollowsUpVideosData(upMid: number): Promise<void> {
    const state = this.pageState['followsUpVideos'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      /* 获取UP主的视频列表（第一页，30条） */
      const videos = await this.apiService.getUserVideos(upMid, 1, 30);

      /* 合并UP主信息与视频列表，供前端渲染UP主信息栏 */
      const upInfo = this.currentUpInfo || { mid: upMid, uname: '', face: '' };
      const data = {
        ...upInfo,
        videos,
      };

      this._markViewHasData('followsUpVideos');
      state.hasMore = false;
      this.postMessage({
        type: 'updateListData',
        view: ContentView.followsUpVideos,
        data,
        hasMore: false,
      });
    } catch (error) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.followsUpVideos,
        data: [],
        error: `获取UP主视频列表失败: ${error}`,
        hasMore: false,
      });
    } finally {
      state.loading = false;
    }
  }

  private async _loadRecommendedLivesData(): Promise<void> {
    const state = this.pageState['recommendedLives'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const result = await this.apiService.getRecommendedLives(state.page);
      state.hasMore = result.hasMore;
      this._markViewHasData('recommendedLives');
      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.recommendedLives,
        data: result.list,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this.postMessage({ type: 'updateListData', view: ContentView.recommendedLives, data: [], error: `获取推荐直播失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }
}