import axios from 'axios';
import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { MediaInfo } from '../types';

export class VideoApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async getVideoInfo(bvid: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/web-interface/view', {
        params: { bvid },
      });

      const { code, data } = response.data;
      if (code === 0) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getVideoPlayUrl(bvid: string, cid: number, qn: number = 64): Promise<MediaInfo | null> {
    try {
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/player/playurl', {
        params: { bvid, cid, qn, fnval: 0, platform: 'web' },
      });

      const { code, data } = response.data;
      if (code !== 0 || !data) {
        return null;
      }

      const durl = data?.durl || [];
      if (durl.length === 0) {
        return null;
      }

      const videoUrl = this._ensureHttps(durl[0]?.url || durl[0]?.backup_url?.[0] || '');

      return {
        url: videoUrl,
        format: 'mp4',
      };
    } catch {
      return null;
    }
  }

  async getVideoDanmaku(oid: number, segmentIndex: number = 1): Promise<string> {
    try {
      const response = await axios.get('https://api.bilibili.com/x/v1/dm/list.so', {
        params: { oid, segment_index: segmentIndex },
        responseType: 'text',
      });

      return response.data;
    } catch {
      return '';
    }
  }
}