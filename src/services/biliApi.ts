import { SessionManager } from './sessionManager';
import { VideoInfo, LiveRoomInfo, MediaInfo, HistoryItem } from '../types';
import { UserApiService } from './userApi';
import { FollowApiService, RawFollowInfo } from './followApi';
import { FavoriteApiService } from './favoriteApi';
import { RecommendApiService } from './recommendApi';
import { VideoApiService } from './videoApi';
import { LiveApiService } from './liveApi';
import { DanmakuApiService } from './danmakuApi';
import { HistoryApiService } from './historyApi';

export class BiliApiService {
  private userApi: UserApiService;
  private followApi: FollowApiService;
  private favoriteApi: FavoriteApiService;
  private recommendApi: RecommendApiService;
  private videoApi: VideoApiService;
  private liveApi: LiveApiService;
  private danmakuApi: DanmakuApiService;
  /** 浏览历史API服务实例，提供历史记录查询、上报和删除功能 */
  historyApi: HistoryApiService;

  constructor(sessionManager: SessionManager) {
    this.userApi = new UserApiService(sessionManager);
    this.followApi = new FollowApiService(sessionManager);
    this.favoriteApi = new FavoriteApiService(sessionManager);
    this.recommendApi = new RecommendApiService(sessionManager);
    this.videoApi = new VideoApiService(sessionManager);
    this.liveApi = new LiveApiService(sessionManager);
    this.danmakuApi = new DanmakuApiService(sessionManager);
    this.historyApi = new HistoryApiService(sessionManager);
  }

  // ==================== 用户模块 ====================

  async getMyMid(): Promise<number | null> {
    return this.userApi.getMyMid();
  }

  async getMyInfo(): Promise<Record<string, unknown> | null> {
    return this.userApi.getMyInfo();
  }

  // ==================== 关注模块 ====================

  async getMyFollowing(vmid: number, pn: number = 1, ps: number = 20): Promise<{ list: RawFollowInfo[]; hasMore: boolean; total: number }> {
    return this.followApi.getMyFollowing(vmid, pn, ps);
  }

  async getAllFollowings(vmid: number, ps: number = 50): Promise<RawFollowInfo[]> {
    return this.followApi.getAllFollowings(vmid, ps);
  }

  async getUserVideos(mid: number, pn: number = 1, ps: number = 30): Promise<VideoInfo[]> {
    return this.followApi.getUserVideos(mid, pn, ps);
  }

  async getFollowFeedVideos(offset: string = ''): Promise<{ videos: VideoInfo[]; offset: string; hasMore: boolean }> {
    return this.followApi.getFollowFeedVideos(offset);
  }

  async getUserLiveStatus(mid: number): Promise<LiveRoomInfo | null> {
    return this.followApi.getUserLiveStatus(mid);
  }

  async batchGetUsersLiveStatus(mids: number[]): Promise<LiveRoomInfo[]> {
    return this.followApi.batchGetUsersLiveStatus(mids);
  }

  // ==================== 收藏模块 ====================

  async getFavorites(upMid: number): Promise<Array<{ id: number; title: string; cover: string; media_count: number }>> {
    return this.favoriteApi.getFavorites(upMid);
  }

  async getFavoriteVideos(mediaId: number, pn: number = 1, ps: number = 20): Promise<{ list: VideoInfo[]; hasMore: boolean }> {
    return this.favoriteApi.getFavoriteVideos(mediaId, pn, ps);
  }

  // ==================== 推荐模块 ====================

  async getRecommendedVideos(freshIdx: number = 1): Promise<{ list: VideoInfo[]; hasMore: boolean }> {
    return this.recommendApi.getRecommendedVideos(freshIdx);
  }

  async getRecommendedLives(page: number = 1, pageSize: number = 30): Promise<{ list: LiveRoomInfo[]; hasMore: boolean }> {
    return this.recommendApi.getRecommendedLives(page, pageSize);
  }

  async getLiveRoomList(areaId?: number, page: number = 1, pageSize: number = 30): Promise<LiveRoomInfo[]> {
    return this.recommendApi.getLiveRoomList(areaId, page, pageSize);
  }

  // ==================== 视频模块 ====================

  async getVideoInfo(bvid: string): Promise<Record<string, unknown> | null> {
    return this.videoApi.getVideoInfo(bvid);
  }

  async getVideoPlayUrl(bvid: string, cid: number, qn: number = 64): Promise<MediaInfo | null> {
    return this.videoApi.getVideoPlayUrl(bvid, cid, qn);
  }

  async getVideoDanmaku(oid: number, segmentIndex: number = 1): Promise<string> {
    return this.videoApi.getVideoDanmaku(oid, segmentIndex);
  }

  // ==================== 弹幕发送模块 ====================

  async sendLiveDanmaku(roomId: number, msg: string): Promise<boolean> {
    return this.danmakuApi.sendLiveDanmaku(roomId, msg);
  }

  async sendVideoDanmaku(oid: number, msg: string, progress: number, bvid: string): Promise<boolean> {
    return this.danmakuApi.sendVideoDanmaku(oid, msg, progress, bvid);
  }

  // ==================== 直播模块 ====================

  async getLiveRoomInfo(roomId: number): Promise<Record<string, unknown> | null> {
    return this.liveApi.getLiveRoomInfo(roomId);
  }

  async getLivePlayUrl(roomId: number, qn: number = 80): Promise<MediaInfo | null> {
    return this.liveApi.getLivePlayUrl(roomId, qn);
  }

  async getLiveDanmakuInfo(roomId: number): Promise<Record<string, unknown> | null> {
    return this.liveApi.getLiveDanmakuInfo(roomId);
  }

  // ==================== 浏览历史模块 ====================

  /**
   * 获取浏览历史记录（游标分页）
   *
   * @param viewAt - 游标参数，上一页最后一条记录的观看时间戳。默认0表示从最新记录开始
   * @param type - 历史类型筛选：'archive'(视频)、'live'(直播)、'all'(全部)。默认 'all'
   * @param ps - 每页条数，默认20条
   * @returns Promise<HistoryCursorResult> - 包含历史列表、游标和是否有更多数据的结果对象
   */
  async getHistoryCursor(viewAt?: number, type?: string, ps?: number): Promise<{ items: HistoryItem[]; cursor: { max: number; viewAt: number }; hasMore: boolean }> {
    return this.historyApi.getHistoryCursor(viewAt, type, ps);
  }

  /**
   * 上报视频观看历史
   *
   * @param bvid - 视频BV号
   * @param cid - 视频分P标识，默认0表示第一个分P
   * @param progress - 观看进度（秒），默认0表示刚开始
   * @returns Promise<boolean> - 上报成功返回 true，失败返回 false
   */
  async reportVideoHistory(bvid: string, cid?: number, progress?: number): Promise<boolean> {
    return this.historyApi.reportVideoHistory(bvid, cid, progress);
  }

  /**
   * 上报直播观看历史
   *
   * @param roomId - 直播间房间号
   * @returns Promise<boolean> - 上报成功返回 true，失败返回 false
   */
  async reportLiveHistory(roomId: number): Promise<boolean> {
    return this.historyApi.reportLiveHistory(roomId);
  }

  /**
   * 删除单条浏览历史记录
   *
   * @param kid - 历史 ID，格式为 "类型_oid epid"
   * @returns Promise<boolean> - 删除成功返回 true，失败返回 false
   */
  async deleteHistoryItem(kid: string): Promise<boolean> {
    return this.historyApi.deleteHistoryItem(kid);
  }
}

export type { RawFollowInfo };