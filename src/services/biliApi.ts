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
 * 【关注模块】getMyFollowing / getAllFollowings / getUserVideos / getUserLiveStatus / batchGetUsersLiveStatus
 * 【收藏模块】getFavorites / getFavoriteVideos
 * 【推荐模块】getRecommendedVideos / getRecommendedLives / getLiveRoomList
 * 【视频模块】getVideoInfo / getVideoPlayUrl / getVideoDanmaku (XML格式)
 * 【直播模块】getLiveRoomInfo / getLivePlayUrl / getLiveDanmakuInfo
 * 【用户模块】getMyInfo / getMyMid
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建 B站 API 服务，实现所有核心业务接口和 WBI 签名
 * @modification 2026-05-04 zls3434 直播推荐列表改用官方推荐排序 API（xlive/web-interface/v1/second/getList），
 *           替代原分区列表 API 的简单人气排序，实现与B站直播首页一致的推荐算法
 * @modification 2026-05-04 zls3434 修复直播推荐 API 返回 -352（风控校验失败）错误：
 *           - 添加 buvid3/buvid4 设备指纹生成与注入
 *           - 直播 API 请求的 Referer 改为 https://live.bilibili.com/
 *           - WBI 密钥缓存增加 24 小时过期机制，防止使用过期密钥
 * @modification 2026-05-05 zls3434 新增 batchGetUsersLiveStatus 批量查询直播状态 API
 *           和 getAllFollowings 自动分页获取全部关注方法，修复关注直播中列表的两个 Bug：
 *           - 主播名显示"未知主播"：getRoomInfoOld API 不返回 uname 字段，改用 get_status_info_by_uids
 *           - 直播列表不完整：getMyFollowing 只获取前50个关注，改用自动分页获取全部
 */

import axios, { AxiosInstance } from 'axios';
import { SessionManager } from './sessionManager';
import { VideoInfo, LiveRoomInfo, MediaInfo } from '../types';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

/** WBI 签名所需的字符重排映射表（固定常量） */
const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

/** 默认的通用 User-Agent 请求头 */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 通用 Referer 请求头（主站） */
const REFERER = 'https://www.bilibili.com/';

/** 直播站 Referer 请求头 */
const LIVE_REFERER = 'https://live.bilibili.com/';

/**
 * buvid3/buvid4 设备指纹接口的响应数据结构
 *
 * 接口地址：https://api.bilibili.com/x/frontend/finger/spi
 * 该接口返回的 b_3 即为 buvid3，b_4 即为 buvid4
 */
