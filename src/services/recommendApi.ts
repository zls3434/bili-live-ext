import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { VideoInfo, LiveRoomInfo } from '../types';
import { logger } from '../utils/logger';

export class RecommendApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async getRecommendedVideos(freshIdx: number = 1): Promise<{ list: VideoInfo[]; hasMore: boolean }> {
    try {
      await this._ensureWbiKeys();

      const wts = Math.floor(Date.now() / 1000);
      const params: Record<string, string | number> = {
        fresh_type: 4,
        ps: 12,
        version: 1,
        fresh_idx: freshIdx,
        fresh_idx_1h: freshIdx,
        wts,
      };
      params.w_rid = this._generateWbiSign(params);

      const response = await this.axiosInstance.get(
        'https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd',
        { params }
      );

      const { code, data } = response.data;
      if (code !== 0) {
        return { list: [], hasMore: false };
      }

      const items = data?.item || [];
      const list = items.map((item: Record<string, unknown>) => ({
        bvid: item.bvid as string,
        title: item.title as string,
        cover: this._ensureHttps(item.pic as string),
        author: (item.owner as Record<string, unknown>)?.name as string || '未知',
        duration: item.duration as number,
        playCount: (item.stat as Record<string, unknown>)?.view as number || 0,
        danmakuCount: (item.stat as Record<string, unknown>)?.danmaku as number || 0,
        pubdate: (item.pubdate as number) || 0,
      }));
      return { list, hasMore: true };
    } catch {
      return { list: [], hasMore: false };
    }
  }

  async getRecommendedLives(page: number = 1, pageSize: number = 30): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    try {
      return await this._getRecommendedLivesMixed(page, pageSize);
    } catch (error) {
      logger.error(`getRecommendedLives 请求失败: ${error}`);
      return { list: [], hasMore: false };
    }
  }

  async getLiveRoomList(areaId?: number, page: number = 1, pageSize: number = 30): Promise<LiveRoomInfo[]> {
    const response = await this.axiosInstance.get(
      'https://api.live.bilibili.com/room/v3/area/getRoomList',
      { params: { parent_area_id: areaId || 0, page, page_size: pageSize, platform: 'web' } }
    );

    const { code, data } = response.data;
    if (code !== 0) {
      return [];
    }

    const list = data?.data?.list || data?.list || [];
    return list.map((item: Record<string, unknown>) => ({
      roomId: item.roomid as number,
      title: item.title as string,
      cover: this._ensureHttps(item.cover as string),
      owner: item.uname as string,
      online: item.online as number,
      url: '',
      parentAreaName: (item.parent_name as string) || undefined,
      areaName: (item.area_name as string) || undefined,
    }));
  }

  private async _getRecommendedLivesMixed(page: number, pageSize: number): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    const AREA_IDS = [2, 3, 6, 1, 5];

    const perAreaCount = Math.ceil(pageSize / 2);

    const areaResults = await Promise.all(
      AREA_IDS.map(async (areaId) => {
        try {
          const rooms = await this.getLiveRoomList(areaId, 1, perAreaCount);
          return rooms;
        } catch (error) {
          logger.warn(`_getRecommendedLivesMixed 分区${areaId}获取失败: ${error}`);
          return [];
        }
      })
    );

    if (page === 1) {
      try {
        const newRooms = await this._getNewLiveRooms(Math.ceil(pageSize / 3));
        areaResults.push(newRooms);
      } catch (error) {
        logger.warn(`_getRecommendedLivesMixed 新开播列表获取失败: ${error}`);
      }
    }

    const mixedList = this._interleaveByArea(areaResults);

    const seen = new Set<number>();
    const deduplicatedList = mixedList.filter((room) => {
      if (seen.has(room.roomId)) {
        return false;
      }
      seen.add(room.roomId);
      return true;
    });

    const startIndex = (page - 1) * pageSize;
    const pagedList = deduplicatedList.slice(startIndex, startIndex + pageSize);
    const hasMore = deduplicatedList.length > startIndex + pageSize;

    logger.info(`_getRecommendedLivesMixed 第${page}页: 获取${pagedList.length}个直播间, 总去重${deduplicatedList.length}个, hasMore=${hasMore}`);
    return { list: pagedList, hasMore };
  }

  private _interleaveByArea(areaResults: LiveRoomInfo[][]): LiveRoomInfo[] {
    const nonEmptyAreas = areaResults.filter((list) => list.length > 0);
    if (nonEmptyAreas.length === 0) {
      return [];
    }

    const result: LiveRoomInfo[] = [];
    const remaining = nonEmptyAreas.map((list) => [...list]);

    while (remaining.some((list) => list.length > 0)) {
      for (const list of remaining) {
        if (list.length > 0) {
          result.push(list.shift()!);
        }
      }
    }

    return result;
  }

  private async _getNewLiveRooms(count: number): Promise<LiveRoomInfo[]> {
    const response = await this.axiosInstance.get(
      'https://api.live.bilibili.com/room/v3/area/getRoomList',
      { params: { parent_area_id: 0, area_id: 0, page: 1, page_size: count, sort_type: 'live_time', platform: 'web' } }
    );

    const { code, data } = response.data;
    if (code !== 0) {
      return [];
    }

    const rawList = data?.list || [];
    return rawList.map((item: Record<string, unknown>) => ({
      roomId: item.roomid as number,
      title: item.title as string,
      cover: this._ensureHttps((item.cover as string) || (item.user_cover as string) || (item.system_cover as string)),
      owner: item.uname as string,
      online: item.online as number,
      url: '',
      parentAreaName: (item.parent_name as string) || undefined,
      areaName: (item.area_name as string) || undefined,
    }));
  }
}