/**
 * @file src/types/index.ts
 * @description 项目核心类型定义文件
 *
 * 主要功能：
 * - 定义 B站直播扩展的所有 TypeScript 接口和枚举
 * - 提供类型安全保障，确保数据结构的统一性
 * - 涵盖登录、视频、直播、收藏夹等核心业务模型
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建类型定义文件，定义所有核心接口和枚举
 */

/**
 * 登录状态信息
 *
 * 用于管理 B站登录流程中的状态数据：
 * - 已登录时存储 cookie 信息
 * - 未登录时存储二维码相关的临时数据
 */
export interface LoginStatus {
  /** 是否已登录，true 表示已完成登录验证 */
  loggedIn: boolean;
  /** 登录后的 cookie 字符串，用于后续请求的身份验证 */
  cookie: string;
  /** 登录二维码图片的 URL 地址，用于展示给用户扫描 */
  qrCodeUrl: string;
  /** 二维码登录的唯一标识 key，用于轮询登录状态 */
  qrCodeKey: string;
}

/**
 * 视频信息
 *
 * 描述 B站视频的基本属性，用于视频列表、详情页等场景的展示
 */
export interface VideoInfo {
  /** 视频 BV 号，B站视频的唯一标识符 */
  bvid: string;
  /** 视频标题 */
  title: string;
  /** 视频封面图 URL */
  cover: string;
  /** 视频作者/UP 主名称 */
  author: string;
  /** 视频时长（秒），用于展示播放时长 */
  duration: number;
  /** 播放次数 */
  playCount: number;
  /** 弹幕数量 */
  danmakuCount: number;
  /** 视频发布时间戳（秒），用于排序 */
  pubdate?: number;
}

/**
 * 直播间信息
 *
 * 描述 B站直播间的核心属性，用于直播间列表和详情展示
 */
export interface LiveRoomInfo {
  /** 直播间房间 ID，用于进入直播间的唯一标识 */
  roomId: number;
  /** 直播间标题 */
  title: string;
  /** 直播间封面图 URL */
  cover: string;
  /** 主播名称 */
  owner: string;
  /** 在线观众数量 */
  online: number;
  /** 直播流地址，用于播放器加载直播内容 */
  url: string;
}

/**
 * 关注分组
 *
 * 用于组织用户的关注内容，支持分组管理关注的视频和直播间
 * 通过 name 字段与其他分组建立关联
 */
export interface FollowGroup {
  /** 分组名称，用于区分不同的关注分组 */
  name: string;
  /** 分组中的视频列表或直播间列表 */
  list: VideoInfo[] | LiveRoomInfo[];
}

/**
 * 内容视图枚举
 *
 * 定义扩展中可以切换展示的内容类型视图
 * 修改日期：2026-05-02
 * 修改人：zls3434
 * 修改目的：新增 followsVideos（关注动态）和 followsLive（关注直播中）两个子视图，
 *          用于在"我的关注"视图下提供子 Tab 切换功能
 */
export enum ContentView {
  /** 关注内容视图（关注UP主列表） */
  follows = 'follows',
  /** 关注动态视图（关注UP主的最新视频投稿，按时间排序） */
  followsVideos = 'followsVideos',
  /** 关注直播中视图（正在直播的关注UP主列表） */
  followsLive = 'followsLive',
  /** 收藏内容视图 */
  favorites = 'favorites',
  /** 推荐视频视图 */
  recommendedVideos = 'recommendedVideos',
  /** 推荐直播视图 */
  recommendedLives = 'recommendedLives',
}

/**
 * 媒体资源信息
 *
 * 描述视频/直播流的媒体格式信息，用于播放器选择合适的码流
 */
export interface MediaInfo {
  /** 媒体资源 URL 地址 */
  url: string;
  /** 媒体格式类型：flv（Flash Video）、hls（HTTP Live Streaming）、mp4（MPEG-4） */
  format: 'flv' | 'hls' | 'mp4';
}

/**
 * 扩展全局状态
 *
 * 维护扩展运行时的全局状态数据，包括当前浏览内容和登录态
 */
export interface AppState {
  /** 当前正在浏览的内容视图类型 */
  currentView: ContentView;
  /** 当前登录状态信息 */
  loginStatus: LoginStatus;
  /** 浏览历史记录，用于返回上一页功能 */
  navigationHistory: ContentView[];
}
