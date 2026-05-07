import axios from 'axios';
import { BaseBiliApiService, USER_AGENT } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { VideoInfo, LiveRoomInfo } from '../types';
import { logger } from '../utils/logger';

export interface RawFollowInfo {
  mid: number;
  uname: string;
  face: string;
  sign: string;
  attribute: number;
  official_verify: { type: number; desc: string };
  vip: { vipType: number; vipStatus: number };
}

export class FollowApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async getMyFollowing(vmid: number, pn: number = 1, ps: number = 20): Promise<{ list: RawFollowInfo[]; hasMore: boolean; total: number }> {
    const response = await this.axiosInstance.get('https://api.bilibili.com/x/relation/followings', {
      params: { vmid, pn, ps, order: 'desc' },
    });

    const { code, data } = response.data;
    if (code !== 0) {
      throw new Error(`获取关注列表失败: code=${code}`);
    }

    const total = data?.total || 0;
    const list: RawFollowInfo[] = data?.list || [];
    const hasMore = (pn * ps) < total;

    return { list, hasMore, total };
  }

  async getAllFollowings(vmid: number, ps: number = 50): Promise<RawFollowInfo[]> {
    const firstResult = await this.getMyFollowing(vmid, 1, ps);
    const allFollows: RawFollowInfo[] = [...firstResult.list];

    if (!firstResult.hasMore) {
      logger.info(`getAllFollowings 共获取 ${allFollows.length} 个关注`);
      return allFollows;
    }

    const totalPages = Math.ceil(firstResult.total / ps);
    const maxPages = Math.min(totalPages, 50);

    const pagePromises: Promise<{ list: RawFollowInfo[]; hasMore: boolean }>[] = [];
    for (let pn = 2; pn <= maxPages; pn++) {
      pagePromises.push(this.getMyFollowing(vmid, pn, ps));
    }

    const results = await Promise.all(pagePromises);
    for (const result of results) {
      allFollows.push(...result.list);
    }

    logger.info(`getAllFollowings 共获取 ${allFollows.length} 个关注（并发${maxPages - 1}页）`);
    return allFollows;
  }

  async getUserVideos(mid: number, pn: number = 1, ps: number = 30): Promise<VideoInfo[]> {
    try {
      await this._ensureWbiKeys();

      const params: Record<string, string | number> = {
        mid,
        pn,
        ps,
        order: 'pubdate',
        tid: 0,
        keyword: '',
        platform: 'web',
      };

      if (this.wbiImgKey && this.wbiSubKey) {
        const wts = Math.floor(Date.now() / 1000);
        params.wts = wts;
        params.w_rid = this._generateWbiSign(params);
      }

      const response = await this.axiosInstance.get('https://api.bilibili.com/x/space/wbi/arc/search', {
        params,
      });

      const { code, data, message } = response.data;
      if (code !== 0) {
        logger.warn(`getUserVideos 返回错误: code=${code}, message=${message}`);
        return [];
      }

      const vlist = data?.list?.vlist || [];
      return vlist.map((item: Record<string, unknown>) => ({
        bvid: item.bvid as string,
        title: item.title as string,
        cover: item.pic as string,
        author: item.author as string,
        duration: this._parseDuration(item.length as string),
        playCount: item.play as number,
        danmakuCount: item.video_review as number,
        pubdate: item.created as number,
      }));
    } catch (error) {
      logger.error(`getUserVideos 请求失败: ${error}`);
      return [];
    }
  }

  async getFollowFeedVideos(
    offset: string = ''
  ): Promise<{ videos: VideoInfo[]; offset: string; hasMore: boolean }> {
    try {
      const params: Record<string, string | number> = {
        type: 'video',
        offset,
      };

      const response = await this.axiosInstance.get(
        'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all',
        { params }
      );

      const { code, data, message } = response.data;
      if (code !== 0) {
        logger.warn(`getFollowFeedVideos 返回错误: code=${code}, message=${message}`);
        return { videos: [], offset: '', hasMore: false };
      }

      const items = data?.items || [];
      const videos: VideoInfo[] = [];

      for (const item of items) {
        const type = item.type as string;
        if (type !== 'DYNAMIC_TYPE_AV') { continue; }

        const modules = item.modules as Record<string, unknown> || {};
        const moduleDynamic = modules.module_dynamic as Record<string, unknown> || {};
        const moduleAuthor = modules.module_author as Record<string, unknown> || {};
        const major = moduleDynamic.major as Record<string, unknown> || {};
        const archive = major.archive as Record<string, unknown> || {};

        const bvid = archive.bvid as string;
        const title = archive.title as string;
        const cover = archive.cover as string;
        const archiveAuthor = archive.author as string;
        const moduleAuthorName = moduleAuthor.name as string;
        const author = archiveAuthor || moduleAuthorName || '';
        const durationText = archive.duration_text as string || '';
        const archiveStat = (archive.stat as Record<string, unknown>) || {};
        const playCount = (archiveStat.play as number) || 0;
        const danmakuCount = (archiveStat.danmaku as number) || 0;
        const pubTs = (archive.pub_ts as number) || (moduleAuthor.pub_ts as number) || 0;

        if (!bvid || !title) { continue; }

        videos.push({
          bvid,
          title,
          cover: cover ? cover.replace(/^\/\//, 'https://') : '',
          author: author || '',
          duration: this._parseDuration(durationText),
          playCount,
          danmakuCount,
          pubdate: pubTs,
        });
      }

      const nextOffset = data?.offset || '';
      const hasMore = data?.has_more === true;

      logger.info(`动态Feed: 获取 ${videos.length} 条视频, hasMore=${hasMore}, offset=${String(nextOffset).substring(0, 20)}`);

      return { videos, offset: String(nextOffset), hasMore };
    } catch (error) {
      logger.error(`getFollowFeedVideos 请求失败: ${error}`);
      return { videos: [], offset: '', hasMore: false };
    }
  }

  async getUserLiveStatus(mid: number): Promise<LiveRoomInfo | null> {
    try {
      const response = await this.axiosInstance.get(
        `https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=${mid}`
      );

      const { code, data } = response.data;
      if (code === 0 && data && data.liveStatus === 1) {
        return {
          roomId: data.roomid,
          title: data.title,
          cover: data.cover,
          owner: data.uname || '未知主播',
          online: data.online || 0,
          url: data.url || '',
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async batchGetUsersLiveStatus(mids: number[]): Promise<LiveRoomInfo[]> {
    if (mids.length === 0) {
      return [];
    }

    try {
      const body = mids.map(mid => `uids[]=${encodeURIComponent(mid)}`).join('&');
      const response = await axios.post(
        'https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids',
        body,
        {
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://live.bilibili.com/',
            'Origin': 'https://live.bilibili.com',
          },
          timeout: 15000,
        }
      );

      const { code, data } = response.data;
      if (code !== 0 || !data) {
        logger.warn(`batchGetUsersLiveStatus 返回错误: code=${code}`);
        return [];
      }

      const liveRooms: LiveRoomInfo[] = [];
      for (const midStr of Object.keys(data)) {
        const roomData = data[midStr];
        if (roomData && roomData.live_status === 1) {
          liveRooms.push({
            roomId: roomData.room_id || 0,
            title: roomData.title || '',
            cover: roomData.cover_from_user || roomData.keyframe || '',
            owner: roomData.uname || '未知主播',
            online: roomData.online || 0,
            url: `https://live.bilibili.com/${roomData.room_id || ''}`,
            parentAreaName: roomData.area_v2_parent_name || '',
            areaName: roomData.area_v2_name || '',
          });
        }
      }

      return liveRooms;
    } catch (error) {
      logger.error(`batchGetUsersLiveStatus 请求失败: ${error}`);
      return [];
    }
  }
}