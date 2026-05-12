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
 * @modification 2026-05-08 zls3434 收藏夹子标签模式后端改造：
 *           1. ViewDataLoaderDeps 新增 getCurrentFavoriteId/setCurrentFavoriteId 回调
 *           2. 新增 currentFavoriteId 公开属性，外部设置当前选中的收藏夹 ID
 *           3. 重构 _loadFavoritesData：同时返回收藏夹列表和默认选中收藏夹的视频列表
 *           4. 新增 _loadFavoriteVideos 私有方法，独立加载指定收藏夹的视频列表
 *           5. loadViewData 中 favorites 分支新增分页加载支持（page>1 仅加载视频）
 * @modification 2026-05-09 zls3434 新增历史视频和历史直播视图数据加载：
 *           1. 新增 _loadHistoryVideosData 私有方法，调用 getHistoryCursor API 获取视频浏览历史，使用游标分页实现懒加载
 *           2. 新增 _loadHistoryLivesData 私有方法，调用 getHistoryCursor API 获取直播浏览历史，使用游标分页实现懒加载
 *           3. 在 loadViewData 中新增 ContentView.historyVideos 和 ContentView.historyLives 分支
 * @modification 2026-05-12 zls3434 关注列表异步加载优化——先显示列表，红点异步更新：
 *           1. 修改 _loadFollowsData：首次加载时先获取关注者列表并以 hasNewVideo:false 状态立即返回，
 *              然后异步启动并发池查询每个关注者的最新视频，查询完成后更新红点状态并重新排序发送给前端
 *           2. 前端会收到两次 updateListData（第一次无红点，第二次有红点），实现快速响应
 *           3. 新增 _asyncUpdateFollowsRedDots 私有方法，封装异步红点更新逻辑
 */

import { ContentView, LiveRoomInfo, VideoInfo, HistoryItem, LiveArea, LiveSortType } from '../types';
import { BiliApiService } from '../services/biliApi';
import { DanmakuService } from '../services/danmakuService';
import { ViewHistoryManager } from '../services/viewHistoryManager';
import { OutputChannelManager } from '../utils/outputChannelManager';
import { logger } from '../utils/logger';

