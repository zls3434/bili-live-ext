/**
 * @file src/webview/BiliMainViewProvider.ts
 * @description B站主视图 Webview 提供者
 *
 * 主要功能：
 * - 管理侧边栏中 bilibili 浏览面板的 Webview 生命周期
 * - 提供4个顶部Tab切换按钮（我的关注/我的收藏/推荐视频/推荐直播间）
 * - 实现列表视图与播放器视图之间的切换机制
 * - 处理 Webview 与扩展主进程之间的双向消息通信
 * - 提供扫码登录 QR 码展示区域
 *
 * 在项目中的角色：
 * 作为扩展 UI 层与业务逻辑层的桥梁，是所有用户交互的入口。
 * 负责将用户在 Webview 中的操作转化为扩展命令，同时将后端数据渲染到前端 UI
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 重写主视图提供者，实现完整侧边栏容器（Tab切换/列表播放器切换/登录区/消息通信）
 */

import * as vscode from 'vscode';
import {
  ContentView,
  LoginStatus,
} from '../types';
import { SessionManager } from '../services/sessionManager';
import { BiliLoginService } from '../services/biliLogin';
import { BiliApiService } from '../services/biliApi';
import { DanmakuService } from '../services/danmakuService';
import { OutputChannelManager } from '../utils/outputChannelManager';
import * as QRCode from 'qrcode';

/**
 * B站主视图提供者类
 *
 * 实现 vscode.WebviewViewProvider 接口，负责：
 * - Webview 面板的创建与配置
 * - 处理来自 Webview 的用户操作消息（Tab切换、点击视频/直播、返回、登录）
 * - 协调各业务服务完成登录、数据获取、播放等功能
 * - 维护当前视图状态和导航历史
 */
export class BiliMainViewProvider implements vscode.WebviewViewProvider {
  /** 当前 Webview 视图实例，null 表示尚未创建 */
  private _view?: vscode.WebviewView;

  /** 当前浏览的内容视图类型，默认显示推荐视频 */
  private _currentView: ContentView = ContentView.recommendedVideos;

  /** 导航历史记录栈，用于返回上一页功能，记录离开列表进入播放前的视图 */
  private _navigationHistory: ContentView[] = [];

  /** 登录状态信息 */
  private _loginStatus: LoginStatus = {
    loggedIn: false,
    cookie: '',
    qrCodeUrl: '',
    qrCodeKey: '',
  };

  /** 分页状态：每个视图的当前页码 */
  private _pageState: Record<string, { page: number; hasMore: boolean; loading: boolean }> = {
    follows: { page: 1, hasMore: true, loading: false },
    favorites: { page: 1, hasMore: true, loading: false },
    recommendedVideos: { page: 1, hasMore: true, loading: false },
    recommendedLives: { page: 1, hasMore: true, loading: false },
  };

  /** 当前收藏夹 ID（用于收藏夹视频的分页加载） */
  private _currentFavoriteId: number = 0;

  /** 会话管理器实例，持久化登录态 */
  private readonly sessionManager: SessionManager;

  /** 登录服务实例，处理扫码登录流程 */
  private readonly loginService: BiliLoginService;

  /** B站 API 服务实例，获取内容数据 */
  private readonly apiService: BiliApiService;

  /** 弹幕服务实例，解析和格式化弹幕数据 */
  private readonly danmakuService: DanmakuService;

  /** 输出通道管理器单例，管理弹幕输出通道 */
  private readonly outputChannelManager: OutputChannelManager;

  /** 登录轮询定时器引用，用于停止轮询 */
  private _loginPollingTimer?: NodeJS.Timeout;

  /** 登录轮询超时定时器（180秒过期） */
  private _loginExpiryTimer?: NodeJS.Timeout;

