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
 */

import { ContentView, LiveRoomInfo } from '../types';
import { BiliApiService } from '../services/biliApi';
import { DanmakuService } from '../services/danmakuService';
import { OutputChannelManager } from '../utils/outputChannelManager';
import { logger } from '../utils/logger';

type PageState = { page: number; hasMore: boolean; loading: boolean; feedOffset?: string };

export type PostMessageFn = (message: Record<string, unknown>) => void;

export interface ViewDataLoaderDeps {
  apiService: BiliApiService;
  danmakuService: DanmakuService;
  outputChannelManager: OutputChannelManager;
  postMessage: PostMessageFn;
  pageState: Record<string, PageState>;
  viewHasData: Record<string, boolean>;
}

export class ViewDataLoader {
  private apiService: BiliApiService;
  private danmakuService: DanmakuService;
  private outputChannelManager: OutputChannelManager;
  private postMessage: PostMessageFn;
  private pageState: Record<string, PageState>;
  private viewHasData: Record<string, boolean>;

  constructor(deps: ViewDataLoaderDeps) {
    this.apiService = deps.apiService;
    this.danmakuService = deps.danmakuService;
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
      case ContentView.recommendedLives:
        await this._loadRecommendedLivesData();
        break;
    }
  }

  private async _loadFollowsData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this.postMessage({ type: 'updateListData', view: ContentView.follows, data: [], error: '请先登录后再查看关注列表', hasMore: false });
      return;
    }

    const state = this.pageState['follows'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const result = await this.apiService.getMyFollowing(mid, state.page, 20);
      const followItems = result.list.map((follow) => ({
        mid: follow.mid,
        uname: follow.uname,
        face: follow.face ? follow.face.replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://') : '',
        liveRoom: null,
        videos: [],
      }));

      state.hasMore = result.hasMore;
      this._markViewHasData('follows');
      this.postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.follows,
        data: followItems,
        hasMore: result.hasMore,
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