/**
 * @file src/services/biliApi.ts
 * @description B站核心业务 API 服务
 *
 * 主要功能：
 * - 封装所有 B站 Web 端 API 的 HTTP 请求调用
 * - 统一管理请求头（Cookie、User-Agent、Referer）和认证信息
 * - 提供关注、收藏、推荐、视频、直播等核心业务接口
 * - 支持 WBI 签名机制，确保推荐等高级接口的正常调用
 *
 * 在项目中的角色：
 * 作为扩展与 B站服务端之间的数据通信层，所有内容数据的获取都通过此服务完成
 *
 * API 列表概览：
 * 【关注模块】getMyFollowing / getUserVideos / getUserLiveStatus
 * 【收藏模块】getFavorites / getFavoriteVideos
 * 【推荐模块】getRecommendedVideos / getRecommendedLives / getLiveRoomList
 * 【视频模块】getVideoInfo / getVideoPlayUrl / getVideoDanmaku (XML格式)
 * 【直播模块】getLiveRoomInfo / getLivePlayUrl / getLiveDanmakuInfo
 * 【用户模块】getMyInfo / getMyMid
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建 B站 API 服务，实现所有核心业务接口和 WBI 签名
 */

import axios, { AxiosInstance } from 'axios';
import { SessionManager } from './sessionManager';
import { VideoInfo, LiveRoomInfo, MediaInfo } from '../types';
import * as crypto from 'crypto';

/** WBI 签名所需的字符重排映射表（固定常量） */
const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

/** 默认的通用 User-Agent 请求头 */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 通用 Referer 请求头 */
const REFERER = 'https://www.bilibili.com/';

/**
 * 关注 UP主信息（原始 API 响应中的数据结构）
 */
interface RawFollowInfo {
  mid: number;
  uname: string;
  face: string;
  sign: string;
  attribute: number;
  official_verify: { type: number; desc: string };
  vip: { vipType: number; vipStatus: number };
}

/**
 * B站核心 API 服务类
 *
 * 封装所有 B站内容的 HTTP API 请求，支持：
 * - 自动注入登录 Cookie（通过 SessionManager）
 * - WBI 签名（用于推荐等加密接口）
 * - 统一的响应格式校验和错误处理
 * - 数据映射：将原始 API 响应转换为项目内部类型
 */
export class BiliApiService {
  /** Axios 实例，用于发起 HTTP 请求 */
  private axiosInstance: AxiosInstance;

  /** WBI 签名用的 img_key（从 nav 接口获取并缓存） */
  private wbiImgKey: string = '';

  /** WBI 签名用的 sub_key（从 nav 接口获取并缓存） */
  private wbiSubKey: string = '';

