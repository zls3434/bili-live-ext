import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { VideoInfo, LiveRoomInfo, LiveArea, LiveSortType } from '../types';
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

  /**
   * 获取推荐直播间列表（支持分区筛选和排序方式）
   *
   * 根据传入的分区 ID 和排序方式，返回对应条件的直播间列表：
   * - areaId = LiveArea.all (0)：多分区混合推荐（推荐排序）或全站人气排序
   * - areaId > 0：指定分区的直播间列表
   * - sortType = LiveSortType.recommend：多分区混合 + 打散展示（仅全部分区时有效）
   * - sortType = LiveSortType.online：按在线人数降序排列
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：新增分区筛选和排序方式参数，支持按分区查看和人气排序
   *
   * @param {number} [page=1] - 页码，从 1 开始
   * @param {number} [pageSize=30] - 每页数量
   * @param {LiveArea} [areaId=LiveArea.all] - 分区 ID，0 表示全部
   * @param {LiveSortType} [sortType=LiveSortType.recommend] - 排序方式
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   * @throws 不抛出异常，内部捕获所有错误并返回空列表
   */
  async getRecommendedLives(page: number = 1, pageSize: number = 30, areaId: LiveArea = LiveArea.all, sortType: LiveSortType = LiveSortType.recommend): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    try {
      // 指定分区时，直接获取该分区的列表
      if (areaId !== LiveArea.all) {
        return await this._getAreaLives(areaId, page, pageSize, sortType);
      }

      // 全部分区 + 推荐排序：使用多分区混合策略
      if (sortType === LiveSortType.recommend) {
        return await this._getRecommendedLivesMixed(page, pageSize);
      }

      // 全部分区 + 人气排序：直接获取全站人气列表
      return await this._getOnlineLives(page, pageSize);
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

  /**
   * 获取指定分区的直播间列表（支持排序方式）
   *
   * 推荐排序时：从该分区的多个热门子分区各取热门直播间，交错排列（打散展示），
   * 与全站推荐逻辑一致，确保不同子分区内容交替出现。
   * 人气排序时：直接获取该分区按人气排序的列表。
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：推荐排序时使用子分区混合+打散策略，而非简单的全分区人气排序
   *
   * @param {number} areaId - 父分区 ID
   * @param {number} page - 页码
   * @param {number} pageSize - 每页数量
   * @param {LiveSortType} sortType - 排序方式
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   */
  private async _getAreaLives(areaId: number, page: number, pageSize: number, sortType: LiveSortType): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    if (sortType === LiveSortType.recommend) {
      return await this._getAreaLivesRecommend(areaId, page, pageSize);
    }

    const sortParam = sortType === LiveSortType.online ? 'online' : 'live_time';

    const response = await this.axiosInstance.get(
      'https://api.live.bilibili.com/room/v3/area/getRoomList',
      { params: { parent_area_id: areaId, area_id: 0, page, page_size: pageSize, sort_type: sortParam, platform: 'web' } }
    );

    const { code, data } = response.data;
    if (code !== 0) {
      logger.warn(`_getAreaLives 分区${areaId}获取失败: code=${code}`);
      return { list: [], hasMore: false };
    }

    const rawList = data?.list || [];
    const list = rawList.map((item: Record<string, unknown>) => ({
      roomId: item.roomid as number,
      title: item.title as string,
      cover: this._ensureHttps((item.cover as string) || (item.user_cover as string) || (item.system_cover as string)),
      owner: item.uname as string,
      online: item.online as number,
      url: '',
      parentAreaName: (item.parent_name as string) || undefined,
      areaName: (item.area_name as string) || undefined,
    }));
    return { list, hasMore: list.length >= pageSize };
  }

  /**
   * 分区推荐排序：从多个子分区各取热门直播间，交错排列（打散展示）
   *
   * 与全站推荐（_getRecommendedLivesMixed）逻辑一致，
   * 但范围限定在指定分区的子分区内，实现分区内的推荐效果。
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：各分区推荐排序时使用子分区混合+打散策略
   *
   * @param {number} areaId - 父分区 ID
   * @param {number} page - 页码
   * @param {number} pageSize - 每页数量
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   */
  private async _getAreaLivesRecommend(areaId: number, page: number, pageSize: number): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    const subAreas = this._getSubAreas(areaId);
    const perSubCount = Math.ceil(pageSize / 2);

    const subResults = await Promise.all(
      subAreas.map(async (subAreaId) => {
        try {
          return await this._fetchRoomList(areaId, subAreaId, perSubCount, 'online');
        } catch {
          return [];
        }
      })
    );

    // 也获取一个不按子分区的混合列表作为补充
    try {
      const mixedRooms = await this._fetchRoomList(areaId, 0, perSubCount, 'online');
      subResults.push(mixedRooms);
    } catch {
      // ignore
    }

    const mixedList = this._interleaveByArea(subResults);

    const seen = new Set<number>();
    const deduplicatedList = mixedList.filter((room) => {
      if (seen.has(room.roomId)) { return false; }
      seen.add(room.roomId);
      return true;
    });

    const startIndex = (page - 1) * pageSize;
    const pagedList = deduplicatedList.slice(startIndex, startIndex + pageSize);
    const hasMore = deduplicatedList.length > startIndex + pageSize;

    logger.info(`_getAreaLivesRecommend 分区${areaId} 第${page}页: 获取${pagedList.length}个直播间, 总去重${deduplicatedList.length}个`);
    return { list: pagedList, hasMore };
  }

  /**
   * 获取指定分区的子分区 ID 列表
   *
   * 返回各父分区下的代表性子分区 ID，用于分区推荐排序时
   * 从多个子分区各取热门直播间实现混合推荐效果。
   * 子分区 ID 来源：B站直播首页各分区展示的子分区标签
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：新增子分区 ID 映射，支持分区推荐排序
   *
   * @param {number} parentAreaId - 父分区 ID
   * @returns {number[]} 子分区 ID 列表（空列表表示无子分区或使用父分区直接获取）
   */
  private _getSubAreas(parentAreaId: number): number[] {
    const SUB_AREA_MAP: Record<number, number[]> = {
      // 网游：英雄联盟、无畏契约、CS2、守望先锋、APEX、暗区突围
      2: [86, 318, 89, 323, 324, 320],
      // 手游：王者荣耀、和平精英、第五人格、明日方舟、绝区零
      3: [35, 312, 36, 328, 329],
      // 单机游戏：主机游戏、我的世界、独立游戏、恐怖游戏、新游推荐
      6: [236, 283, 284, 314, 316],
      // 娱乐：视频唱见、颜值、萌宅、脱口秀、团播
      1: [21, 145, 311, 207, 1013],
      // 电台：唱见电台、聊天电台、男声电台
      5: [190, 192, 193],
    };
    return SUB_AREA_MAP[parentAreaId] || [];
  }

  /**
   * 从指定分区获取直播间列表（通用方法）
   *
   * @param {number} parentAreaId - 父分区 ID（0 表示全站）
   * @param {number} subAreaId - 子分区 ID（0 表示不区分子分区）
   * @param {number} pageSize - 每页数量
   * @param {string} sortType - 排序类型
   * @returns {Promise<LiveRoomInfo[]>}
   */
  private async _fetchRoomList(parentAreaId: number, subAreaId: number, pageSize: number, sortType: string): Promise<LiveRoomInfo[]> {
    const response = await this.axiosInstance.get(
      'https://api.live.bilibili.com/room/v3/area/getRoomList',
      { params: { parent_area_id: parentAreaId, area_id: subAreaId, page: 1, page_size: pageSize, sort_type: sortType, platform: 'web' } }
    );

    const { code, data } = response.data;
    if (code !== 0) { return []; }

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

  /**
   * 获取全站按人气排序的直播间列表
   *
   * 使用全站分区列表 API（parent_area_id=0）按在线人数降序获取，
   * 这是原始的简单人气排序方式，不支持分区打散。
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：新增全站人气排序方法，作为推荐排序的替代选项
   *
   * @param {number} page - 页码
   * @param {number} pageSize - 每页数量
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   */
  private async _getOnlineLives(page: number, pageSize: number): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    const response = await this.axiosInstance.get(
      'https://api.live.bilibili.com/room/v3/area/getRoomList',
      { params: { parent_area_id: 0, area_id: 0, page, page_size: pageSize, sort_type: 'online', platform: 'web' } }
    );

    const { code, data } = response.data;
    if (code !== 0) {
      logger.warn(`_getOnlineLives 获取失败: code=${code}`);
      return { list: [], hasMore: false };
    }

    const rawList = data?.list || [];
    const list = rawList.map((item: Record<string, unknown>) => ({
      roomId: item.roomid as number,
      title: item.title as string,
      cover: this._ensureHttps((item.cover as string) || (item.user_cover as string) || (item.system_cover as string)),
      owner: item.uname as string,
      online: item.online as number,
      url: '',
      parentAreaName: (item.parent_name as string) || undefined,
      areaName: (item.area_name as string) || undefined,
    }));
    return { list, hasMore: list.length >= pageSize };
  }
}