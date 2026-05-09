/**
 * @file src/services/historyApi.ts
 * @description B站浏览历史API服务模块
 *
 * 主要功能：
 * - 封装B站浏览历史相关的所有API请求
 * - 提供历史记录查询、上报、删除等功能
 * - 继承 BaseBiliApiService，复用请求拦截和WBI签名等基础能力
 *
 * 在项目中的角色：
 * 作为浏览历史业务领域的数据层服务，被 BiliApiService 统一调度，
 * 为上层提供浏览历史数据的增删查能力
 *
 * @author zls3434
 * @date 2026-05-09
 * @modification 2026-05-09 zls3434 创建浏览历史API服务模块，
 *           实现 getHistoryCursor、reportVideoHistory、reportLiveHistory、deleteHistoryItem 四个核心方法
 * @modification 2026-05-09 qiweizhe 修复浏览历史上报接口：
 *           1. reportVideoHistory 从 /x/v2/history/report 改为 /x/click-interface/web/heartbeat 心跳接口，
 *              原因：/x/v2/history/report 要求 aid 和 cid 为必要参数，不支持 bvid 且 cid 不能为0；
 *              心跳接口同时支持 bvid 和 aid，cid 为非必要参数，更稳定可靠
 *           2. reportLiveHistory 最终改为 /xlive/web-room/v1/index/roomEntryAction 直播间进入接口，
 *              排查过程：/x/web-interface/history/report 返回404 →
 *              /x/v2/history/report 返回-400（cid必要参数缺失）→
 *              /x/click-interface/web/heartbeat 将roomId当avid写入视频历史（错误）→
 *              /xlive/rdata-interface/v1/heartbeat/webHeartBeat 仅保持连接不写入历史（无效）→
 *              /xlive/web-room/v1/index/roomEntryAction ✅ B站Web端标准入口，正确写入直播历史
 */

import { BaseBiliApiService } from './baseBiliApi';
import { SessionManager } from './sessionManager';
import { HistoryItem } from '../types';
import { logger } from '../utils/logger';

/**
 * 历史记录游标分页信息
 *
 * 描述B站历史API返回的分页游标数据，用于实现无限滚动加载：
 * - max: 当前页最后一条记录的kid对应的时间戳，用于向下翻页
 * - viewAt: 当前页最后一条记录的观看时间戳，作为下一页的游标参数
 */
interface HistoryCursor {
  /** 当前页最后一条记录对应的最大时间戳 */
  max: number;
  /** 当前页最后一条记录的观看时间戳，作为下一页请求的游标 */
  viewAt: number;
}

/**
 * 历史记录查询返回结果
 *
 * 封装B站浏览历史API的完整返回数据，包含历史条目列表、分页游标和是否还有更多数据
 */
interface HistoryCursorResult {
  /** 当前页的历史记录列表 */
  items: HistoryItem[];
  /** 分页游标信息，用于请求下一页 */
  cursor: HistoryCursor;
  /** 是否还有更多历史记录可供加载 */
  hasMore: boolean;
}

/**
 * B站浏览历史API服务类
 *
 * 继承 BaseBiliApiService，封装B站浏览历史相关的所有API请求。
 * 支持的功能包括：
 * - 按类型和游标分页查询浏览历史
 * - 上报视频观看历史（记录观看进度）
 * - 上报直播观看历史
 * - 删除单条浏览历史记录
 *
 * @author zls3434
 * @date 2026-05-09
 */
export class HistoryApiService extends BaseBiliApiService {
  /**
   * 构造函数
   *
   * @param sessionManager - 会话管理器实例，用于获取用户cookie和csrf令牌
   */
  constructor(sessionManager: SessionManager) {
    super(sessionManager);
  }

