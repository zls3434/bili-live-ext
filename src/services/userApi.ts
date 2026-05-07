import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';

export class UserApiService extends BaseBiliApiService {
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  async getMyMid(): Promise<number | null> {
    try {
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/web-interface/nav');
      const { code, data } = response.data;
      if (code === 0 && data.isLogin) {
        return data.mid;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getMyInfo(): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/space/myinfo');
      const { code, data } = response.data;
      if (code === 0) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }
}