interface BuvidResponse {
  code: number;
  data: {
    b_3: string;
    b_4: string;
  };
}

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

  /** WBI 密钥缓存时间戳（毫秒），用于判断缓存是否过期。密钥每日更替，此处缓存 24 小时 */
  private wbiKeysTimestamp: number = 0;

  /** WBI 密钥缓存有效期（毫秒），默认 24 小时 */
  private readonly wbiCacheDuration: number = 24 * 60 * 60 * 1000;

  /** buvid3 设备指纹（用于直播 API 风控校验，生成后持久缓存） */
  private buvid3: string = '';

  /** buvid4 设备指纹（用于直播 API 风控校验，生成后持久缓存） */
  private buvid4: string = '';

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

    // 请求拦截器：自动注入 Cookie（含 buvid 设备指纹）
    //
    // 修改日期：2026-05-05
    // 修改人：zls3434
    // 修改目的：统一直播 API 请求的 Cookie 构建逻辑，消除 isLiveApi 分支内
    //          buvid3 有/无两种情况的重复 Cookie 设置代码，改为使用 cookies 数组
    //          统一构建后 join，逻辑更简洁、更易维护
    this.axiosInstance.interceptors.request.use(async (config) => {
      const cookie = await this.sessionManager.getSession();

      // 为直播域名（api.live.bilibili.com）的请求注入 buvid3/buvid4 设备指纹
      // 直播推荐 API（xlive/web-interface/v1/second/getList）要求 buvid3 不为空，
      // 否则返回 -352（风控校验失败）
      // buvid3/buvid4 必须通过B站官方 API（/x/frontend/finger/spi）获取，
      // 本地随机生成的格式无法通过B站服务端的风控校验
      const isLiveApi = config.url?.includes('api.live.bilibili.com') ?? false;
      if (isLiveApi) {
        if (!this.buvid3) {
          await this._ensureBuvid();
        }
        // 模拟浏览器从 live.bilibili.com 发起的跨域请求
        // Origin 和 Referer 是B站风控校验的重要检查项
        config.headers['Referer'] = LIVE_REFERER;
        config.headers['Origin'] = 'https://live.bilibili.com';

        /* 统一构建 Cookie：将 buvid 设备指纹和用户登录态合并到一个数组中，避免重复的 if/else 判断 */
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
    try {
      // 确保 WBI 签名密钥已加载（该接口需要 WBI 签名）
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

      // 添加 WBI 签名
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

  /**
   * 批量查询 UP主是否正在直播
   *
   * 修改日期：2026-05-05
   * 修改人：zls3434
   * 修改目的：替代 getUserLiveStatus 逐个查询的方式，使用批量查询 API 一次性获取多个 UP 主的直播状态，
   *          解决 getRoomInfoOld API 返回数据缺少 uname 字段导致主播名显示为"未知主播"的问题，
   *          同时大幅减少 HTTP 请求数量，提升关注直播列表的加载性能
   * 修改日期：2026-05-05
   * 修改人：zls3434
   * 修改目的：修复 batchGetUsersLiveStatus 返回 code=1 的问题。
   *          1. 该 API 文档明确要求"请不要在标头中添加cookie"，但原实现使用了 this.axiosInstance，
   *             其拦截器会自动注入 Cookie（用户登录态 + buvid 设备指纹），导致 API 拒绝请求。
   *             改为使用 axios 直接调用（不经过拦截器），仅设置必要的请求头，不携带任何 Cookie
   *          2. 该 API 的 POST 请求体使用 PHP 数组参数格式（uids[]=1&uids[]=2），
   *             原实现使用 JSON 数组格式（uids=[1,2]），API 返回 code=1 "invalid params"。
   *             改为使用 PHP 数组参数格式构建请求体
   *
   * 该接口调用 /room/v1/Room/get_status_info_by_uids，返回数据包含：
   * - uname：主播用户名（解决 getRoomInfoOld 无 uname 的问题）
   * - area_v2_parent_name：父分区名称（如"网游"）
   * - area_v2_name：子分区名称（如"英雄联盟"）
   *
   * 重要：此 API 有以下两个特殊要求：
   *       1. 文档要求"认证方式：无，请不要在标头中添加cookie"，因此不能使用带拦截器的 axios 实例
   *       2. POST 请求体使用 PHP 数组参数格式（uids[]=1&uids[]=2），而非 JSON 数组格式（uids=[1,2]）
   *
   * @param {number[]} mids - UP主用户 ID 数组（建议单次不超过 50 个）
   * @returns {Promise<LiveRoomInfo[]>} 正在直播的直播间信息数组（未开播的会被过滤掉）
   */
  async batchGetUsersLiveStatus(mids: number[]): Promise<LiveRoomInfo[]> {
    if (mids.length === 0) {
      return [];
    }

    try {
      /*
       * 关键1：此 API 要求不携带 Cookie，不能使用 this.axiosInstance（会被拦截器自动注入 Cookie）
       * 关键2：此 API 的 POST 请求体使用 PHP 数组参数格式（uids[]=1&uids[]=2&...），
       *        而非 JSON 数组格式（uids=[1,2,3]），后者会返回 code=1 "invalid params"
       * 使用 axios 直接调用，仅设置必要的请求头：
       * - User-Agent：模拟浏览器请求
       * - Content-Type：application/x-www-form-urlencoded
       * - Referer/Origin：设置直播站来源
       */
      /* 构建 PHP 数组参数格式：uids[]=1&uids[]=2&uids[]=3&... */
      /* 对 mid 值进行 URL 编码，防御性编程，防止特殊字符导致请求异常 */
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
        /* live_status === 1 表示正在直播，过滤掉未开播(0)和轮播(2)的状态 */
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

  /**
   * 获取全部关注列表（自动分页）
   *
   * 修改日期：2026-05-05
   * 修改人：zls3434
   * 修改目的：原 getMyFollowing 只获取单页数据，关注数超过50时会遗漏正在直播的UP主；
   *          新增此方法自动循环分页获取全部关注的UP主列表
   *
   * @param {number} vmid - 用户 UID
   * @param {number} [ps=50] - 每页数量，默认 50
   * @returns {Promise<RawFollowInfo[]>} 全部关注的UP主列表
   */
  async getAllFollowings(vmid: number, ps: number = 50): Promise<RawFollowInfo[]> {
    const allFollows: RawFollowInfo[] = [];
    let pn = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getMyFollowing(vmid, pn, ps);
      allFollows.push(...result.list);
      hasMore = result.hasMore;
      pn++;

      /* 安全限制：防止关注数极端大的用户导致请求过多，最多获取 2500 个关注（50页×50个） */
      if (pn > 50) {
        logger.warn(`getAllFollowings 已达到最大分页限制(50页)，可能未获取全部关注`);
        break;
      }
    }

    logger.info(`getAllFollowings 共获取 ${allFollows.length} 个关注`);
    return allFollows;
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
        pubdate: (item.pubdate as number) || 0,
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
   * 修改记录：
   * - 2026-05-04 zls3434 将排序方式从简单人气排序改为多分区混合推荐排序，
   *   模拟B站直播首页的推荐展示逻辑：
   *   - 从多个主要分区（网游、手游、单机、娱乐、电台等）各取热门直播间
   *   - 按分区轮转交错排列（打散展示），避免同一分区内容集中
   *   - 每个分区取人气最高的直播间，兼顾人气与内容多样性
   *   - 第一页额外混入最新的正在开播直播间，增加时效性
   *
   * 背景说明：
   * - B站直播首页官方推荐 API（xlive/web-interface/v1/second/getList）因 TLS
   *   指纹检测（JA3/JA4），无法从 Node.js 环境调用，始终返回 -352
   * - 此多分区混合策略在效果上近似B站直播首页的推荐展示形式
   *
   * @param {number} [page=1] - 页码，从 1 开始
   * @param {number} [pageSize=30] - 每页数量
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   * @throws 不抛出异常，内部捕获所有错误并返回空列表
   */
  async getRecommendedLives(page: number = 1, pageSize: number = 30): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    try {
      return await this._getRecommendedLivesMixed(page, pageSize);
    } catch (error) {
      logger.error(`getRecommendedLives 请求失败: ${error}`);
      return { list: [], hasMore: false };
    }
  }

  /**
   * 多分区混合推荐策略
   *
   * 模拟B站直播首页的推荐逻辑：从多个主要分区各取热门直播间，交错排列展示。
   * B站直播首页的核心推荐逻辑就是"分区内容混合 + 打散展示"，
   * 这种方式在不依赖官方推荐 API 的情况下实现了近似的推荐效果。
   *
   * 算法流程：
   * 1. 从5个主要分区（网游、手游、单机、娱乐、电台）各取 topN 热门直播间
   * 2. 第一页额外混入最新开播直播间，增加时效性
   * 3. 将各分区直播间按分区轮转交错排列（打散），避免同一分区集中
   * 4. 去重（同一直播间可能属于不同分区的热门）
   * 5. 分页时通过内存缓存实现增量加载
   *
   * @param {number} page - 页码
   * @param {number} pageSize - 每页数量
   * @returns {Promise<{ list: LiveRoomInfo[]; hasMore: boolean }>}
   */
  private async _getRecommendedLivesMixed(page: number, pageSize: number): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    // B站直播主要分区 ID 列表
    // 1=娱乐, 2=网游, 3=手游, 6=单机游戏, 5=电台
    const AREA_IDS = [2, 3, 6, 1, 5];

    // 每个分区取的数量，确保总数足够填充一页
    const perAreaCount = Math.ceil(pageSize / 2);

    // 并行从每个分区获取热门直播间
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

    // 第一页额外混入最新开播的直播间（按开播时间排序）
    if (page === 1) {
      try {
        const newRooms = await this._getNewLiveRooms(Math.ceil(pageSize / 3));
        areaResults.push(newRooms);
      } catch (error) {
        logger.warn(`_getRecommendedLivesMixed 新开播列表获取失败: ${error}`);
      }
    }

    // 按分区轮转交错排列（打散展示）
    const mixedList = this._interleaveByArea(areaResults);

    // 去重（按 roomId 去重）
    const seen = new Set<number>();
    const deduplicatedList = mixedList.filter((room) => {
      if (seen.has(room.roomId)) {
        return false;
      }
      seen.add(room.roomId);
      return true;
    });

    // 分页处理
    const startIndex = (page - 1) * pageSize;
    const pagedList = deduplicatedList.slice(startIndex, startIndex + pageSize);
    const hasMore = deduplicatedList.length > startIndex + pageSize;

    logger.info(`_getRecommendedLivesMixed 第${page}页: 获取${pagedList.length}个直播间, 总去重${deduplicatedList.length}个, hasMore=${hasMore}`);
    return { list: pagedList, hasMore };
  }

  /**
   * 按分区轮转交错排列直播间列表
   *
   * 将多个分区的直播间列表交错排列，使得展示结果中不同分区内容交替出现，
   * 避免同一分区的内容集中在一起，模拟B站直播首页的"打散展示"效果。
   *
   * 算法：每次从各分区列表中各取一个直播间，轮流追加到结果中，
   * 直到所有分区的列表都取完为止。
   *
   * @param {LiveRoomInfo[][]} areaResults - 各分区的直播间列表数组
   * @returns {LiveRoomInfo[]} 交错排列后的直播间列表
   */
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

  /**
   * 获取最新开播的直播间列表
   *
   * 使用 sort_type=live_time 参数按开播时间倒序获取正在直播的房间，
   * 用于增加推荐列表的时效性（让新开播的主播也有曝光机会）。
   *
   * @param {number} count - 获取数量
   * @returns {Promise<LiveRoomInfo[]>}
   */
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
      parentAreaName: (item.parent_name as string) || undefined,
      areaName: (item.area_name as string) || undefined,
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
   * 获取直播流播放地址
   *
   * 优先获取 FLV 格式直播流，配合 flv.js 通过 MSE 在浏览器中播放。
   * 如果 FLV 不可用，回退到 HLS（m3u8）格式。
   *
   * 画质参考（qn）：
   * - 80=流畅, 150=高清, 250=超清, 400=蓝光, 10000=原画
   *
   * API 返回的 stream 结构：
   * - protocol=http_stream → format=flv（FLV 格式，配合 flv.js 播放）
   * - protocol=http_hls → format=ts/fmp4（HLS/m3u8 格式，浏览器 <video> 原生支持有限）
   *
   * @param {number} roomId - 直播间房间号
   * @param {number} [qn=80] - 画质值（默认流畅，减少带宽）
   * @returns {Promise<MediaInfo | null>} 直播流 URL 和格式信息
   */
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

      // 优先获取 FLV 格式，配合 flv.js 通过 MSE 在浏览器中播放
      // FLV 格式：protocol=http_stream，format_name=flv
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

      // 回退：获取 HLS（m3u8）格式（浏览器原生支持有限，需要 hls.js）
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

  /**
   * 获取直播弹幕 WebSocket 连接参数
   *
   * 返回弹幕服务器的地址、端口和认证 token，
   * 客户端需要通过 WebSocket 连接到返回的服务器接收实时弹幕。
   * 该接口需要 WBI 签名鉴权，否则返回 -352 错误。
   *
   * @param {number} roomId - 直播间房间号
   * @returns {Promise<Record<string, unknown> | null>}
   *          包含 host_list、token 等连接参数的对象
   */
  async getLiveDanmakuInfo(roomId: number): Promise<Record<string, unknown> | null> {
    try {
      // 确保 WBI 签名密钥已加载
      await this._ensureWbiKeys();

      const params: Record<string, string | number> = {
        id: roomId,
        type: 0,
      };

      // 添加 WBI 签名（该接口需要鉴权）
      if (this.wbiImgKey && this.wbiSubKey) {
        const wts = Math.floor(Date.now() / 1000);
        params.wts = wts;
        params.w_rid = this._generateWbiSign(params);
      }

      // getDanmuInfo API 对请求头敏感：
      // 携带浏览器 User-Agent 时，B站会检测 TLS 指纹（JA3/JA4），
      // 如果 TLS 指纹与 User-Agent 不匹配，返回 -352 错误。
      // 因此使用独立的 axios 请求，只带 Cookie（获取真实 UID 绑定的 token），
      // 不带 Chrome User-Agent 和 Referer。
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

  // ==================== WBI 签名工具方法 ====================

  /**
   * 确保已获取 buvid3/buvid4 设备指纹
   *
   * 通过B站官方设备指纹接口（/x/frontend/finger/spi）获取 buvid3（b_3）和 buvid4（b_4），
   * 生成的设备指纹用于直播 API 的风控校验。
   *
   * buvid3/buvid4 必须通过此官方接口获取，自行生成的格式无法通过B站服务端的风控验证。
   * 原因：B站服务端会校验 buvid3 的格式和来源，仅在官方接口注册过的设备指纹才有效。
   *
   * 降级策略：如果获取失败，buvid3/buvid4 保持空值，后续直播推荐 API 请求
   * 将降级使用分区列表 API（按人气排序）。
   *
   * @returns {Promise<void>}
   */
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

  /**
   * 确保已加载 WBI 签名密钥（带缓存过期刷新）
   *
   * 从 B站导航接口获取 img_key 和 sub_key，用于后续的 WBI 签名计算。
   * WBI 密钥每日更替，当前缓存策略：24 小时内不重复获取，过期后强制刷新。
   *
   * @returns {Promise<void>}
   */
  private async _ensureWbiKeys(): Promise<void> {
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

    // 参数按 key 排序、过滤特殊字符后拼接
    // Wbi 签名要求：过滤 value 中的 !'()* 字符，空格编码为 %20（不是 +）
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

    // 调试日志：打印签名计算过程
    logger.info(`WBI 签名计算: mixinKey=${mixinKey}, sortedParams=${sortedParams.substring(0, 80)}, w_rid=${w_rid}`);

    return w_rid;
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
