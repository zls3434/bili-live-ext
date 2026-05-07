import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { logger } from '../utils/logger';

export class DanmakuApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async sendLiveDanmaku(roomId: number, msg: string): Promise<boolean> {
    try {
      const csrf = await this._getCsrfToken();
      const response = await this.axiosInstance.post(
        'https://api.live.bilibili.com/msg/send',
        new URLSearchParams({
          roomid: String(roomId),
          msg: msg,
          rnd: String(Math.floor(Date.now() / 1000)),
          fontsize: '25',
          color: '16777215',
          mode: '1',
          csrf: csrf,
          csrf_token: csrf,
        }),
        {
          headers: {
            'Referer': 'https://live.bilibili.com/',
          },
        }
      );

      const { code, message } = response.data;
      if (code === 0) {
        logger.info(`直播弹幕发送成功: roomId=${roomId}, msg="${msg}"`);
        return true;
      }
      logger.warn(`直播弹幕发送失败: roomId=${roomId}, code=${code}, message=${message}`);
      return false;
    } catch (error) {
      logger.error(`直播弹幕发送请求异常: roomId=${roomId}, error=${error}`);
      return false;
    }
  }

  async sendVideoDanmaku(oid: number, msg: string, progress: number, bvid: string): Promise<boolean> {
    try {
      const csrf = await this._getCsrfToken();
      const params = new URLSearchParams({
        type: '1',
        oid: String(oid),
        msg: msg,
        progress: String(Math.floor(progress * 1000)),
        color: '16777215',
        fontsize: '25',
        pool: '0',
        mode: '1',
        rnd: String(Math.floor(Math.random() * 1e8)),
        bvid: bvid,
        csrf: csrf,
        csrf_token: csrf,
      });

      const response = await this.axiosInstance.post(
        'https://api.bilibili.com/x/v2/dm/post',
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://www.bilibili.com/',
          },
        }
      );

      const { code, message } = response.data;
      if (code === 0) {
        logger.info(`视频弹幕发送成功: bvid=${bvid}, oid=${oid}, progress=${progress}s, msg="${msg}"`);
        return true;
      }
      logger.warn(`视频弹幕发送失败: bvid=${bvid}, code=${code}, message=${message}`);
      return false;
    } catch (error) {
      logger.error(`视频弹幕发送请求异常: bvid=${bvid}, oid=${oid}, error=${error}`);
      return false;
    }
  }
}