type PageState = { page: number; hasMore: boolean; loading: boolean; feedOffset?: string; areaId?: LiveArea; sortType?: LiveSortType };

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
  /**
   * 获取当前选中的收藏夹 ID 的回调函数
   *
   * 返回 BiliMainViewProvider 中 _currentFavoriteId 的当前值，
   * 用于收藏夹子标签模式下确定默认选中的收藏夹。
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：新增回调，支持收藏夹子标签模式
   *
   * @returns {number} 当前选中的收藏夹 ID，0 表示未选中
   */
  getCurrentFavoriteId: () => number;
  /**
   * 设置当前选中的收藏夹 ID 的回调函数
   *
   * 当 ViewDataLoader 确定（或需要更新）当前选中的收藏夹时调用，
   * 会同步更新 BiliMainViewProvider 中的 _currentFavoriteId 及 globalState。
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：新增回调，支持收藏夹子标签模式
   *
   * @param {number} id - 要设置的收藏夹 ID
   */
  setCurrentFavoriteId: (id: number) => void;
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
   * 获取当前选中的收藏夹 ID 的回调
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：新增回调引用，用于收藏夹子标签模式下获取当前选中的收藏夹 ID
   */
  private getCurrentFavoriteId: () => number;
  /**
   * 设置当前选中的收藏夹 ID 的回调
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：新增回调引用，用于收藏夹子标签模式下设置当前选中的收藏夹 ID
   */
  private setCurrentFavoriteId: (id: number) => void;

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
   * 当前选中的收藏夹 ID
   *
   * 用于收藏夹子标签模式下确定当前激活的收藏夹。
   * 外部（BiliMainViewProvider）在用户点击收藏夹子标签时设置此值，
   * 并同步调用 setCurrentFavoriteId 回调更新 BiliMainViewProvider 的状态。
   * 默认值为 0 表示未选中任何收藏夹。
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：新增属性，支持收藏夹子标签模式
   */
  currentFavoriteId: number = 0;

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
   * 获取关注列表全局排序缓存
   *
   * 用于全部已读功能，获取缓存中的所有关注UP主 mid 列表，
   * 以便批量设置查看时间戳。
   *
   * 修改日期：2026-05-12
   * 修改人：zls3434
   */
  getFollowsCache(): Array<{ mid: number; uname: string; face: string; hasNewVideo: boolean; latestPubDate: number }> | null {
    return this._followsSortedCache;
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
    /**
     * 初始化收藏夹 ID 回调
     *
     * 修改日期：2026-05-08
     * 修改人：zls3434
     * 修改目的：新增依赖初始化，支持收藏夹子标签模式
     */
    this.getCurrentFavoriteId = deps.getCurrentFavoriteId;
    this.setCurrentFavoriteId = deps.setCurrentFavoriteId;
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
        /**
         * 收藏夹视图分页加载支持
         *
         * 修改日期：2026-05-08
         * 修改人：zls3434
         * 修改目的：
         * - page > 1 时表示懒加载更多视频，仅调用 _loadFavoriteVideos 加载视频数据
         * - page === 1 时走完整的 _loadFavoritesData 逻辑（收藏夹列表 + 默认收藏夹视频）
         */
        if (this.pageState['favorites'].page > 1) {
          const favState = this.pageState['favorites'];
          if (favState.loading) { break; }
          /* 仅在当前已选中收藏夹 ID 时才加载更多视频 */
          if (this.currentFavoriteId) {
            favState.loading = true;
            try {
              const result = await this._loadFavoriteVideos(this.currentFavoriteId, favState.page);
              favState.hasMore = result.hasMore;
              this.postMessage({
                type: 'appendListData',
                view: ContentView.favorites,
                data: result.videos,
                hasMore: result.hasMore,
              });
            } catch (error) {
              logger.error(`收藏夹视频分页加载失败: ${error}`);
            } finally {
              favState.loading = false;
            }
          }
        } else {
          await this._loadFavoritesData();
        }
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
      case ContentView.historyVideos:
        await this._loadHistoryVideosData();
        break;
      case ContentView.historyLives:
        await this._loadHistoryLivesData();
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
   * 1. 无缓存（首次加载）：先获取关注者列表并以 hasNewVideo:false 立即返回前端显示，
   *    然后异步启动并发池查询最新视频，查询完成后更新红点状态并重新发送给前端
   * 2. 有缓存（Tab切换、翻页）：直接从缓存分页返回，不发起网络请求
   * 3. 强制刷新（用户点击刷新按钮）：先清除缓存，再走模式1
   *
   * 从UP主视频列表返回时，调用 reorderFollowsCache() 仅重算红点排序，不走此方法。
   *
   * 异步红点更新关键点：
   * - 首次加载时先发送一次无红点数据（用户能看到关注列表）
   * - 异步视频查询完成后更新缓存并发送第二次带红点的数据
   * - 前端收到两次 updateListData，第二次覆盖第一次
   * - loading 状态只在真正加载时设置，异步更新不设置 loading
   *
   * 并发控制：
   * 使用并发池模式，最大30个并发请求，所有请求尽快发出，
   * 完成一个立即发起下一个，避免批次等待造成的延迟。
   *
   * @modification 2026-05-07 zls3434 增强关注列表数据加载，增加新视频红点判断逻辑
   * @modification 2026-05-07 zls3434 改为全局排序+内存分页，确保有新视频的主播排在整个列表最前面
   * @modification 2026-05-07 zls3434 优化并发策略，从批次并发改为并发池模式，大幅提升加载速度
   * @modification 2026-05-07 zls3434 优化加载策略：有缓存时直接分页返回，不重新获取数据
   * @modification 2026-05-12 zls3434 异步加载优化：首次加载先返回无红点列表，异步查询最新视频后更新红点
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
        /* 无缓存（首次加载）：先获取关注者列表，以无红点状态立即返回前端 */
        const allFollows = await this.apiService.getAllFollowings(mid);

        /* 构建初始数据：hasNewVideo=false, latestPubDate=0, latestVideo=null
         * 先让用户看到关注列表，红点状态异步更新 */
        const allFollowItems = allFollows.map((follow) => {
          return {
            mid: follow.mid,
            uname: follow.uname,
            face: follow.face ? follow.face.replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://') : '',
            liveRoom: null as LiveRoomInfo | null,
            videos: [] as VideoInfo[],
            latestVideo: null as VideoInfo | null,
            hasNewVideo: false,
            latestPubDate: 0,
          };
        });

        /* 缓存初始数据（暂无红点信息） */
        this._followsSortedCache = allFollowItems;

        /* 先发送第一页数据给前端（无红点），让用户尽快看到关注列表 */
        const totalCount = allFollowItems.length;
        const totalPages = Math.ceil(totalCount / PAGE_SIZE);
        const currentPage = state.page;
        const startIndex = (currentPage - 1) * PAGE_SIZE;
        const pageData = allFollowItems.slice(startIndex, startIndex + PAGE_SIZE);
        const hasMore = currentPage < totalPages;

        state.hasMore = hasMore;
        this._markViewHasData('follows');
        this.postMessage({
          type: state.page === 1 ? 'updateListData' : 'appendListData',
          view: ContentView.follows,
          data: pageData,
          hasMore,
        });

        /* 异步启动红点更新：并发查询最新视频并更新红点状态，完成后重新发送给前端 */
        this._asyncUpdateFollowsRedDots(allFollows);
      } else {
        /* 有缓存：直接分页返回 */
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
      }
    } catch (error) {
      this.postMessage({ type: 'updateListData', view: ContentView.follows, data: [], error: `获取关注列表失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 异步更新关注列表红点状态
   *
   * 首次加载后异步调用，并发查询每个关注UP主的最新视频，
   * 查询完成后更新缓存中的 hasNewVideo/latestPubDate/latestVideo 字段，
   * 重新排序后重新发送给前端覆盖第一次的无红点数据。
   *
   * 关键点：
   * - 不设置 loading 状态（主请求已完成）
   * - 使用并发池模式（最大30并发）查询最新视频
   * - 查询完成后更新缓存、重新排序、重新发送第一页数据
   * - 前端收到两次 updateListData，第二次覆盖第一次
   *
   * 修改日期：2026-05-12
   * 修改人：zls3434
   * 修改目的：关注列表异步加载优化，先显示列表再异步更新红点
   *
   * @param {Array<{mid: number; uname: string; face: string}>} allFollows - 关注者列表
   */
  /**
   * 异步更新关注列表红点状态
   *
   * 使用关注动态 Feed API 批量获取所有关注UP主的最新视频动态，
   * 从中提取每个UP主最新一条视频的发布时间，判断红点状态。
   * 相比逐个调用 getUserVideos，仅需少量 API 请求即可覆盖所有关注者。
   *
   * 修改日期：2026-05-12
   * 修改人：zls3434
   * 修改目的：用关注动态Feed API替代逐个getUserVideos，大幅减少API请求数量
   */
  private _asyncUpdateFollowsRedDots(allFollows: Array<{mid: number; uname: string; face: string}>): void {
    const MAX_FEED_PAGES = 5;
    const latestVideoMap = new Map<number, VideoInfo | null>();

    /* 通过关注动态Feed API批量获取最新视频，只需要几页即可覆盖所有关注者的最新视频 */
    const fetchFeedPages = async (): Promise<void> => {
      let offset = '';
      let pageCount = 0;

      while (pageCount < MAX_FEED_PAGES) {
        try {
          const result = await this.apiService.getFollowFeedVideos(offset);
          for (const video of result.videos) {
            /* 只保留每个UP主最新的一条视频（按pubdate倒序，第一条即为最新的） */
            const authorMid = this._findMidByAuthor(allFollows, video.author);
            if (authorMid !== null && !latestVideoMap.has(authorMid)) {
              latestVideoMap.set(authorMid, video);
            }
          }
          offset = result.offset;
          pageCount++;

          /* 没有更多数据则停止翻页 */
          if (!result.hasMore) { break; }

          /* 如果所有关注者都已有最新视频数据，无需继续翻页 */
          if (latestVideoMap.size >= allFollows.length) { break; }
        } catch (error) {
          logger.error(`异步获取关注动态Feed失败: ${error}`);
          break;
        }
      }
    };

    fetchFeedPages().then(async () => {
      /* 批量获取每个关注UP主的上次查看时间戳 */
      const mids = allFollows.map(f => f.mid);
      const viewTimesMap = await this.viewHistoryManager.getViewTimesBatch(mids);

      /* 确保缓存仍然存在（用户可能在此期间刷新了列表导致缓存被清除） */
      if (!this._followsSortedCache) {
        return;
      }

      /* 更新缓存中每个关注者的红点状态 */
      for (const item of this._followsSortedCache) {
        const latestVideo = latestVideoMap.get(item.mid) ?? null;
        const latestPubDate = latestVideo?.pubdate ?? 0;
        const latestPubDateMs = latestPubDate * 1000;
        const viewTimeMs = viewTimesMap[item.mid] ?? 0;
        const hasNewVideo = latestVideo !== null && latestPubDateMs > viewTimeMs;

        item.latestVideo = latestVideo;
        item.latestPubDate = latestPubDate;
        item.hasNewVideo = hasNewVideo;
      }

      /* 重新全局排序——有新视频的主播排在整个列表最上面 */
      this._followsSortedCache.sort((a, b) => {
        if (a.hasNewVideo !== b.hasNewVideo) {
          return a.hasNewVideo ? -1 : 1;
        }
        return (b.latestPubDate ?? 0) - (a.latestPubDate ?? 0);
      });

      /* 重新发送排序后的第一页数据给前端，覆盖之前无红点的数据 */
      const PAGE_SIZE = 20;
      const state = this.pageState['follows'];
      const cache = this._followsSortedCache;
      const totalCount = cache.length;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
      const currentPage = state.page;
      const startIndex = (currentPage - 1) * PAGE_SIZE;
      const pageData = cache.slice(startIndex, startIndex + PAGE_SIZE);
      const hasMore = currentPage < totalPages;

      state.hasMore = hasMore;
      this.postMessage({
        type: 'updateListData',
        view: ContentView.follows,
        data: pageData,
        hasMore,
      });
    }).catch((error) => {
      /* 异步红点更新失败不影响主流程，仅记录错误日志 */
      logger.error(`异步更新关注列表红点状态失败: ${error}`);
    });
  }

  /**
   * 通过作者名称在关注列表中查找对应的 mid
   *
   * 由于关注动态Feed返回的视频数据中只有作者名（author），没有 mid，
   * 需要在关注列表中按名称匹配来关联 mid。
   * 如果有多个同名UP主，返回第一个匹配的 mid。
   *
   * 修改日期：2026-05-12
   * 修改人：zls3434
   */
  private _findMidByAuthor(allFollows: Array<{mid: number; uname: string}>, author: string): number | null {
    const found = allFollows.find(f => f.uname === author);
    return found ? found.mid : null;
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

  /**
   * 加载收藏夹视图数据
   *
   * 改造为收藏夹子标签模式，同时返回收藏夹列表和默认选中收藏夹的视频列表：
   * 1. 获取收藏夹列表（folders）
   * 2. 确定默认选中的收藏夹 ID：优先使用 currentFavoriteId（外部设置），
   *    其次使用 getCurrentFavoriteId() 回调（从 BiliMainViewProvider 获取持久化值），
   *    最后回退到列表中第一个收藏夹的 id
   * 3. 如果有选中的收藏夹，同时加载该收藏夹的视频列表（第一页）
   * 4. 发送合并数据：{ folders, currentFolderId, videos, hasMore }
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：改造收藏夹视图为子标签模式，同时返回收藏夹列表和选中收藏夹的视频
   */
  private async _loadFavoritesData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: { folders: [], currentFolderId: 0, videos: [], hasMore: false },
        error: '请先登录后再查看收藏夹',
      });
      return;
    }

    try {
      /* 步骤1：获取收藏夹列表 */
      const favorites = await this.apiService.getFavorites(mid);

      if (favorites.length === 0) {
        /* 没有收藏夹，直接返回空数据 */
        this.postMessage({
          type: 'updateListData',
          view: ContentView.favorites,
          data: { folders: [], currentFolderId: 0, videos: [], hasMore: false },
        });
        return;
      }

      /**
       * 步骤2：确定默认选中的收藏夹 ID
       *
       * 优先级：
       * 1. this.currentFavoriteId（外部通过 clickFavoriteTab 消息已设置）
       * 2. getCurrentFavoriteId() 回调（从 BiliMainViewProvider 获取持久化的 lastFavoriteFolderId）
       * 3. 收藏夹列表中第一个收藏夹的 id（兜底默认值）
       */
      let selectedId = this.currentFavoriteId;
      if (!selectedId) {
        selectedId = this.getCurrentFavoriteId();
      }
      /* 验证 selectedId 是否存在于收藏夹列表中，不存在则回退到第一个 */
      const isValidId = favorites.some(f => f.id === selectedId);
      if (!isValidId) {
        selectedId = favorites[0].id;
      }

      /* 同步更新 currentFavoriteId 和回调，确保状态一致 */
      this.currentFavoriteId = selectedId;
      this.setCurrentFavoriteId(selectedId);

      /* 步骤3：加载选中收藏夹的视频列表（第一页） */
      const videoResult = await this.apiService.getFavoriteVideos(selectedId, 1, 20);
      const videos = videoResult.list;
      const videoHasMore = videoResult.hasMore;

      /* 更新分页状态中的 hasMore 标记 */
      const state = this.pageState['favorites'];
      state.hasMore = videoHasMore;

      this._markViewHasData('favorites');

      /* 步骤4：发送合并数据：收藏夹列表 + 当前选中收藏夹的视频列表 */
      this.postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: {
          folders: favorites,
          currentFolderId: selectedId,
          videos: videos,
          hasMore: videoHasMore,
        },
      });
    } catch (error) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: { folders: [], currentFolderId: 0, videos: [], hasMore: false },
        error: `获取收藏夹失败: ${error}`,
      });
    }
  }

  /**
   * 加载指定收藏夹的视频列表（私有方法）
   *
   * 独立于 _loadFavoritesData，供以下场景调用：
   * - clickFavoriteTab 消息触发时，只需加载指定收藏夹的视频数据
   * - favorites 视图分页加载更多（page > 1）时使用
   *
   * 调用 apiService.getFavoriteVideos 获取指定收藏夹的视频列表，
   * 返回视频数据和 hasMore 标记。
   *
   * 修改日期：2026-05-08
   * 修改人：zls3434
   * 修改目的：新增方法，支持收藏夹子标签模式下独立加载收藏夹视频列表
   *
   * @param {number} mediaId - 收藏夹 ID（media_id）
   * @param {number} page - 页码，从 1 开始
   * @returns {Promise<{ videos: VideoInfo[]; hasMore: boolean }>} 视频列表和是否还有更多数据
   */
  private async _loadFavoriteVideos(mediaId: number, page: number): Promise<{ videos: VideoInfo[]; hasMore: boolean }> {
    try {
      const result = await this.apiService.getFavoriteVideos(mediaId, page, 20);
      return { videos: result.list, hasMore: result.hasMore };
    } catch (error) {
      logger.error(`获取收藏夹视频失败: ${error}`);
      return { videos: [], hasMore: false };
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
      const result = await this.apiService.getRecommendedLives(
        state.page,
        30,
        state.areaId ?? LiveArea.all,
        state.sortType ?? LiveSortType.recommend
      );
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

  /**
   * 加载视频浏览历史数据（懒加载 + 浏览时间倒序）
   *
   * 调用B站浏览历史API获取视频类型的历史记录列表。
   * 使用游标分页机制实现懒加载：首次加载请求第一页（每页20条），
   * 滚动到底部时使用上次返回的 view_at 游标值请求下一页，
   * 直到 hasMore 为 false 停止加载。
   * 列表按浏览时间倒序排列（B站API默认返回倒序，无需前端额外排序）。
   *
   * 修改日期：2026-05-09
   * 修改人：zls3434
   * 修改目的：新增视频浏览历史数据加载，支持游标分页懒加载
   */
  private async _loadHistoryVideosData(): Promise<void> {
    const state = this.pageState['historyVideos'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      /* 使用 feedOffset 字段存储游标 view_at 值，实现懒加载分页 */
      const viewAt = state.feedOffset ? parseInt(state.feedOffset, 10) : undefined;
      const result = await this.apiService.getHistoryCursor(viewAt, 'archive', 20);

      /* 为每条历史记录生成可读的观看时间文本 */
      const items: HistoryItem[] = result.items.map(item => ({
        ...item,
        viewAtText: this._formatViewAtTime(item.viewAt),
      }));

      /* 更新分页状态：保存游标值用于下一页请求 */
      state.hasMore = result.hasMore;
      if (result.cursor.viewAt > 0) {
        state.feedOffset = String(result.cursor.viewAt);
      } else {
        /* 游标为0表示没有更多数据 */
        state.hasMore = false;
      }

      this._markViewHasData('historyVideos');

      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.historyVideos,
        data: items,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.historyVideos,
        data: [],
        error: `获取视频浏览历史失败: ${error}`,
        hasMore: false,
      });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 加载直播浏览历史数据（懒加载 + 浏览时间倒序）
   *
   * 调用B站浏览历史API获取直播类型的历史记录列表。
   * 逻辑与 _loadHistoryVideosData 相同，区别在于 type 参数为 'live'。
   * 同样使用游标分页实现懒加载，按浏览时间倒序排列。
   *
   * 修改日期：2026-05-09
   * 修改人：zls3434
   * 修改目的：新增直播浏览历史数据加载，支持游标分页懒加载
   */
  private async _loadHistoryLivesData(): Promise<void> {
    const state = this.pageState['historyLives'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      /* 使用 feedOffset 字段存储游标 view_at 值，实现懒加载分页 */
      const viewAt = state.feedOffset ? parseInt(state.feedOffset, 10) : undefined;
      const result = await this.apiService.getHistoryCursor(viewAt, 'live', 20);

      /* 为每条历史记录生成可读的观看时间文本 */
      const items: HistoryItem[] = result.items.map(item => ({
        ...item,
        viewAtText: this._formatViewAtTime(item.viewAt),
      }));

      /* 更新分页状态：保存游标值用于下一页请求 */
      state.hasMore = result.hasMore;
      if (result.cursor.viewAt > 0) {
        state.feedOffset = String(result.cursor.viewAt);
      } else {
        state.hasMore = false;
      }

      this._markViewHasData('historyLives');

      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.historyLives,
        data: items,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this.postMessage({
        type: 'updateListData',
        view: ContentView.historyLives,
        data: [],
        error: `获取直播浏览历史失败: ${error}`,
        hasMore: false,
      });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 格式化浏览时间为可读文本
   *
   * 将秒级时间戳格式化为人类可读的时间描述：
   * - 1小时内：x分钟前
   * - 今天：今天 HH:mm
   * - 昨天：昨天 HH:mm
   * - 更早：M-d HH:mm
   *
   * 修改日期：2026-05-09
   * 修改人：zls3434
   * 修改目的：新增时间格式化方法，用于浏览历史卡片显示观看时间
   *
   * @param {number} viewAt - 浏览时间戳（秒级）
   * @returns {string} 格式化后的时间文本
   */
  private _formatViewAtTime(viewAt: number): string {
    if (!viewAt) { return ''; }
    const now = Math.floor(Date.now() / 1000);
    const diff = now - viewAt;
    if (diff < 0) { return '刚刚'; }
    if (diff < 3600) {
      const minutes = Math.max(1, Math.floor(diff / 60));
      return `${minutes}分钟前`;
    }
    if (diff < 86400) {
      const hours = Math.floor(diff / 3600);
      return `${hours}小时前`;
    }
    const date = new Date(viewAt * 1000);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const isToday = date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();
    const isYesterday = date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate();
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    if (isToday) { return `今天 ${h}:${m}`; }
    if (isYesterday) { return `昨天 ${h}:${m}`; }
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}-${day} ${h}:${m}`;
  }
}