  /**
   * 构造函数
   *
   * 初始化所有服务实例，并尝试从缓存恢复登录态
   *
   * @param {vscode.Uri} extensionUri - 扩展的根目录 URI，用于加载 Webview 静态资源
   * @param {vscode.ExtensionContext} context - VSCode 扩展上下文，提供生命周期管理和存储
   * @param {string} proxyBaseUrl - 本地代理服务器 URL，用于绕过 B站 CDN 403 防盗链
   */
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly proxyBaseUrl: string
  ) {
    this.sessionManager = new SessionManager(context);
    this.loginService = new BiliLoginService();
    this.apiService = new BiliApiService(this.sessionManager);
    this.danmakuService = new DanmakuService();
    this.outputChannelManager = OutputChannelManager.getInstance();

    // 启动时自动尝试恢复登录态（异步执行，不阻塞构造函数）
    this._restoreSession().catch((err) => {
      console.error('恢复登录态失败:', err);
    });
  }

  /**
   * 从缓存恢复登录会话
   *
   * 插件激活时调用，检查 globalState 中是否有已保存的 cookie，
   * 若有则验证其有效性，有效则自动恢复登录态
   *
   * @returns {Promise<void>}
   */
  private async _restoreSession(): Promise<void> {
    const cookie = await this.sessionManager.getSession();
    if (cookie) {
      const valid = await this.sessionManager.checkSessionValidity(cookie);
      if (valid) {
        this._loginStatus = {
          loggedIn: true,
          cookie,
          qrCodeUrl: '',
          qrCodeKey: '',
        };
        console.log('bilibili 登录态已自动恢复');
      }
    }
  }

  /**
   * 向 Webview 发送消息的便捷方法
   *
   * @param {Record<string, unknown>} message - 要发送的消息对象
   * @returns {void}
   */
  private _postMessage(message: Record<string, unknown>): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  // ==================== 公开方法（供 extension.ts 命令调用） ====================

  /**
   * 初始化扫码登录流程
   *
   * 完整流程：
   * 1. 调用 B站 API 获取登录二维码和扫码密钥
   * 2. 使用 qrcode 库将 URL 转为 base64 图片
   * 3. 在 Webview 中展示二维码图片
   * 4. 启动轮询（每3秒），检查是否已扫码确认
   * 5. 登录成功后保存 cookie，停止轮询，刷新 UI
   * 6. 超时（180秒）后停止轮询，提示用户重新生成
   *
   * @returns {Promise<void>}
   */
  public async initiateLogin(): Promise<void> {
    if (!this._view) {
      return;
    }

    try {
      // 步骤1：从 B站 API 获取二维码
      const { qrCodeUrl, qrCodeKey } = await this.loginService.generateQRCode();

      // 步骤2：使用 qrcode 库将 URL 转为 base64 图片
      const qrDataURL = await QRCode.toDataURL(qrCodeUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });

      // 步骤3：更新内部状态，保存扫码密钥
      this._loginStatus.qrCodeUrl = qrDataURL;
      this._loginStatus.qrCodeKey = qrCodeKey;

      // 步骤4：通知 Webview 显示二维码
      this._postMessage({
        type: 'showLogin',
        qrCodeDataUrl: qrDataURL,
      });

      // 步骤5：启动轮询登录状态（每3秒一次）
      this._startLoginPolling(qrCodeKey);
    } catch (error) {
      vscode.window.showErrorMessage(`获取登录二维码失败: ${error}`);
    }
  }

  /**
   * 启动登录状态轮询
   *
   * 定时（3秒间隔）调用 pollLoginStatus 检查扫码状态，
   * 同时设置 180 秒超时保护
   *
   * @param {string} qrCodeKey - 扫码密钥
   * @returns {void}
   */
  private _startLoginPolling(qrCodeKey: string): void {
    // 清除之前的轮询定时器（若存在）
    this._stopLoginPolling();

    // 每 3 秒轮询一次登录状态
    this._loginPollingTimer = setInterval(async () => {
      try {
        const result = await this.loginService.pollLoginStatus(qrCodeKey);

        switch (result.status) {
          case 'success':
            // 登录成功：停止轮询，保存 cookie，更新状态
            this._stopLoginPolling();
            if (result.cookie) {
              await this.sessionManager.saveSession(result.cookie);
              this._loginStatus = {
                loggedIn: true,
                cookie: result.cookie,
                qrCodeUrl: '',
                qrCodeKey: '',
              };
              // 通知 Webview 登录成功
              this._postMessage({
                type: 'updateLoginStatus',
                loggedIn: true,
              });
              vscode.window.showInformationMessage('B站登录成功！');
            }
            break;

          case 'scanned':
            // 已扫描但未确认，通知 Webview 更新提示文字
            this._postMessage({
              type: 'updateLoginStatus',
              scanned: true,
            });
            break;

          case 'expired':
            // 二维码已过期，停止轮询，提示用户重新登录
            this._stopLoginPolling();
            this._postMessage({
              type: 'updateLoginStatus',
              expired: true,
              loggedIn: false,
            });
            vscode.window.showWarningMessage('登录二维码已过期，请重新扫码');
            break;

          case 'waiting':
          default:
            // 等待扫码，继续轮询（无需额外操作）
            break;
        }
      } catch (error) {
        this._stopLoginPolling();
        vscode.window.showErrorMessage(`登录轮询出错: ${error}`);
      }
    }, 3000);

    // 设置 180 秒超时（二维码有效期）
    this._loginExpiryTimer = setTimeout(() => {
      this._stopLoginPolling();
    }, 180000);
  }

  /**
   * 停止登录轮询
   *
   * 清除轮询和超时两个定时器
   *
   * @returns {void}
   */
  private _stopLoginPolling(): void {
    if (this._loginPollingTimer) {
      clearInterval(this._loginPollingTimer);
      this._loginPollingTimer = undefined;
    }
    if (this._loginExpiryTimer) {
      clearTimeout(this._loginExpiryTimer);
      this._loginExpiryTimer = undefined;
    }
  }

  /**
   * 根据 BV 号打开并播放视频
   *
   * 流程：
   * 1. 获取视频详情（title、cid等）
   * 2. 获取播放流地址
   * 3. 通知 Webview 切换到播放器视图
   * 4. 将当前列表视图压入导航历史（用于返回）
   *
   * @param {string} bvid - 视频 BV 号，如 "BV1xx411c7m9"
   * @returns {Promise<void>}
   */
  public async openVideo(bvid: string): Promise<void> {
    if (!this._view) { return; }

    try {
      // 获取视频详情和播放地址
      const videoInfo = await this.apiService.getVideoInfo(bvid);
      if (!videoInfo) {
        vscode.window.showErrorMessage('获取视频信息失败，请检查 BV 号是否正确');
        return;
      }

      const cid = (videoInfo.cid as number) || 0;
      const title = (videoInfo.title as string) || '未知视频';
      const ownerName = ((videoInfo.owner as Record<string, unknown>)?.name as string) || '未知';

      const mediaInfo = await this.apiService.getVideoPlayUrl(bvid, cid);
      if (!mediaInfo || !mediaInfo.url) {
        vscode.window.showErrorMessage('获取视频播放地址失败');
        return;
      }

      // 保存导航历史
      this._navigationHistory.push(this._currentView);

      // 通过本地代理服务器转发视频 URL，绕过 B站 CDN 403 防盗链
      const proxiedUrl = `${this.proxyBaseUrl}/video?url=${encodeURIComponent(mediaInfo.url)}`;

      // 通知 Webview 切换到播放器
      this._postMessage({
        type: 'showPlayer',
        mediaType: 'video',
        url: proxiedUrl,
        format: mediaInfo.format,
        title,
        author: ownerName,
        bvid,
        cid,
      });

      // 加载并输出视频弹幕（XML 格式），分段获取
      this._loadVideoDanmaku(cid);
    } catch (error) {
      vscode.window.showErrorMessage(`打开视频失败: ${error}`);
    }
  }

  /**
   * 根据房间号打开并观看直播
   *
   * 流程：
   * 1. 获取直播间播放流地址（FLV 格式）
   * 2. 通知 Webview 切换到直播播放器视图
   * 3. 保存导航历史
   *
   * @param {number} roomId - 直播间房间号
   * @returns {Promise<void>}
   */
  public async openLive(roomId: number): Promise<void> {
    if (!this._view) { return; }

    try {
      // 获取直播流地址
      const mediaInfo = await this.apiService.getLivePlayUrl(roomId);
      if (!mediaInfo || !mediaInfo.url) {
        vscode.window.showErrorMessage('获取直播流地址失败，可能主播未开播或房间号错误');
        return;
      }

      // 获取直播间信息用于标题展示
      const roomData = await this.apiService.getLiveRoomInfo(roomId);
      const title = (roomData?.title as string) || `直播间 ${roomId}`;
      const owner = (roomData?.uid as string) || '未知主播';

      // 保存导航历史
      this._navigationHistory.push(this._currentView);

      // 通过本地代理服务器转发直播流 URL，绕过 B站 CDN 403 防盗链
      const proxiedUrl = `${this.proxyBaseUrl}/live?url=${encodeURIComponent(mediaInfo.url)}`;

      // 通知 Webview 切换到直播播放器
      this._postMessage({
        type: 'showPlayer',
        mediaType: 'live',
        url: proxiedUrl,
        format: mediaInfo.format,
        title,
        author: owner,
        roomId,
      });

      // 连接直播弹幕 WebSocket，实时输出弹幕
      this._connectLiveDanmaku(roomId);
    } catch (error) {
      vscode.window.showErrorMessage(`打开直播失败: ${error}`);
    }
  }

  /**
   * 返回上一页（从播放器回到列表）
   *
   * 从导航历史栈中弹出上一个视图类型并通知 Webview 切换回列表视图，
   * 同时发送当前列表数据以供渲染
   *
   * @returns {Promise<void>}
   */
  public async goBack(): Promise<void> {
    if (this._navigationHistory.length === 0) {
      vscode.window.showInformationMessage('没有上一页历史记录');
      return;
    }

    const previousView = this._navigationHistory.pop();
    if (previousView !== undefined) {
      this._currentView = previousView;

      // 断开直播弹幕连接并清空输出通道
      this._disconnectDanmaku();

      // 通知 Webview 切回列表视图（不重新加载数据，前端已有缓存内容）
      this._postMessage({
        type: 'showList',
        view: previousView,
      });
    }
  }

  // ==================== Webview 生命周期 ====================

  /**
   * Webview 视图创建和初始化
   *
   * 当侧边栏面板首次展开时，VSCode 调用此方法创建 Webview。
   * 在此方法中完成全部初始化工作：
   * - Webview 选项配置（脚本启用、资源访问范围）
   * - HTML 内容注入
   * - 消息监听器注册（处理来自 Webview 的用户操作）
   * - 可见性变化监听（面板重新可见时刷新数据）
   * - 加载默认视图（推荐视频）的数据
   *
   * @param {vscode.WebviewView} webviewView - VSCode 创建的 Webview 视图对象
   * @param {vscode.WebviewViewResolveContext} _context - 解析上下文（未使用）
   * @param {vscode.CancellationToken} _token - 取消令牌（未使用）
   * @returns {void}
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    // 配置 Webview 选项
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    // 注入 HTML 内容
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 注册消息监听器：处理来自 Webview 的用户操作
    webviewView.webview.onDidReceiveMessage(
      async (message: Record<string, unknown>) => {
        switch (message.type) {
          // Webview -> Extension: 用户点击了 Tab 切换按钮
          case 'switchView': {
            const view = message.view as ContentView;
            this._currentView = view;
            // 切换视图时重置分页状态
            this._resetPageState(view);
            this._postMessage({
              type: 'navigateTo',
              view,
            });
            await this._loadViewData(view);
            break;
          }

          // Webview -> Extension: 用户点击了某个视频
          case 'clickVideo': {
            const bvid = message.bvid as string;
            await this.openVideo(bvid);
            break;
          }

          // Webview -> Extension: 用户点击了某个直播间
          case 'clickLive': {
            const roomId = message.roomId as number;
            await this.openLive(roomId);
            break;
          }

          // Webview -> Extension: 用户点击了返回按钮
          case 'goBack': {
            await this.goBack();
            break;
          }

          // Webview -> Extension: 用户点击了登录按钮
          case 'login': {
            vscode.commands.executeCommand('bilibili.login');
            break;
          }

          // Webview -> Extension: 用户点击了退出登录按钮
          case 'logout': {
            await this.sessionManager.clearSession();
            this._loginStatus = {
              loggedIn: false,
              cookie: '',
              qrCodeUrl: '',
              qrCodeKey: '',
            };
            this._postMessage({
              type: 'updateLoginStatus',
              loggedIn: false,
            });
            vscode.window.showInformationMessage('已退出B站登录');
            break;
          }

          // Webview -> Extension: 用户滚动到底部，请求加载更多
          case 'loadMore': {
            const loadView = message.view as ContentView;
            await this._loadMoreData(loadView);
            break;
          }

          default:
            console.warn('未知的 Webview 消息类型:', message.type);
        }
      }
    );

    // 视图可见性变化监听：面板重新可见时刷新数据
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._postMessage({
          type: 'updateLoginStatus',
          loggedIn: this._loginStatus.loggedIn,
        });
      }
    });

    // 加载默认视图（推荐视频）的数据
    this._loadViewData(this._currentView);
  }

  // ==================== 数据加载 ====================

  /**
   * 根据当前视图类型加载对应的内容数据
   *
   * 各视图的数据来源：
   * - follows: 关注列表 + 每个UP主的最新视频/直播状态
   * - favorites: 收藏夹列表
   * - recommendedVideos: 首页推荐视频
   * - recommendedLives: 推荐直播间
   *
   * @param {ContentView} view - 要加载数据的目标视图类型
   * @returns {Promise<void>}
   */
  private async _loadViewData(view: ContentView): Promise<void> {
    try {
      switch (view) {
        case ContentView.follows:
          await this._loadFollowsData();
          break;
        case ContentView.favorites:
          await this._loadFavoritesData();
          break;
        case ContentView.recommendedVideos:
          await this._loadRecommendedVideosData();
          break;
        case ContentView.recommendedLives:
          await this._loadRecommendedLivesData();
          break;
      }
    } catch (error) {
      console.error(`加载视图数据失败 (${view}):`, error);
    }
  }

  // ==================== 分页与懒加载 ====================

  /**
   * 重置指定视图的分页状态
   *
   * 切换 Tab 时调用，将页码重置为 1
   *
   * @param {ContentView} view - 要重置的视图类型
   * @returns {void}
   */
  private _resetPageState(view: ContentView): void {
    const key = Object.keys(ContentView).find(k => ContentView[k as keyof typeof ContentView] === view);
    if (key && this._pageState[key]) {
      this._pageState[key] = { page: 1, hasMore: true, loading: false };
    }
  }

  /**
   * 加载更多数据（滚动到底部时调用）
   *
   * 页码 +1 后调用对应视图的数据加载方法
   *
   * @param {ContentView} view - 要加载更多的视图类型
   * @returns {Promise<void>}
   */
  private async _loadMoreData(view: ContentView): Promise<void> {
    const key = Object.keys(ContentView).find(k => ContentView[k as keyof typeof ContentView] === view);
    if (!key || !this._pageState[key]) { return; }

    const state = this._pageState[key];
    if (!state.hasMore || state.loading) { return; }

    state.page++;
    await this._loadViewData(view);
  }

  // ==================== 弹幕功能 ====================

  /**
   * 加载视频弹幕并输出到 OutputChannel
   *
   * 流程：
   * 1. 分段获取视频弹幕 XML（每段 6 分钟）
   * 2. 解析 XML 为结构化弹幕数据
   * 3. 格式化后输出到「bilidm」输出通道
   *
   * @param {number} cid - 视频 cid（弹幕所属资源 ID）
   * @returns {Promise<void>}
   */
  private async _loadVideoDanmaku(cid: number): Promise<void> {
    try {
      this.outputChannelManager.showDanmakuChannel(true);
      this.outputChannelManager.clearDanmakuChannel();

      // 尝试获取前 3 段弹幕（覆盖约 18 分钟内容）
      for (let seg = 1; seg <= 3; seg++) {
        const xmlData = await this.apiService.getVideoDanmaku(cid, seg);
        if (!xmlData) { continue; }

        const danmakuList = this.danmakuService.parseVideoDanmakuXML(xmlData);
        for (const item of danmakuList) {
          const text = this.danmakuService.formatDanmakuText(item);
          this.outputChannelManager.appendDanmaku(text);
        }
      }
    } catch (error) {
      console.error('加载视频弹幕失败:', error);
    }
  }

  /**
   * 连接直播弹幕 WebSocket 并实时输出弹幕
   *
   * 流程：
   * 1. 从 B站 API 获取弹幕 WebSocket 连接参数（host、token）
   * 2. 建立 WebSocket 连接并发送认证包
   * 3. 接收实时弹幕数据并解析
   * 4. 格式化后输出到「bilidm」输出通道
   *
   * @param {number} roomId - 直播间房间号
   * @returns {Promise<void>}
   */
  private async _connectLiveDanmaku(roomId: number): Promise<void> {
    try {
      // 获取弹幕 WebSocket 连接参数
      const danmakuInfo = await this.apiService.getLiveDanmakuInfo(roomId);
      if (!danmakuInfo || !danmakuInfo.host_list) {
        console.warn('获取直播弹幕连接信息失败');
        return;
      }

      // 从 host_list 获取 token（通常通过 getDanmuInfo 接口的 data.token 字段）
      const token = (danmakuInfo.token as string) || '';

      // 显示弹幕输出通道并清空旧内容
      this.outputChannelManager.showDanmakuChannel(true);
      this.outputChannelManager.clearDanmakuChannel();

      // 连接到直播弹幕 WebSocket 服务器
      this.danmakuService.connectLiveDanmaku(
        roomId,
        token,
        (danmaku) => {
          const text = this.danmakuService.formatDanmakuText(danmaku);
          this.outputChannelManager.appendDanmaku(text);
        }
      );
    } catch (error) {
      console.error('连接直播弹幕失败:', error);
    }
  }

  /**
   * 断开直播弹幕连接
   *
   * 停止 WebSocket 连接并清理回调
   *
   * @returns {void}
   */
  private _disconnectDanmaku(): void {
    this.danmakuService.disconnectLiveDanmaku();
  }

  /**
   * 加载"我的关注"数据
   *
   * 流程：
   * 1. 获取当前用户 mid
   * 2. 获取关注列表
   * 3. 对每个关注的 UP主查询最新视频和直播状态
   * 4. 合并数据发送到 Webview
   *
   * @returns {Promise<void>}
   */
  private async _loadFollowsData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this._postMessage({ type: 'updateListData', view: ContentView.follows, data: [], error: '请先登录后再查看关注列表', hasMore: false });
      return;
    }

    const state = this._pageState['follows'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const result = await this.apiService.getMyFollowing(mid, state.page, 20);
      // 关注列表不逐个查询直播状态（太慢），直接使用基本信息
      const followItems = result.list.map((follow) => ({
        mid: follow.mid,
        uname: follow.uname,
        face: follow.face ? follow.face.replace(/^\/\//, 'https://').replace(/^http:\/\//, 'https://') : '',
        liveRoom: null,
        videos: [],
      }));

      state.hasMore = result.hasMore;
      this._postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.follows,
        data: followItems,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this._postMessage({ type: 'updateListData', view: ContentView.follows, data: [], error: `获取关注列表失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 加载"我的收藏"数据
   *
   * @returns {Promise<void>}
   */
  private async _loadFavoritesData(): Promise<void> {
    const mid = await this.apiService.getMyMid();
    if (!mid) {
      this._postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: [],
        error: '请先登录后再查看收藏夹',
      });
      return;
    }

    try {
      const favorites = await this.apiService.getFavorites(mid);
      this._postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: favorites,
      });
    } catch (error) {
      this._postMessage({
        type: 'updateListData',
        view: ContentView.favorites,
        data: [],
        error: `获取收藏夹失败: ${error}`,
      });
    }
  }

  /**
   * 加载"推荐视频"数据
   *
   * @returns {Promise<void>}
   */
  private async _loadRecommendedVideosData(): Promise<void> {
    const state = this._pageState['recommendedVideos'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const result = await this.apiService.getRecommendedVideos(state.page);
      state.hasMore = result.hasMore;
      this._postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.recommendedVideos,
        data: result.list,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this._postMessage({ type: 'updateListData', view: ContentView.recommendedVideos, data: [], error: `获取推荐视频失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  /**
   * 加载"推荐直播间"数据（带分页）
   *
   * @returns {Promise<void>}
   */
  private async _loadRecommendedLivesData(): Promise<void> {
    const state = this._pageState['recommendedLives'];
    if (state.loading) { return; }
    state.loading = true;

    try {
      const result = await this.apiService.getRecommendedLives(state.page);
      state.hasMore = result.hasMore;
      this._postMessage({
        type: state.page === 1 ? 'updateListData' : 'appendListData',
        view: ContentView.recommendedLives,
        data: result.list,
        hasMore: result.hasMore,
      });
    } catch (error) {
      this._postMessage({ type: 'updateListData', view: ContentView.recommendedLives, data: [], error: `获取推荐直播失败: ${error}`, hasMore: false });
    } finally {
      state.loading = false;
    }
  }

  // ==================== HTML 模板生成 ====================

  /**
   * 生成 Webview 的完整 HTML 内容
   *
   * 包含：
   * - B站粉色主题样式（#FB7299），搭配 VSCode CSS 变量实现主题适配
   * - 顶部导航栏（标题 + 返回按钮 + 登录/用户按钮）
   * - 4 个 Tab 切换按钮（我的关注/我的收藏/推荐视频/推荐直播间）
   * - 内容区域（列表视图 / 播放器视图 / 登录 QR 码视图）
   * - 内嵌前端 JavaScript 脚本（Tab 切换、列表渲染、消息通信）
   *
   * 视图状态机：
   * ┌──────────┐  点击视频/直播  ┌──────────┐
   * │ 列表视图  │ ──────────────→ │ 播放器视图 │
   * │          │ ←────────────── │          │
   * └──────────┘  点击返回按钮   └──────────┘
   *
   * @param {vscode.Webview} webview - Webview 实例，用于生成 URI
   * @returns {string} 完整的 HTML 文档字符串
   */
  private _getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; media-src https: http://127.0.0.1:* blob:; connect-src https: wss: http://127.0.0.1:*;">
      <title>bilibili 浏览</title>
      <style>
        /* ========== 全局重置与基础样式 ========== */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif);
          background-color: var(--vscode-sideBar-background);
          color: var(--vscode-foreground);
          font-size: 12px;
          overflow: hidden;
        }

        /* ========== 根容器 ========== */
        .container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          position: relative;
        }

        /* ========== Tab 切换按钮组 ========== */
        .tab-bar {
          display: flex;
          padding: 4px 8px;
          gap: 4px;
          flex-shrink: 0;
          border-bottom: 1px solid var(--vscode-sideBar-border);
          align-items: center;
        }
        .tab-spacer { flex: 1; }
        .settings-btn {
          background: none;
          border: none;
          color: var(--vscode-sideBar-foreground);
          cursor: pointer;
          padding: 2px 6px;
          font-size: 14px;
          border-radius: 4px;
          line-height: 1;
          opacity: 0.7;
          flex-shrink: 0;
        }
        .settings-btn:hover { opacity: 1; background-color: var(--vscode-toolbar-hoverBackground); }

        /* ========== 设置菜单（下拉） ========== */
        .settings-menu {
          position: absolute;
          right: 8px;
          top: 28px;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-sideBar-border);
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          z-index: 100;
          display: none;
          min-width: 120px;
        }
        .settings-menu.show { display: block; }
        .settings-menu-item {
          display: block;
          width: 100%;
          background: none;
          border: none;
          color: var(--vscode-sideBar-foreground);
          cursor: pointer;
          padding: 6px 12px;
          font-size: 12px;
          text-align: left;
        }
        .settings-menu-item:hover { background-color: var(--vscode-toolbar-hoverBackground); }
        .hidden { display: none !important; }

        /* ========== 播放器覆盖层（自动隐藏） ========== */
        .player-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          padding: 8px;
          background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
          opacity: 0;
          transition: opacity 0.3s ease;
          z-index: 10;
        }
        .player-overlay:hover { opacity: 1; }
        .player-back-btn {
          background: none;
          border: none;
          color: #fff;
          cursor: pointer;
          font-size: 18px;
          padding: 4px 8px;
          border-radius: 4px;
          line-height: 1;
        }
        .player-back-btn:hover { background-color: rgba(255,255,255,0.2); }
        .player-overlay-info {
          flex: 1;
          min-width: 0;
          margin-left: 8px;
        }
        .player-overlay-info .title {
          font-size: 12px;
          font-weight: 500;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .player-overlay-info .author {
          font-size: 10px;
          color: rgba(255,255,255,0.7);
        }

        /* ========== Tab 切换按钮组 ========== */
        .tab-bar {
          display: flex;
          padding: 6px 8px;
          gap: 4px;
          flex-shrink: 0;
          border-bottom: 1px solid var(--vscode-sideBar-border);
        }
        .tab-btn {
          flex: 1;
          padding: 4px 0;
          border: none;
          border-radius: 4px;
          background: none;
          color: var(--vscode-foreground);
          cursor: pointer;
          font-size: 11px;
          text-align: center;
          opacity: 0.7;
          transition: opacity 0.15s, background-color 0.15s, color 0.15s;
          white-space: nowrap;
        }
        .tab-btn:hover { opacity: 0.9; background-color: var(--vscode-toolbar-hoverBackground); }
        .tab-btn.active {
          opacity: 1;
          color: #FB7299;
          font-weight: 600;
          background-color: rgba(251, 114, 153, 0.1);
        }

        /* ========== 内容区域 ========== */
        .content {
          flex: 1;
          overflow-y: auto;
          padding: 4px;
        }
        .content::-webkit-scrollbar { width: 4px; }
        .content::-webkit-scrollbar-thumb {
          background-color: var(--vscode-scrollbarSlider-background);
          border-radius: 2px;
        }

        /* ========== 列表卡片 ========== */
        .card-list { display: flex; flex-direction: column; gap: 4px; }
        .card {
          display: flex;
          gap: 8px;
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.15s;
          align-items: flex-start;
        }
        .card:hover { background-color: var(--vscode-list-hoverBackground); }
        .card-cover {
          width: 90px;
          height: 56px;
          border-radius: 4px;
          object-fit: cover;
          flex-shrink: 0;
          background-color: var(--vscode-editor-background);
        }
        .card-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .card-title {
          font-size: 12px;
          font-weight: 500;
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          word-break: break-all;
        }
        .card-meta {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .card-badge-live {
          display: inline-block;
          padding: 0 4px;
          border-radius: 2px;
          background-color: #FB7299;
          color: #fff;
          font-size: 9px;
          line-height: 15px;
        }
        .card-badge-follow {
          display: inline-block;
          padding: 0 4px;
          border-radius: 2px;
          background-color: #00aeec;
          color: #fff;
          font-size: 9px;
          line-height: 15px;
        }

        /* ========== 播放器视图 ========== */
        .player-video-area { flex: 1; position: relative; background: #000; }
        .player-video-area video {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        /* ========== 登录区 ========== */
        .login-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 20px 12px;
          gap: 12px;
        }
        .login-qrcode {
          border: 2px solid var(--vscode-sideBar-border);
          border-radius: 8px;
          padding: 8px;
          background: var(--vscode-editor-background, #fff);
        }
        .login-qrcode img { width: 180px; height: 180px; }
        .login-tips { font-size: 12px; color: var(--vscode-descriptionForeground); text-align: center; line-height: 1.5; }
        .login-tips .scanned { color: #00aeec; font-weight: 500; }
        .login-tips .expired { color: #e74c3c; font-weight: 500; }

        /* ========== 通用状态提示 ========== */
        .status-area {
          padding: 20px 12px;
          text-align: center;
          color: var(--vscode-descriptionForeground);
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: center;
        }
        .status-area .icon { font-size: 32px; }
        .status-area .msg { font-size: 12px; }
        .loading-spinner {
          width: 24px; height: 24px;
          border: 3px solid var(--vscode-descriptionForeground);
          border-top-color: #FB7299;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ========== 收藏夹列表特殊样式 ========== */
        .fav-card {
          display: flex;
          gap: 8px;
          padding: 8px 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.15s;
          align-items: center;
        }
        .fav-card:hover { background-color: var(--vscode-list-hoverBackground); }
        .fav-card .fav-cover {
          width: 48px; height: 48px;
          border-radius: 4px;
          object-fit: cover;
          flex-shrink: 0;
          background-color: var(--vscode-editor-background);
        }
        .fav-card .fav-info { flex: 1; min-width: 0; }
        .fav-card .fav-title { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fav-card .fav-count { font-size: 10px; color: var(--vscode-descriptionForeground); }

        /* ========== 关注用户列表 ========== */
        .follow-card {
          display: flex;
          gap: 8px;
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.15s;
          align-items: center;
        }
        .follow-card:hover { background-color: var(--vscode-list-hoverBackground); }
        .follow-card .follow-avatar {
          width: 32px; height: 32px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .follow-card .follow-info { flex: 1; min-width: 0; }
        .follow-card .follow-name { font-size: 12px; font-weight: 500; color: var(--vscode-foreground); }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Tab 切换按钮组 + 设置按钮 -->
        <div class="tab-bar" id="tab-bar">
          <button class="tab-btn active" data-view="recommendedVideos">推荐视频</button>
          <button class="tab-btn" data-view="recommendedLives">推荐直播</button>
          <button class="tab-btn" data-view="follows">我的关注</button>
          <button class="tab-btn" data-view="favorites">我的收藏</button>
          <span class="tab-spacer"></span>
          <button class="settings-btn" id="btn-settings" title="设置">⚙</button>
        </div>

        <!-- 设置菜单（下拉） -->
        <div class="settings-menu" id="settings-menu">
          <button class="settings-menu-item" id="menu-login">登录</button>
          <button class="settings-menu-item hidden" id="menu-logout">退出登录</button>
        </div>

        <!-- 主内容区 -->
        <div class="content" id="content">
          <div class="status-area">
            <div class="loading-spinner"></div>
            <span class="msg">加载中...</span>
          </div>
        </div>
      </div>

      <script>
        /**
         * @file Webview 前端交互脚本
         * @description 处理 Tab 切换、列表渲染、播放器控制、登录 QR 码展示等所有前端交互
         * @author zls3434
         * @date 2026-04-30
         */

        /** 获取 VSCode Webview API 实例，用于与扩展主进程通信 */
        const vscodeApi = acquireVsCodeApi();

        /** 当前激活的视图类型 */
        let currentView = 'recommendedVideos';

        /** 是否处于播放器模式 */
        let isPlayerMode = false;

        /** 播放器模式下的媒体类型（video/live） */
        let playerMediaType = '';

        /** 保存进入播放器前的列表 HTML，退出时恢复 */
        let savedListHtml = '';

        /** 是否还有更多数据可加载（用于懒加载判断） */
        let hasMoreData = true;

        /** 是否正在加载更多数据（防止重复请求） */
        let isLoadingMore = false;

        // ==================== DOM 元素引用 ====================

        const contentEl = document.getElementById('content');
        const tabBar = document.getElementById('tab-bar');
        const btnSettings = document.getElementById('btn-settings');
        const settingsMenu = document.getElementById('settings-menu');
        const menuLogin = document.getElementById('menu-login');
        const menuLogout = document.getElementById('menu-logout');

        // ==================== 设置菜单事件 ====================

        /** 设置按钮：切换菜单显示 */
        btnSettings.addEventListener('click', (e) => {
          e.stopPropagation();
          settingsMenu.classList.toggle('show');
        });

        /** 点击其他区域关闭菜单 */
        document.addEventListener('click', () => {
          settingsMenu.classList.remove('show');
        });

        /** 阻止菜单内点击冒泡（防止菜单在点击时关闭） */
        settingsMenu.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        // ==================== 滚动到底部检测（懒加载） ====================

        contentEl.addEventListener('scroll', () => {
          const scrollTop = contentEl.scrollTop;
          const scrollHeight = contentEl.scrollHeight;
          const clientHeight = contentEl.clientHeight;

          // 滚动到底部附近（距离底部 50px 以内）时触发加载更多
          if (scrollHeight - scrollTop - clientHeight < 50 && hasMoreData && !isLoadingMore && !isPlayerMode) {
            isLoadingMore = true;
            // 显示加载指示器
            const loader = document.getElementById('load-more-indicator');
            if (loader) { loader.style.display = 'block'; }
            vscodeApi.postMessage({ type: 'loadMore', view: currentView });
          }
        });

        // ==================== 设置菜单内按钮事件 ====================

        /** 登录按钮（设置菜单内） */
        menuLogin.addEventListener('click', () => {
          vscodeApi.postMessage({ type: 'login' });
          settingsMenu.classList.remove('show');
        });

        /** 退出登录按钮（设置菜单内） */
        menuLogout.addEventListener('click', () => {
          vscodeApi.postMessage({ type: 'logout' });
          settingsMenu.classList.remove('show');
        });

        // ==================== Tab 切换事件 ====================

        tabBar.addEventListener('click', (e) => {
          const target = e.target;
          if (target.classList.contains('tab-btn')) {
            const view = target.dataset.view;
            if (view && view !== currentView && !isPlayerMode) {
              // 更新 Tab 激活状态
              tabBar.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
              target.classList.add('active');
              currentView = view;

              // 显示加载动画
              showLoading();

              // 通知扩展主进程切换视图
              vscodeApi.postMessage({ type: 'switchView', view });
            }
          }
        });

        // ==================== 消息接收处理 ====================

        window.addEventListener('message', (event) => {
          const msg = event.data;
          switch (msg.type) {

            // 切换到指定视图的列表
            case 'navigateTo':
            case 'showList':
              exitPlayerMode();
              highlightTab(msg.view);
              currentView = msg.view;

              // 如果消息携带了列表数据，直接渲染
              if (msg.view && msg.data) {
                renderListByView(msg.view, msg.data);
              }
              break;

            // 接收并渲染列表数据
            case 'updateListData':
              if (msg.view === currentView && !isPlayerMode) {
                renderListByView(msg.view, msg.data, msg.error);
                // 保存 hasMore 状态用于懒加载判断
                hasMoreData = msg.hasMore !== false;
              }
              break;

            // 追加更多列表数据（懒加载）
            case 'appendListData':
              if (msg.view === currentView && !isPlayerMode) {
                appendListData(msg.view, msg.data);
                hasMoreData = msg.hasMore !== false;
                isLoadingMore = false;
              }
              break;

            // 显示播放器
            case 'showPlayer':
              enterPlayerMode(msg);
              break;

            // 显示登录 QR 码
            case 'showLogin':
              renderLoginView(msg.qrCodeDataUrl);
              break;

            // 更新登录状态
            case 'updateLoginStatus':
              updateLoginUI(msg);
              break;
          }
        });

        // ==================== 视图渲染 ====================

        /**
         * 根据视图类型渲染内容列表
         * @param {string} view - 视图类型
         * @param {Array} data - 数据数组
         * @param {string} errorMsg - 可选的错误信息
         */
        function renderListByView(view, data, errorMsg) {
          if (errorMsg) {
            contentEl.innerHTML = '<div class="status-area"><div class="icon">😕</div><div class="msg">' + escapeHtml(errorMsg) + '</div></div>';
            return;
          }
          if (!data || data.length === 0) {
            contentEl.innerHTML = '<div class="status-area"><div class="icon">📭</div><div class="msg">暂无内容</div></div>';
            return;
          }

          switch (view) {
            case 'follows':
              renderFollowingList(data);
              break;
            case 'favorites':
              renderFavoriteFolders(data);
              break;
            case 'recommendedVideos':
              renderVideoList(data);
              break;
            case 'recommendedLives':
              renderLiveList(data);
              break;
          }
        }

        /**
         * 渲染推荐视频列表
         */
        function renderVideoList(videos) {
          let html = '<div class="card-list">' + buildVideoCards(videos);
          if (hasMoreData) { html += '<div id="load-more-indicator" class="status-area" style="display:none"><div class="loading-spinner"></div><span class="msg">加载更多...</span></div>'; }
          html += '</div>';
          contentEl.innerHTML = html;
        }

        /**
         * 构建视频卡片 HTML（用于初始渲染和追加）
         */
        function buildVideoCards(videos) {
          let html = '';
          videos.forEach(v => {
            const durationStr = formatDuration(v.duration || 0);
            const playStr = formatCount(v.playCount || 0);
            html += '<div class="card" data-bvid="' + escapeHtml(v.bvid) + '" onclick="clickVideo(this)">';
            html += '<img class="card-cover" src="' + escapeHtml(v.cover) + '" alt="" loading="lazy" onerror="this.src=\\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%2256%22><rect fill=%22%23eee%22 width=%2290%22 height=%2256%22/></svg>\\'" />';
            html += '<div class="card-info">';
            html += '<div class="card-title">' + escapeHtml(v.title) + '</div>';
            html += '<div class="card-meta">';
            html += '<span>' + escapeHtml(v.author) + '</span>';
            html += '<span>' + playStr + '播放</span>';
            html += '<span>' + durationStr + '</span>';
            html += '</div></div></div>';
          });
          return html;
        }

        /**
         * 渲染推荐直播列表
         */
        function renderLiveList(lives) {
          let html = '<div class="card-list">' + buildLiveCards(lives);
          if (hasMoreData) { html += '<div id="load-more-indicator" class="status-area" style="display:none"><div class="loading-spinner"></div><span class="msg">加载更多...</span></div>'; }
          html += '</div>';
          contentEl.innerHTML = html;
        }

        /**
         * 构建直播卡片 HTML
         */
        function buildLiveCards(lives) {
          let html = '';
          lives.forEach(l => {
            const onlineStr = formatCount(l.online || 0);
            html += '<div class="card" data-room-id="' + l.roomId + '" onclick="clickLive(this)">';
            html += '<img class="card-cover" src="' + escapeHtml(l.cover) + '" alt="" loading="lazy" onerror="this.src=\\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%2256%22><rect fill=%22%23eee%22 width=%2290%22 height=%2256%22/></svg>\\'" />';
            html += '<div class="card-info">';
            html += '<div class="card-title">' + escapeHtml(l.title) + '</div>';
            html += '<div class="card-meta">';
            html += '<span>' + escapeHtml(l.owner) + '</span>';
            html += '<span class="card-badge-live">● LIVE</span>';
            html += '<span>' + onlineStr + '人气</span>';
            html += '</div></div></div>';
          });
          return html;
        }

        /**
         * 渲染关注列表
         */
        function renderFollowingList(followItems) {
          let html = '<div class="card-list">' + buildFollowCards(followItems);
          if (hasMoreData) { html += '<div id="load-more-indicator" class="status-area" style="display:none"><div class="loading-spinner"></div><span class="msg">加载更多...</span></div>'; }
          html += '</div>';
          contentEl.innerHTML = html;
        }

        /**
         * 构建关注卡片 HTML
         */
        function buildFollowCards(followItems) {
          let html = '';
          followItems.forEach(f => {
            html += '<div class="follow-card">';
            html += '<img class="follow-avatar" src="' + ensureHttps(escapeHtml(f.face)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=none" />';
            html += '<div class="follow-info"><span class="follow-name">' + escapeHtml(f.uname) + '</span></div>';
            if (f.liveRoom) {
              html += '<span class="card-badge-live" style="cursor:pointer" data-room-id="' + f.liveRoom.roomId + '" onclick="event.stopPropagation();clickLive(this)">● LIVE</span>';
            } else {
              html += '<span class="card-badge-follow" style="cursor:pointer" data-mid="' + f.mid + '">关注中</span>';
            }
            html += '</div>';
          });
          return html;
        }

        /**
         * 渲染收藏夹列表
         */
        function renderFavoriteFolders(folders) {
          let html = '<div class="card-list">';
          folders.forEach(f => {
            html += '<div class="fav-card" data-media-id="' + f.id + '" onclick="clickFavorite(this)">';
            html += '<img class="fav-cover" src="' + ensureHttps(escapeHtml(f.cover)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src=\\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><rect fill=%22%23eee%22 width=%2248%22 height=%2248%22/></svg>\\'" />';
            html += '<div class="fav-info">';
            html += '<div class="fav-title">' + escapeHtml(f.title) + '</div>';
            html += '<div class="fav-count">' + (f.media_count || 0) + ' 个视频</div>';
            html += '</div></div>';
          });
          html += '</div>';
          contentEl.innerHTML = html;
        }

        /**
         * 渲染登录 QR 码视图
         */
        function renderLoginView(qrCodeDataUrl) {
          let html = '<div class="login-area">';
          html += '<div class="login-qrcode"><img src="' + qrCodeDataUrl + '" alt="登录二维码" /></div>';
          html += '<div class="login-tips" id="login-tips">📱 请使用 B站 App 扫描二维码登录</div>';
          html += '</div>';
          contentEl.innerHTML = html;
        }

        // ==================== 播放器 ====================

        /**
         * 进入播放器模式
         */
        function enterPlayerMode(data) {
          // 保存当前列表内容，退出播放器时恢复
          savedListHtml = contentEl.innerHTML;
          isPlayerMode = true;
          playerMediaType = data.mediaType;

          // 切换 UI：隐藏 Tab 栏（含设置按钮）
          tabBar.style.display = 'none';

          let html = '<div class="player-container" style="position:relative;">';
          html += '<div class="player-overlay" id="player-overlay">';
          html += '<button class="player-back-btn" id="player-btn-back" title="返回">◂</button>';
          html += '<div class="player-overlay-info">';
          html += '<div class="title">' + escapeHtml(data.title || '正在播放') + '</div>';
          html += '<div class="author">' + escapeHtml(data.author || '') + '</div>';
          html += '</div></div>';

          html += '<div class="player-video-area">';
          if (data.mediaType === 'video') {
            html += '<video id="video-player" autoplay controls crossorigin="anonymous" style="width:100%;height:100%;object-fit:contain;"></video>';
          } else if (data.mediaType === 'live') {
            html += '<video id="video-player" autoplay crossorigin="anonymous" style="width:100%;height:100%;object-fit:contain;"></video>';
          }
          html += '</div>';

          html += '</div>';
          html += '</div>';

          contentEl.innerHTML = html;

          // 绑定播放器返回按钮
          document.getElementById('player-btn-back').addEventListener('click', () => {
            vscodeApi.postMessage({ type: 'goBack' });
          });

          // 初始化播放器
          setupPlayer(data);
        }

        /**
         * 设置播放器
         */
        function setupPlayer(data) {
          const videoEl = document.getElementById('video-player');
          if (!videoEl) { return; }

          videoEl.src = data.url;
        }

        /**
         * 退出播放器模式，回到列表
         */
        function exitPlayerMode() {
          isPlayerMode = false;
          tabBar.style.display = 'flex';

          // 清理播放器
          const videoEl = document.getElementById('video-player');
          if (videoEl) {
            videoEl.pause();
            videoEl.src = '';
          }

          // 恢复之前保存的列表内容
          if (savedListHtml) {
            contentEl.innerHTML = savedListHtml;
            savedListHtml = '';
          }
        }

        // ==================== 列表项点击事件 ====================

        function clickVideo(el) {
          const bvid = el.dataset.bvid;
          if (bvid) {
            vscodeApi.postMessage({ type: 'clickVideo', bvid });
          }
        }

        function clickLive(el) {
          const roomId = parseInt(el.dataset.roomId, 10);
          if (roomId) {
            vscodeApi.postMessage({ type: 'clickLive', roomId });
          }
        }

        function clickFavorite(el) {
          const mediaId = parseInt(el.dataset.mediaId, 10);
          if (mediaId) {
            contentEl.innerHTML = '<div class="status-area"><div class="loading-spinner"></div><div class="msg">加载收藏视频中...</div></div>';
            // 收藏夹视频加载暂时使用占位逻辑，后续可扩展为真实请求
            vscodeApi.postMessage({ type: 'clickFavorite', mediaId });
          }
        }

        // ==================== UI 辅助 ====================

        function showLoading() {
          contentEl.innerHTML = '<div class="status-area"><div class="loading-spinner"></div><span class="msg">加载中...</span></div>';
        }

        /**
         * 追加更多数据到现有列表（懒加载）
         * @param {string} view - 视图类型
         * @param {Array} data - 新数据数组
         */
        function appendListData(view, data) {
          if (!data || data.length === 0) { return; }

          // 移除加载指示器
          const loader = document.getElementById('load-more-indicator');
          if (loader) { loader.remove(); }

          // 生成新数据的 HTML
          let html = '';
          switch (view) {
            case 'recommendedVideos':
            case 'favorites':
              html = buildVideoCards(data);
              break;
            case 'recommendedLives':
              html = buildLiveCards(data);
              break;
            case 'follows':
              html = buildFollowCards(data);
              break;
          }

          // 追加到列表容器
          const listContainer = contentEl.querySelector('.card-list') || contentEl.querySelector('.fav-card-list');
          if (listContainer) {
            listContainer.insertAdjacentHTML('beforeend', html);
          } else {
            // 如果没有列表容器，重新渲染
            renderListByView(view, data);
          }
        }

        function highlightTab(view) {
          tabBar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
          });
        }

        function updateLoginUI(msg) {
          if (msg.loggedIn === true) {
            menuLogin.classList.add('hidden');
            menuLogout.classList.remove('hidden');
            currentView = 'recommendedVideos';
            highlightTab('recommendedVideos');
            showLoading();
            vscodeApi.postMessage({ type: 'switchView', view: 'recommendedVideos' });
          } else if (msg.loggedIn === false) {
            menuLogin.classList.remove('hidden');
            menuLogout.classList.add('hidden');
          }

          // 更新登录 QR 码区域的提示文字
          const tips = document.getElementById('login-tips');
          if (tips) {
            if (msg.scanned) {
              tips.innerHTML = '<span class="scanned">✅ 已扫描，请在手机上确认登录</span>';
            } else if (msg.expired) {
              tips.innerHTML = '<span class="expired">⏰ 二维码已过期，请重新点击登录</span>';
            }
          }
        }

        // ==================== 通用工具函数 ====================

        /** 防止 XSS 攻击的 HTML 转义 */
        function escapeHtml(str) {
          if (!str) { return ''; }
          const div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        /** 确保 URL 使用 HTTPS 协议（B站图片链接可能是 // 开头的协议相对 URL） */
        function ensureHttps(url) {
          if (!url) { return ''; }
          if (url.startsWith('//')) { return 'https:' + url; }
          if (url.startsWith('http://')) { return url.replace('http://', 'https://'); }
          return url;
        }

        /** 格式化秒数为 mm:ss 或 hh:mm:ss */
        function formatTime(seconds) {
          if (!isFinite(seconds) || seconds < 0) { return '--:--'; }
          const h = Math.floor(seconds / 3600);
          const m = Math.floor((seconds % 3600) / 60);
          const s = Math.floor(seconds % 60);
          if (h > 0) { return h + ':' + pad(m) + ':' + pad(s); }
          return pad(m) + ':' + pad(s);
        }

        /** 格式化时长（秒数） */
        function formatDuration(secs) { return formatTime(secs); }

        /** 数字补零 */
        function pad(n) { return n < 10 ? '0' + n : '' + n; }

        /** 格式化大数字（万、亿） */
        function formatCount(num) {
          if (!num) { return '0'; }
          if (num >= 100000000) { return (num / 100000000).toFixed(1) + '亿'; }
          if (num >= 10000) { return (num / 10000).toFixed(1) + '万'; }
          return num.toString();
        }
      </script>
    </body>
    </html>`;
  }
}
