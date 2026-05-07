import axios from 'axios';
import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { MediaInfo } from '../types';
import { logger } from '../utils/logger';

export class LiveApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async getLiveRoomInfo(roomId: number): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.axiosInstance.get(
        'https://api.live.bilibili.com/room/v1/Room/get_info',
        { params: { room_id: roomId } }
      );

      const { code, data } = response.data;
      if (code === 0) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getLivePlayUrl(roomId: number, qn: number = 80): Promise<MediaInfo | null> {
    try {
      const response = await this.axiosInstance.get(
        'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo',
        { params: { room_id: roomId, protocol: '0,1', format: '0,1,2', codec: '0,1', qn, platform: 'web' } }
      );

      const { code, data } = response.data;
      if (code !== 0 || !data) {
        return null;
      }

      const stream = data?.playurl_info?.playurl?.stream || [];

      for (const s of stream) {
        if (s?.protocol_name !== 'http_stream') { continue; }
        const formats = s?.format || [];
        for (const fmt of formats) {
          if (fmt?.format_name === 'flv') {
            const codecs = fmt?.codec || [];
            for (const c of codecs) {
              const urlInfos = c?.url_info || [];
              if (urlInfos.length > 0) {
                const host = urlInfos[0].host;
                const baseUrl = c?.base_url || '';
                const extra = urlInfos[0].extra || '';
                return {
                  url: host + baseUrl + extra,
                  format: 'flv',
                };
              }
            }
          }
        }
      }

      for (const s of stream) {
        if (s?.protocol_name !== 'http_hls') { continue; }
        const formats = s?.format || [];
        for (const fmt of formats) {
          const codecs = fmt?.codec || [];
          for (const c of codecs) {
            const urlInfos = c?.url_info || [];
            if (urlInfos.length > 0) {
              const host = urlInfos[0].host;
              const baseUrl = c?.base_url || '';
              const extra = urlInfos[0].extra || '';
              return {
                url: host + baseUrl + extra,
                format: 'hls',
              };
            }
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getLiveDanmakuInfo(roomId: number): Promise<Record<string, unknown> | null> {
    try {
      await this._ensureWbiKeys();

      const params: Record<string, string | number> = {
        id: roomId,
        type: 0,
      };

      if (this.wbiImgKey && this.wbiSubKey) {
        const wts = Math.floor(Date.now() / 1000);
        params.wts = wts;
        params.w_rid = this._generateWbiSign(params);
      }

      const cookie = await this.sessionManager.getSession();
      const headers: Record<string, string> = {};
      if (cookie) {
        headers['Cookie'] = cookie;
      }

      const response = await axios.get(
        'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo',
        {
          params,
          timeout: 10000,
          headers,
        }
      );

      const { code, message, data } = response.data;
      if (code === 0) {
        return data;
      }
      logger.warn(`getDanmuInfo 返回非零状态码: code=${code}, message=${message}`);
      return null;
    } catch (error) {
      logger.error(`getDanmuInfo 请求失败: ${error}`);
      return null;
    }
  }
}