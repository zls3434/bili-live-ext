import axios, { AxiosInstance } from 'axios';
import { SessionManager } from './sessionManager';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REFERER = 'https://www.bilibili.com/';

const LIVE_REFERER = 'https://live.bilibili.com/';

interface BuvidResponse {
  code: number;
  data: {
    b_3: string;
    b_4: string;
  };
}

export abstract class BaseBiliApiService {
  protected axiosInstance: AxiosInstance;

  protected wbiImgKey: string = '';

  protected wbiSubKey: string = '';

  protected wbiKeysTimestamp: number = 0;

  protected readonly wbiCacheDuration: number = 24 * 60 * 60 * 1000;

  protected buvid3: string = '';

  protected buvid4: string = '';

  constructor(protected readonly sessionManager: SessionManager) {
    this.axiosInstance = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
      },
    });

    this._setupRequestInterceptor();
  }

  private _setupRequestInterceptor(): void {
    this.axiosInstance.interceptors.request.use(async (config) => {
      const cookie = await this.sessionManager.getSession();

      const isLiveApi = config.url?.includes('api.live.bilibili.com') ?? false;
      if (isLiveApi) {
        if (!this.buvid3) {
          await this._ensureBuvid();
        }
        config.headers['Referer'] = LIVE_REFERER;
        config.headers['Origin'] = 'https://live.bilibili.com';

        const cookies: string[] = [];
        if (this.buvid3) {
          cookies.push(`buvid3=${this.buvid3}`, `buvid4=${this.buvid4}`);
        }
        if (cookie) {
          cookies.push(cookie);
        }
        if (cookies.length > 0) {
          config.headers['Cookie'] = cookies.join('; ');
        }
        logger.info(`直播API请求 Cookie 注入完成: buvid3=${this.buvid3 ? this.buvid3.substring(0, 15) + '...' : '无'}, 用户Cookie=${cookie ? '有' : '无'}`);
      } else {
        if (cookie) {
          config.headers['Cookie'] = cookie;
        }
      }
      return config;
    });
  }

  protected async _ensureWbiKeys(): Promise<void> {
    const now = Date.now();
    const isCacheValid = this.wbiImgKey && this.wbiSubKey && (now - this.wbiKeysTimestamp < this.wbiCacheDuration);
    if (isCacheValid) {
      return;
    }

    try {
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/web-interface/nav');
      const { code, data } = response.data;
      if (code === 0 && data?.wbi_img) {
        this.wbiImgKey = this._extractWbiKey(data.wbi_img.img_url);
        this.wbiSubKey = this._extractWbiKey(data.wbi_img.sub_url);
        this.wbiKeysTimestamp = now;
        logger.info(`WBI 密钥已加载(${this.wbiKeysTimestamp === now ? '首次' : '刷新'}): imgKey=${this.wbiImgKey?.substring(0, 8)}..., subKey=${this.wbiSubKey?.substring(0, 8)}...`);
      } else {
        logger.warn(`WBI 密钥获取失败: code=${code}, data=${data ? '有数据' : '无数据'}, wbi_img=${data?.wbi_img ? '有' : '无'}`);
      }
    } catch (error) {
      logger.error(`WBI 密钥获取请求失败: ${error}`);
    }
  }

  protected _generateWbiSign(params: Record<string, string | number>): string {
    const rawKey = this.wbiImgKey + this.wbiSubKey;
    if (!rawKey) {
      return '';
    }

    const mixinKey = MIXIN_KEY_ENC_TAB
      .map((index) => rawKey[index] || '')
      .join('')
      .substring(0, 32);

    const charsToFilter = /[!'()*]/g;
    const sortedParams = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => {
        const filteredValue = String(v).replace(charsToFilter, '');
        return `${encodeURIComponent(k)}=${encodeURIComponent(filteredValue)}`;
      })
      .join('&');

    const signStr = sortedParams + mixinKey;
    const w_rid = crypto.createHash('md5').update(signStr).digest('hex');

    logger.info(`WBI 签名计算: mixinKey=${mixinKey}, sortedParams=${sortedParams.substring(0, 80)}, w_rid=${w_rid}`);

    return w_rid;
  }

  private async _ensureBuvid(): Promise<void> {
    if (this.buvid3) {
      return;
    }

    try {
      const response = await this.axiosInstance.get<BuvidResponse>(
        'https://api.bilibili.com/x/frontend/finger/spi'
      );
      const { code, data } = response.data;
      if (code === 0 && data?.b_3) {
        this.buvid3 = data.b_3;
        this.buvid4 = data.b_4 || '';
        logger.info(`buvid 设备指纹已获取: buvid3=${this.buvid3.substring(0, 20)}..., buvid4=${this.buvid4.substring(0, 20)}...`);
      } else {
        logger.warn(`buvid 设备指纹获取失败: code=${code}, b_3=${data?.b_3 ? '有' : '无'}`);
      }
    } catch (error) {
      logger.error(`buvid 设备指纹获取请求失败: ${error}`);
    }
  }

  private _extractWbiKey(url: string): string {
    if (!url) {
      return '';
    }
    const parts = url.split('/');
    const filename = parts[parts.length - 1] || '';
    return filename.replace('.png', '').replace('.jpg', '');
  }

  protected _ensureHttps(url: string): string {
    if (!url) { return ''; }
    if (url.startsWith('//')) { return 'https:' + url; }
    if (url.startsWith('http://')) { return url.replace('http://', 'https://'); }
    return url;
  }

  protected _parseDuration(duration: string): number {
    if (!duration) {
      return 0;
    }
    const parts = duration.split(':').reverse();
    let seconds = 0;
    if (parts[0]) { seconds += parseInt(parts[0], 10) || 0; }
    if (parts[1]) { seconds += (parseInt(parts[1], 10) || 0) * 60; }
    if (parts[2]) { seconds += (parseInt(parts[2], 10) || 0) * 3600; }
    return seconds;
  }

  protected async _getCsrfToken(): Promise<string> {
    const cookie = await this.sessionManager.getSession();
    if (!cookie) {
      return '';
    }
    const match = cookie.match(/bili_jct=([a-f0-9]+)/);
    return match ? match[1] : '';
  }
}

export { USER_AGENT, REFERER, LIVE_REFERER };