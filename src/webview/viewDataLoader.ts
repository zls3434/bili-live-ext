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
      const videos = feedResult.videos;

      videos.sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0));

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
      const followResult = await this.apiService.getMyFollowing(mid, 1, 50);
      const followList = followResult.list;

      const livePromises = followList.map(async (follow) => {
        try {
          const liveInfo = await this.apiService.getUserLiveStatus(follow.mid);
          if (liveInfo) {
            return liveInfo;
          }
          return null;
        } catch {
          return null;
        }
      });
      const liveResults = await Promise.all(livePromises);

      const liveRooms = liveResults.filter((item): item is LiveRoomInfo => item !== null);
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