  /**
   * 构造函数
   *
   * 初始化 Axios 实例并注入 SessionManager 以获取登录 Cookie
   *
   * @param {SessionManager} sessionManager - 会话管理器实例，用于获取登录 Cookie
   */
  constructor(private readonly sessionManager: SessionManager) {
    this.axiosInstance = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
      },
    });

    // 请求拦截器：自动注入 Cookie
    this.axiosInstance.interceptors.request.use(async (config) => {
      const cookie = await this.sessionManager.getSession();
      if (cookie) {
        config.headers['Cookie'] = cookie;
      }
      return config;
    });
  }

  // ==================== 用户模块 ====================

  /**
   * 获取当前登录用户的 mid（用户 ID）
   *
   * 调用 B站导航接口，从登录态中解析用户身份
   *
   * @returns {Promise<number | null>} 用户 mid，未登录时返回 null
   */
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

  /**
   * 获取当前登录用户的完整个人信息
   *
   * @returns {Promise<Record<string, unknown> | null>} 用户信息对象
   */
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

  // ==================== 关注模块 ====================

  /**
   * 获取当前用户的关注列表（带分页）
   *
   * @param {number} vmid - 用户 UID
   * @param {number} [pn=1] - 页码，从 1 开始
   * @param {number} [ps=20] - 每页数量，默认 20
   * @returns {Promise<{ list: RawFollowInfo[]; hasMore: boolean }>}
   */
  async getMyFollowing(vmid: number, pn: number = 1, ps: number = 20): Promise<{ list: RawFollowInfo[]; hasMore: boolean }> {
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

    return { list, hasMore };
  }

  /**
   * 获取指定 UP主的视频投稿列表
   *
   * @param {number} mid - UP主用户 ID
   * @param {number} [pn=1] - 页码
   * @param {number} [ps=30] - 每页数量
   * @returns {Promise<VideoInfo[]>} 视频信息数组
   */
  async getUserVideos(mid: number, pn: number = 1, ps: number = 30): Promise<VideoInfo[]> {
    const response = await this.axiosInstance.get('https://api.bilibili.com/x/space/wbi/arc/search', {
      params: { mid, pn, ps, order: 'pubdate', tid: 0, keyword: '', platform: 'web' },
    });

    const { code, data } = response.data;
    if (code !== 0) {
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
    }));
  }

  /**
   * 查询 UP主是否正在直播
   *
   * 返回开播状态及直播信息；若未开播，返回 null
   *
   * @param {number} mid - UP主用户 ID
   * @returns {Promise<LiveRoomInfo | null>} 直播信息或 null（未开播）
   */
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

  // ==================== 收藏模块 ====================

  /**
   * 获取用户创建的收藏夹列表
   *
   * @param {number} upMid - 用户 mid
   * @returns {Promise<Array<{ id: number; title: string; cover: string; media_count: number }>>} 收藏夹数组
   */
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

  /**
   * 获取指定收藏夹中的视频列表（带分页）
   *
   * @param {number} mediaId - 收藏夹 ID
   * @param {number} [pn=1] - 页码
   * @param {number} [ps=20] - 每页数量，最大 20
   * @returns {Promise<{ list: VideoInfo[]; hasMore: boolean }>}
   */
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

  // ==================== 推荐模块 ====================

  /**
   * 获取 B站首页推荐视频列表（带分页）
   *
   * @param {number} [freshIdx=1] - 页码索引，从 1 开始
   * @returns {Promise<{ list: VideoInfo[]; hasMore: boolean }>}
   */
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
      }));
      // 推荐视频无限滚动，始终有更多
      return { list, hasMore: true };
    } catch {
      return { list: [], hasMore: false };
    }
  }

  /**
   * 获取推荐直播间列表（带分页）
   *
   * @param {number} [page=1] - 页码
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   */
  async getRecommendedLives(page: number = 1): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    try {
      const response = await this.axiosInstance.get(
        'https://api.live.bilibili.com/xlive/web-interface/v1/second/getList',
        { params: { platform: 'web', page } }
      );

      const { code, data } = response.data;
      if (code !== 0) {
        return { list: [], hasMore: false };
      }

      const rawList = data?.list || [];
      const list = rawList.map((item: Record<string, unknown>) => ({
        roomId: item.roomid as number,
        title: item.title as string,
        cover: this._ensureHttps(item.cover as string),
        owner: item.uname as string,
        online: item.online as number,
        url: '',
      }));
      // 有数据则假设还有更多
      return { list, hasMore: list.length > 0 };
    } catch {
      return { list: [], hasMore: false };
    }
  }

  /**
   * 获取指定分区的直播间列表
   *
   * @param {number} [areaId] - 分区 ID
   * @param {number} [page=1] - 页码
   * @param {number} [pageSize=30] - 每页数量
   * @returns {Promise<LiveRoomInfo[]>} 直播间数组
   */
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
    }));
  }

  // ==================== 视频模块 ====================

  /**
   * 根据 BV 号获取视频详细信息
   *
   * @param {string} bvid - B站视频 BV 号（如 "BV1xx411c7m9"）
   * @returns {Promise<Record<string, unknown> | null>} 视频详情原始数据，失败时返回 null
   */
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

  /**
   * 获取视频播放流地址
   *
   * 请求 DASH 格式（fnval=16），支持视频和音频分离，兼容多清晰度
   *
   * @param {string} bvid - 视频 BV 号
   * @param {number} cid - 视频分 P 的 cid（分 P ID）
   * @param {number} [qn=80] - 清晰度值：16=360P, 32=480P, 64=720P, 80=1080P
   * @returns {Promise<MediaInfo | null>} 媒体流信息（URL + 格式），或 null
   */
  async getVideoPlayUrl(bvid: string, cid: number, qn: number = 64): Promise<MediaInfo | null> {
    try {
      // 使用 fnval=0 请求兼容的 MP4 格式（非 DASH）
      // fnval=16 返回 DASH 格式（.m4s），浏览器 <video> 标签无法直接播放
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/player/playurl', {
        params: { bvid, cid, qn, fnval: 0, platform: 'web' },
      });

      const { code, data } = response.data;
      if (code !== 0 || !data) {
        return null;
      }

      // fnval=0 返回的是 durl 数组，包含可直接播放的 MP4 URL
      const durl = data?.durl || [];
      if (durl.length === 0) {
        return null;
      }

      // 取第一个视频片段的 URL（高清视频可能有多个片段）
      const videoUrl = this._ensureHttps(durl[0]?.url || durl[0]?.backup_url?.[0] || '');

      return {
        url: videoUrl,
        format: 'mp4',
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取视频弹幕数据（XML 格式）
   *
   * 使用简化 XML 接口（list.so），避免复杂 Protobuf 解析
   * 每段 6 分钟，segment_index 从 1 开始
   *
   * @param {number} oid - 视频 cid（弹幕所属资源 ID）
   * @param {number} [segmentIndex=1] - 弹幕分片索引（6 分钟一段）
   * @returns {Promise<string>} 弹幕 XML 字符串
   */
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

  // ==================== 直播模块 ====================

  /**
   * 获取直播间详细信息
   *
   * @param {number} roomId - 直播间房间号
   * @returns {Promise<Record<string, unknown> | null>} 直播间详情原始数据
   */
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

  /**
   * 获取直播间播放流地址
   *
   * 返回 FLV 格式直播流 URL，支持多画质选择
   *
   * 画质参考（qn）：
   * - 80=流畅, 150=高清, 250=超清, 400=蓝光, 10000=原画
   *
   * @param {number} roomId - 直播间房间号
   * @param {number} [qn=10000] - 画质值
   * @returns {Promise<MediaInfo | null>} 直播流 URL 和格式信息
   */
  async getLivePlayUrl(roomId: number, qn: number = 10000): Promise<MediaInfo | null> {
    try {
      const response = await this.axiosInstance.get(
        'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo',
        { params: { room_id: roomId, protocol: '0,1', format: '0,1,2', codec: '0,1', qn, platform: 'web' } }
      );

      const { code, data } = response.data;
      if (code !== 0 || !data) {
        return null;
      }

      // 从嵌套响应中提取 FLV 直链
      const stream = data?.playurl_info?.playurl?.stream || [];
      for (const s of stream) {
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
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取直播弹幕 WebSocket 连接参数
   *
   * 返回弹幕服务器的地址、端口和认证 token，
   * 客户端需要通过 WebSocket 连接到返回的服务器接收实时弹幕
   *
   * @param {number} roomId - 直播间房间号
   * @returns {Promise<Record<string, unknown> | null>}
   *          包含 host_list、token 等连接参数的对象
   */
  async getLiveDanmakuInfo(roomId: number): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.axiosInstance.get(
        'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo',
        { params: { id: roomId, type: 0 } }
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

  // ==================== WBI 签名工具方法 ====================

  /**
   * 确保已获取 WBI 签名密钥
   *
   * 从 nav 接口获取 wbi_img 的 img_url 和 sub_url，
   * 提取其中的 key 部分并缓存到实例变量中
   *
   * 缓存策略：仅当 imgKey 或 subKey 为空时才重新获取
   *
   * @returns {Promise<void>}
   */
  private async _ensureWbiKeys(): Promise<void> {
    if (this.wbiImgKey && this.wbiSubKey) {
      return;
    }

    try {
      const response = await this.axiosInstance.get('https://api.bilibili.com/x/web-interface/nav');
      const { code, data } = response.data;
      if (code === 0 && data?.wbi_img) {
        // 从 URL 中提取文件名部分作为密钥（格式: xxx/bfs/wbi/{key}.png）
        this.wbiImgKey = this._extractWbiKey(data.wbi_img.img_url);
        this.wbiSubKey = this._extractWbiKey(data.wbi_img.sub_url);
      }
    } catch {
      // 密钥获取失败时保留空值，签名方法会安全降级
    }
  }

  /**
   * 从 WBI 资源 URL 中提取密钥字符串
   *
   * URL 格式示例：
   * "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png"
   * 提取出 "7cd084941338484aae1ad9425b84077c"
   *
   * @param {string} url - WBI 资源 URL
   * @returns {string} 提取的密钥字符串（不含扩展名）
   */
  private _extractWbiKey(url: string): string {
    if (!url) {
      return '';
    }
    const parts = url.split('/');
    const filename = parts[parts.length - 1] || '';
    return filename.replace('.png', '').replace('.jpg', '');
  }

  /**
   * 生成 WBI 签名参数 w_rid
   *
   * 算法流程：
   * 1. 拼接 imgKey + subKey 得到原始字符串
   * 2. 按 MIXIN_KEY_ENC_TAB 映射表重排字符
   * 3. 取前 32 位得到 mixin_key
   * 4. 将请求参数按 key 排序后编码拼接
   * 5. 对拼接结果 + mixin_key 计算 MD5
   *
   * @param {Record<string, string | number>} params - 请求参数键值对
   * @returns {string} WBI 签名字符串（MD5 哈希）
   */
  private _generateWbiSign(params: Record<string, string | number>): string {
    const rawKey = this.wbiImgKey + this.wbiSubKey;
    if (!rawKey) {
      return '';
    }

    // 按映射表重排字符，生成 mixin_key
    const mixinKey = MIXIN_KEY_ENC_TAB
      .map((index) => rawKey[index] || '')
      .join('')
      .substring(0, 32);

    // 参数按 key 排序、URL 编码后拼接
    const sortedParams = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');

    const signStr = sortedParams + mixinKey;
    return crypto.createHash('md5').update(signStr).digest('hex');
  }

  /**
   * 将 URL 转换为 HTTPS 协议
   *
   * B站 API 返回的图片 URL 可能是协议相对 URL（//开头）
   * 或 HTTP 协议，在 VSCode WebView 中必须使用 HTTPS 才能加载
   *
   * @param {string} url - 原始 URL
   * @returns {string} HTTPS 协议的 URL
   */
  private _ensureHttps(url: string): string {
    if (!url) { return ''; }
    if (url.startsWith('//')) { return 'https:' + url; }
    if (url.startsWith('http://')) { return url.replace('http://', 'https://'); }
    return url;
  }

  // ==================== 辅助工具方法 ====================

  /**
   * 将 B站时长格式字符串（mm:ss 或 hh:mm:ss）转换为秒数
   *
   * @param {string} duration - 时长字符串，如 "12:34" 或 "1:23:45"
   * @returns {number} 转换后的总秒数
   */
  private _parseDuration(duration: string): number {
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
}
