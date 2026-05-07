import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { VideoInfo } from '../types';

export class FavoriteApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async getFavorites(upMid: number): Promise<Array<{ id: number; title: string; cover: string; media_count: number }>> {
    const response = await this.axiosInstance.get(
      'https://api.bilibili.com/x/v3/fav/folder/created/list-all',
      { params: { up_mid: upMid, type: 2 } }
    );

    const { code, data } = response.data;
    if (code !== 0) {
      return [];
    }

    return (data.list || []).map((item: Record<string, unknown>) => ({
      id: item.id as number,
      title: item.title as string,
      cover: this._ensureHttps(item.cover as string),
      media_count: item.media_count as number,
    }));
  }

  async getFavoriteVideos(mediaId: number, pn: number = 1, ps: number = 20): Promise<{ list: VideoInfo[]; hasMore: boolean }> {
    const response = await this.axiosInstance.get(
      'https://api.bilibili.com/x/v3/fav/resource/list',
      { params: { media_id: mediaId, pn, ps, platform: 'web', type: 0 } }
    );

    const { code, data } = response.data;
    if (code !== 0) {
      return { list: [], hasMore: false };
    }

    const medias = data?.medias || [];
    const hasMore = data?.has_more === true;
    const list = medias.map((item: Record<string, unknown>) => ({
      bvid: item.bvid as string,
      title: item.title as string,
      cover: this._ensureHttps(item.cover as string),
      author: (item.upper as Record<string, unknown>)?.name as string || '未知',
      duration: item.duration as number,
      playCount: (item.cnt_info as Record<string, unknown>)?.play as number || 0,
      danmakuCount: (item.cnt_info as Record<string, unknown>)?.danmaku as number || 0,
    }));
    return { list, hasMore };
  }
}