  /**
   * 获取浏览历史记录（游标分页）
   *
   * 调用B站浏览历史游标API，获取指定类型的历史记录列表。
   * 使用游标分页方式，通过 viewAt 参数实现无限滚动加载。
   *
   * 算法流程：
   * 1. 确保 WBI 密钥已加载（用于签名验证）
   * 2. 构建请求参数，包含 wts 时间戳和 w_rid 签名
   * 3. 发送 GET 请求到 /x/web-interface/history/cursor
   * 4. 解析返回数据，将B站API字段映射到 HistoryItem 接口
   * 5. 返回历史列表、分页游标和是否还有更多数据
   *
   * @param viewAt - 游标参数，上一页最后一条记录的观看时间戳。默认0或不传表示从最新记录开始
   * @param type - 历史类型筛选：'archive'(视频)、'live'(直播)、'all'(全部)。默认 'all'
   * @param ps - 每页条数，默认20条。建议不超过30以保证响应速度
   * @returns Promise<HistoryCursorResult> - 包含历史列表、游标和是否有更多数据的结果对象
   */
  async getHistoryCursor(viewAt?: number, type?: string, ps?: number): Promise<HistoryCursorResult> {
    try {
      // 第1步：确保 WBI 密钥已加载，用于后续签名
      await this._ensureWbiKeys();

      // 第2步：构建请求参数，wts 和 w_rid 为 WBI 签名必需字段
      const wts = Math.floor(Date.now() / 1000);
      const params: Record<string, string | number> = {
        ps: ps || 20,
        type: type || 'all',
        wts,
      };

      // 如果提供了 viewAt 游标，加入参数以实现分页加载
      if (viewAt && viewAt > 0) {
        params.view_at = viewAt;
      }

      // 生成 WBI 签名，防止请求被拒绝
      params.w_rid = this._generateWbiSign(params);

      // 第3步：发送 GET 请求获取浏览历史
      const response = await this.axiosInstance.get(
        'https://api.bilibili.com/x/web-interface/history/cursor',
        { params }
      );

      const { code, data } = response.data;

      // 请求失败时返回空结果
      if (code !== 0 || !data) {
        logger.warn(`getHistoryCursor 请求失败: code=${code}`);
        return { items: [], cursor: { max: 0, viewAt: 0 }, hasMore: false };
      }

      // 第4步：解析返回数据，将B站API字段映射到 HistoryItem 接口
      const rawItems = data?.list || [];
      const items: HistoryItem[] = rawItems.map((item: Record<string, unknown>) => {
        // 判断历史条目类型：B站API中 history 字段的 business 值标识类型
        const business = (item.history as Record<string, unknown>)?.business as string || 'archive';
        let historyType: 'archive' | 'live' | 'article' = 'archive';
        if (business === 'live') {
          historyType = 'live';
        } else if (business === 'article') {
          historyType = 'article';
        }

        // 直播房间的 roomId：直播类型时从 history.oid 获取；视频类型时为0
        const roomId = historyType === 'live'
          ? ((item.history as Record<string, unknown>)?.oid as number || 0)
          : 0;

        // 视频 cid：视频类型时从 history.cid 或页面信息获取
        const cid = historyType === 'archive'
          ? ((item.history as Record<string, unknown>)?.cid as number || (item.pages as Record<string, unknown>)?.cid as number || 0)
          : 0;

        return {
          // kid 格式为 "类型_oid epid"，如 "archive_123456_0"，作为删除历史的唯一标识
          kid: item.kid as string || '',
          bvid: item.bvid as string || '',
          title: item.title as string || '',
          cover: this._ensureHttps(item.pic as string || (item.cover as string) || ''),
          author: (item.author_name as string) || ((item.owner as Record<string, unknown>)?.name as string) || '',
          mid: (item.owner as Record<string, unknown>)?.mid as number || 0,
          duration: item.duration as number || 0,
          playCount: (item.stat as Record<string, unknown>)?.view as number || 0,
          viewAt: item.view_at as number || 0,
          progress: item.progress as number || 0,
          type: historyType,
          cid,
          roomId,
          danmakuCount: (item.stat as Record<string, unknown>)?.danmaku as number || 0,
        };
      });

      // 第5步：提取分页游标信息
      const cursorData = data?.cursor || {};
      const cursor: HistoryCursor = {
        max: cursorData.max as number || 0,
        viewAt: cursorData.view_at as number || 0,
      };

      // 判断是否还有更多数据：B站API返回 has_more 字段或通过游标是否存在判断
      const hasMore = !!(cursorData.view_at as number);

      logger.info(`getHistoryCursor 获取成功: ${items.length}条记录, hasMore=${hasMore}, cursor.viewAt=${cursor.viewAt}`);

      return { items, cursor, hasMore };
    } catch (error) {
      logger.error(`getHistoryCursor 请求异常: ${error}`);
      return { items: [], cursor: { max: 0, viewAt: 0 }, hasMore: false };
    }
  }

  /**
   * 上报视频观看历史
   *
   * 向B站上报视频观看记录，B站会根据此数据更新浏览历史列表。
   * 上报后可在"历史记录"页面中看到该视频。
   *
   * 使用B站心跳接口（/x/click-interface/web/heartbeat）而非历史上报接口，
   * 原因如下：
   * 1. /x/v2/history/report 要求 aid（数字类型avid）为必要参数，不支持 bvid
   * 2. /x/v2/history/report 要求 cid 为必要参数，不能传 0
   * 3. 心跳接口同时支持 aid 和 bvid，cid 为非必要参数
   * 4. 心跳接口是B站Web播放器实际使用的接口，更稳定可靠
   *
   * 修改日期：2026-05-09
   * 修改人：zls3434
   * 修改目的：将视频历史上报接口从 /x/v2/history/report 改为
   *           /x/click-interface/web/heartbeat 以支持 bvid 参数
   *
   * @param bvid - 视频BV号，B站视频的唯一标识符（如 BV1xx411c7mD）
   * @param cid - 视频分P标识，非必要参数
   * @param progress - 观看进度（秒），默认0表示刚开始
   * @returns Promise<boolean> - 上报成功返回 true，失败返回 false
   * @throws 网络异常或CSRF令牌缺失时可能抛出错误，内部捕获后返回 false
   */
  async reportVideoHistory(bvid: string, cid?: number, progress?: number): Promise<boolean> {
    try {
      /* 获取 CSRF 令牌，用于POST请求的身份验证 */
      const csrf = await this._getCsrfToken();
      if (!csrf) {
        logger.warn('reportVideoHistory 失败: 未获取到 CSRF 令牌，请先登录');
        return false;
      }

      /* 构建POST请求参数，使用心跳接口参数格式 */
      const params = new URLSearchParams();
      params.append('bvid', bvid);
      /* cid 为非必要参数，仅在有效值时传入 */
      if (cid && cid > 0) {
        params.append('cid', String(cid));
      }
      /* played_time 为视频播放进度（秒），对应心跳接口的 played_time 参数 */
      params.append('played_time', String(progress ?? 0));
      /* realtime 为实际播放时长（秒），与 played_time 保持一致 */
      params.append('realtime', String(progress ?? 0));
      /* type=3 表示投稿视频 */
      params.append('type', '3');
      /* csrf 令牌 */
      params.append('csrf', csrf);

      /* 发送POST请求到B站心跳接口
       * 心跳接口同时支持 bvid 和 aid 参数，cid 为非必要参数 */
      const response = await this.axiosInstance.post(
        'https://api.bilibili.com/x/click-interface/web/heartbeat',
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { code } = response.data;

      if (code === 0) {
        logger.info(`reportVideoHistory 上报成功: bvid=${bvid}`);
        return true;
      } else {
        logger.warn(`reportVideoHistory 上报失败: bvid=${bvid}, code=${code}`);
        return false;
      }
    } catch (error) {
      logger.error(`reportVideoHistory 请求异常: ${error}`);
      return false;
    }
  }

  /**
   * 上报直播观看历史
   *
   * 通过调用B站直播间进入接口，使直播间出现在用户的浏览历史直播列表中。
   *
   * 接口选型说明（重要）：
   * - 使用 /xlive/web-room/v1/index/roomEntryAction 接口（直播间进入动作接口）
   *   这是B站Web端进入直播间时调用的标准接口，会自动将直播间记录到浏览历史
   * - 不使用 /x/v2/history/report：该接口 cid 为必要参数，直播场景无法提供，
   *   传 aid=roomId&type=2 仍返回 -400
   * - 不使用 /x/click-interface/web/heartbeat（视频心跳接口）：
   *   该接口的 aid 参数会被当作视频 avid 处理，传入 roomId 会导致在视频历史
   *   中出现不相干的记录
   * - 不使用 /xlive/rdata-interface/v1/heartbeat/webHeartBeat（直播心跳接口）：
   *   该接口仅保持直播连接活跃，不会写入浏览历史列表
   *
   * 排查过程：
   * 1. /x/web-interface/history/report → 返回 404（路径不存在）
   * 2. /x/v2/history/report (aid+type=2+csrf+csrf_token) → 返回 -400（参数错误）
   * 3. /x/v2/history/report (aid+type=2+csrf, 不传csrf_token) → 仍返回 -400
   * 4. /x/click-interface/web/heartbeat (aid=roomId,type=2) → 写入视频历史（错误）
   * 5. /xlive/rdata-interface/v1/heartbeat/webHeartBeat → 不写入历史（无效）
   * 6. /xlive/web-room/v1/index/roomEntryAction → ✅ B站Web端标准入口，写入直播历史
   *
   * 修改日期：2026-05-09
   * 修改人：qiweizhe
   * 修改目的：将直播历史上报改为使用B站Web端直播间进入接口
   *           /xlive/web-room/v1/index/roomEntryAction，
   *           这是B站Web端进入直播间时调用的标准接口，
   *           会将直播间自动记录到浏览历史直播列表中
   *
   * @param roomId - 直播间房间号，标识要上报的直播间
   * @returns Promise<boolean> - 上报成功返回 true，失败返回 false
   * @throws 网络异常或CSRF令牌缺失时可能抛出错误，内部捕获后返回 false
   */
  async reportLiveHistory(roomId: number): Promise<boolean> {
    try {
      /* 获取 CSRF 令牌，roomEntryAction 是POST请求需要 CSRF 校验
       * 错误码 -111 表示 CSRF 校验失败，必须传入 csrf 和 csrf_token */
      const csrf = await this._getCsrfToken();
      if (!csrf) {
        logger.warn('reportLiveHistory 失败: 未获取到 CSRF 令牌，请先登录');
        return false;
      }

      /* 发送POST请求到B站直播间进入接口
       * roomEntryAction 是B站Web端进入直播间时的标准接口
       * 传入 room_id + csrf + csrf_token + platform，B站会自动将直播间记录到浏览历史
       * Content-Type 使用默认的 application/x-www-form-urlencoded */
      const params = new URLSearchParams();
      params.append('room_id', String(roomId));
      /* platform=web 标识来自Web端 */
      params.append('platform', 'web');
      /* CSRF 校验参数，B站POST请求必须传入 */
      params.append('csrf', csrf);
      params.append('csrf_token', csrf);

      const response = await this.axiosInstance.post(
        'https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction',
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { code } = response.data;

      if (code === 0) {
        logger.info(`reportLiveHistory 上报成功: roomId=${roomId}`);
        return true;
      } else {
        logger.warn(`reportLiveHistory 上报失败: roomId=${roomId}, code=${code}`);
        return false;
      }
    } catch (error) {
      logger.error(`reportLiveHistory 请求异常: ${error}`);
      return false;
    }
  }

  /**
   * 删除单条浏览历史记录
   *
   * 从浏览历史列表中删除指定的一条记录。
   * kid 格式为 "类型_oid epid"，例如 "archive_123456_0"。
   *
   * @param kid - 历史 ID，格式为 "类型_oid epid"（如 archive_123456_0），
   *              可从 HistoryItem.kid 字段获取
   * @returns Promise<boolean> - 删除成功返回 true，失败返回 false
   * @throws 网络异常或CSRF令牌缺失时可能抛出错误，内部捕获后返回 false
   */
  async deleteHistoryItem(kid: string): Promise<boolean> {
    try {
      // 获取 CSRF 令牌，用于POST请求的身份验证
      const csrf = await this._getCsrfToken();
      if (!csrf) {
        logger.warn('deleteHistoryItem 失败: 未获取到 CSRF 令牌，请先登录');
        return false;
      }

      // 构建POST请求参数
      const params = new URLSearchParams();
      params.append('kid', kid);
      params.append('csrf', csrf);
      params.append('csrf_token', csrf);

      // 发送POST请求，Content-Type 为 application/x-www-form-urlencoded
      const response = await this.axiosInstance.post(
        'https://api.bilibili.com/x/web-interface/history/delete',
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { code } = response.data;

      if (code === 0) {
        logger.info(`deleteHistoryItem 删除成功: kid=${kid}`);
        return true;
      } else {
        logger.warn(`deleteHistoryItem 删除失败: kid=${kid}, code=${code}`);
        return false;
      }
    } catch (error) {
      logger.error(`deleteHistoryItem 请求异常: ${error}`);
      return false;
    }
  }
}