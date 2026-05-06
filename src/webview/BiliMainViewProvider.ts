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
 * @modification 2026-05-04 zls3434 重构：将弹幕追踪逻辑提取到 VideoDanmakuTracker，
 *               将数据加载逻辑提取到 ViewDataLoader，减少 BiliMainViewProvider 的职责
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
import { logger } from '../utils/logger';
import * as QRCode from 'qrcode';
import { VideoDanmakuTracker } from './videoDanmakuTracker';
import { ViewDataLoader } from './viewDataLoader';
import { getWebviewHtml } from './htmlTemplate';

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

  /** 标记是否为首次激活（用于决定是否重新加载数据） */
  private _firstActivation: boolean = true;

  /** 上次注册事件监听器的 Webview 实例（避免在同一 Webview 上重复注册） */
  private _lastRegisteredWebview: vscode.Webview | undefined;

  /**
   * 标记 HTML 是否已注入到 Webview 中
   * 用于判断 retainContextWhenHidden 是否生效：
   * - 如果 _htmlInjected 为 true 且 webview.html 非空，说明 Webview 被保留，不需要重建
   * - 如果 _htmlInjected 为 true 但 webview.html 为空，说明 Webview 被销毁重建了
   */
  private _htmlInjected: boolean = false;

  /** 登录状态信息 */
  private _loginStatus: LoginStatus = {
    loggedIn: false,
    cookie: '',
    qrCodeUrl: '',
    qrCodeKey: '',
  };

  /**
   * 分页状态：每个视图的当前页码
   *
   * 修改日期：2026-05-02
   * 修改人：zls3434
   * 修改目的：新增 followsVideos 和 followsLive 的分页状态
   */
  private _pageState: Record<string, { page: number; hasMore: boolean; loading: boolean; feedOffset?: string }> = {
    follows: { page: 1, hasMore: true, loading: false },
    followsVideos: { page: 1, hasMore: true, loading: false },
    followsLive: { page: 1, hasMore: true, loading: false },
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

  /** 视频弹幕进度追踪器 */
  private _danmakuTracker: VideoDanmakuTracker;

  /** 视图数据加载器 */
  private _viewDataLoader: ViewDataLoader;

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
    this._danmakuTracker = new VideoDanmakuTracker(this.danmakuService, this.outputChannelManager, this.apiService);
    this._viewDataLoader = new ViewDataLoader({
      apiService: this.apiService,
      danmakuService: this.danmakuService,
      outputChannelManager: this.outputChannelManager,
      postMessage: (msg) => this._postMessage(msg),
      pageState: this._pageState,
      viewHasData: this._viewHasData,
    });

    // 启动时自动尝试恢复登录态（异步执行，不阻塞构造函数）
    this._restoreSession().catch((err) => {
      logger.error(`恢复登录态失败: ${err}`);
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
        logger.info('bilibili 登录态已自动恢复');

        /**
         * 修复：恢复登录态后主动通知 Webview 更新 UI
         *
         * 修改日期：2026-05-04
         * 修改人：zls3434
         * 修改目的：解决重装/更新插件后初次加载时，后端登录态已恢复但前端 UI 仍显示"登录"按钮的问题。
         * 场景：_restoreSession() 在构造函数中异步执行，此时 Webview 可能已创建完毕，
         *       但 onDidChangeVisibility 只在面板从隐藏变为可见时触发，首次打开不会触发。
         *       因此需要在此处主动推送登录状态，确保 UI 与后端状态一致。
         */
        this._postMessage({ type: 'updateLoginStatus', loggedIn: true });
      } else {
        /**
         * 修复：Cookie 无效时主动通知 Webview 更新 UI 为未登录状态
         *
         * 修改日期：2026-05-04
         * 修改人：zls3434
         * 修改目的：Cookie 已过期时，清空持久化存储并通知前端为未登录状态，
         *          避免前端从缓存恢复的 loggedIn 状态与实际不一致
         */
        await this.sessionManager.clearSession();
        this._postMessage({ type: 'updateLoginStatus', loggedIn: false });
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
              // 通知 Webview 登录成功（更新 UI 状态）
              this._postMessage({
                type: 'updateLoginStatus',
                loggedIn: true,
              });
              // 通知 Webview 登录成功（导航到推荐视频）
              this._postMessage({
                type: 'loginSuccess',
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

      // 加载并输出视频弹幕，委托给 VideoDanmakuTracker
      const videoDuration = (videoInfo.duration as number) || 0;
      this._danmakuTracker.loadDanmaku(cid, videoDuration);
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
   * 当侧边栏面板展开时，VSCode/Trae 调用此方法。
   *
   * 关键设计：
   * - 通过检查 webview.html 是否为空，判断 Webview 是否被保留（retainContextWhenHidden 生效）
   * - 如果 Webview 被保留（html 非空），不重新设置 options 和 HTML（避免 Webview 重置）
   * - 如果 Webview 被重建（html 为空），设置 options 和注入 HTML
   * - 前端通过 vscodeApi.getState/setState 在 Webview 被重建时恢复 UI 状态
   * - 后端只在首次加载数据，后续依靠前端缓存和状态恢复
   * - 事件监听器按 Webview 实例跟踪，同一实例不重复注册避免泄漏
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
    // 更新 Webview 引用
    this._view = webviewView;

    // 判断 Webview 是否需要初始化 HTML
    // 策略：如果之前已注入过 HTML 且 webview.html 仍然非空，说明 retainContextWhenHidden 生效，
    // Webview 被保留在了内存中，不需要重建；否则需要注入
    const needsInit = !this._htmlInjected || !webviewView.webview.html;

    if (needsInit) {
      // Webview 是新建的或被重建了：必须设置 options 和注入 HTML
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          this.extensionUri,
          vscode.Uri.joinPath(this.extensionUri, 'media'),
        ],
      };
      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
      this._htmlInjected = true;
    }
    // 如果 Webview 不是新建的（retainContextWhenHidden 生效），不重新设置 options 和 HTML
    // 重新设置会导致 Webview 完全重置，丢失所有 DOM 和 JS 状态

    // 只在 Webview 实例变化时注册事件监听器（同一个 Webview 不重复注册，避免泄漏）
    if (this._lastRegisteredWebview !== webviewView.webview) {
      this._lastRegisteredWebview = webviewView.webview;

      // 消息监听器：接收来自 Webview 前端的用户操作
      webviewView.webview.onDidReceiveMessage(
        async (message: Record<string, unknown>) => {
          switch (message.type) {
            case 'switchView': {
              const view = message.view as ContentView;
              this._currentView = view;
              this._postMessage({ type: 'navigateTo', view });
              if (!this._hasDataForView(view)) {
                await this._loadViewData(view);
              }
              break;
            }
            case 'clickVideo': {
              const bvid = message.bvid as string;
              await this.openVideo(bvid);
              break;
            }
            case 'clickLive': {
              const roomId = message.roomId as number;
              await this.openLive(roomId);
              break;
            }
            case 'goBack': {
              await this.goBack();
              break;
            }
            case 'videoProgress': {
              // 视频播放进度更新，推送对应时间的弹幕到 bilidm 通道
              const currentMs = message.currentMs as number;
              this._danmakuTracker.onVideoProgress(currentMs);
              break;
            }
            case 'login': {
              vscode.commands.executeCommand('bilibili.login');
              break;
            }
            case 'logout': {
              await this.sessionManager.clearSession();
              this._loginStatus = { loggedIn: false, cookie: '', qrCodeUrl: '', qrCodeKey: '' };
              this._postMessage({ type: 'updateLoginStatus', loggedIn: false });
              vscode.window.showInformationMessage('已退出B站登录');
              break;
            }
            case 'loadMore': {
              const loadView = message.view as ContentView;
              await this._loadMoreData(loadView);
              break;
            }
            case 'refresh': {
              const refreshView = message.view as ContentView;
              this._viewHasData[Object.keys(ContentView).find(k => ContentView[k as keyof typeof ContentView] === refreshView) || ''] = false;
              this._resetPageState(refreshView);
              await this._loadViewData(refreshView);
              break;
            }
            case 'clearCache': {
              // 清空所有视图数据缓存和分页状态
              for (const key of Object.keys(this._viewHasData)) {
                this._viewHasData[key] = false;
              }
              this._resetAllPageState();
              vscode.window.showInformationMessage('缓存已清理');
              break;
            }
            default:
              logger.warn(`未知的 Webview 消息类型: ${message.type}`);
          }
        }
      );

      // 视图可见性变化监听：面板重新可见时同步登录状态
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this._postMessage({ type: 'updateLoginStatus', loggedIn: this._loginStatus.loggedIn });
        }
      });
    }

    // 只在首次激活时加载数据，后续依赖前端状态恢复
    if (this._firstActivation) {
      this._loadViewData(this._currentView);
    }
    this._firstActivation = false;
  }

  // ==================== 数据加载 ====================

  /**
   * 根据当前视图类型加载对应的内容数据
   *
   * 各视图的数据来源：
   * - follows: 关注列表 + 每个UP主的最新视频/直播状态
   * - followsVideos: 关注UP主的最新视频投稿（聚合后按时间排序）
   * - followsLive: 正在直播的关注UP主列表
   * - favorites: 收藏夹列表
   * - recommendedVideos: 首页推荐视频
   * - recommendedLives: 推荐直播间
   *
   * 修改日期：2026-05-02
   * 修改人：zls3434
   * 修改目的：新增 followsVideos 和 followsLive 视图的数据加载分支
   *
   * @param {ContentView} view - 要加载数据的目标视图类型
   * @returns {Promise<void>}
   */
  /**
   * 根据当前视图类型加载对应的内容数据
   *
   * 委托给 ViewDataLoader 执行具体的数据加载逻辑
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：将数据加载逻辑提取到 ViewDataLoader 类，本方法仅作为委托入口
   *
   * @param {ContentView} view - 要加载数据的目标视图类型
   * @returns {Promise<void>}
   */
  private async _loadViewData(view: ContentView): Promise<void> {
    await this._viewDataLoader.loadViewData(view);
  }

  // ==================== 数据缓存 ====================

  /**
   * 缓存每个视图是否已有数据（避免切换 Tab 时重复加载）
   *
   * 修改日期：2026-05-02
   * 修改人：zls3434
   * 修改目的：新增 followsVideos 和 followsLive 的缓存标记
   */
  private _viewHasData: Record<string, boolean> = {
    follows: false,
    followsVideos: false,
    followsLive: false,
    favorites: false,
    recommendedVideos: false,
    recommendedLives: false,
  };

  /**
   * 检查指定视图是否已有数据
   *
   * @param {ContentView} view - 视图类型
   * @returns {boolean} 是否已有数据
   */
  private _hasDataForView(view: ContentView): boolean {
    const key = Object.keys(ContentView).find(k => ContentView[k as keyof typeof ContentView] === view);
    return key ? (this._viewHasData[key] ?? false) : false;
  }

  /**
   * 标记指定视图已有数据
   */
  private _markViewHasData(view: ContentView): void {
    const key = Object.keys(ContentView).find(k => ContentView[k as keyof typeof ContentView] === view);
    if (key) { this._viewHasData[key] = true; }
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
      this._pageState[key] = { page: 1, hasMore: true, loading: false, feedOffset: '' };
    }
  }

  private _resetAllPageState(): void {
    for (const key of Object.keys(this._pageState)) {
      this._pageState[key] = { page: 1, hasMore: true, loading: false, feedOffset: '' };
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

  // _onVideoProgress、_findDanmakuIndexByTime、_loadVideoDanmaku 方法
  // 已移至 VideoDanmakuTracker 类，参见 videoDanmakuTracker.ts

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
      // 获取弹幕 WebSocket 连接参数（host_list、token 等）
      const danmakuInfo = await this.apiService.getLiveDanmakuInfo(roomId);
      if (!danmakuInfo) {
        logger.warn('获取直播弹幕连接信息失败：API 返回 null');
        return;
      }

      const token = (danmakuInfo.token as string) || '';
      const hostList = danmakuInfo.host_list as Array<Record<string, unknown>> || [];

      // 调试：打印 API 返回的完整弹幕连接信息
      logger.info(`getDanmuInfo 响应: token=${token ? token.substring(0, 20) + '...' : 'empty'}, host_list=${JSON.stringify(hostList)}`);

      // 使用 API 返回的第一个弹幕服务器地址
      // host_list 数据结构：{ host, port(常规TCP), wss_port(加密WS), ws_port(非加密WS) }
      let hostInfo: { host: string; port: number; wsScheme: string } | undefined;
      if (hostList.length > 0) {
        const firstHost = hostList[0];
        const wssPort = (firstHost.wss_port as number) || 0;
        const wsPort = (firstHost.ws_port as number) || 0;
        // 优先使用 wss 加密连接（端口 443），回退到 ws 非加密连接（端口 2244）
        if (wssPort > 0) {
          hostInfo = {
            host: (firstHost.host as string) || 'broadcastlv.chat.bilibili.com',
            port: wssPort,
            wsScheme: 'wss',
          };
        } else if (wsPort > 0) {
          hostInfo = {
            host: (firstHost.host as string) || 'broadcastlv.chat.bilibili.com',
            port: wsPort,
            wsScheme: 'ws',
          };
        } else {
          hostInfo = {
            host: (firstHost.host as string) || 'broadcastlv.chat.bilibili.com',
            port: (firstHost.port as number) || 443,
            wsScheme: 'wss',
          };
        }
      }

      if (!token && hostList.length === 0) {
        logger.warn('获取直播弹幕连接信息失败：缺少 token 和 host_list');
        return;
      }

      logger.info(`弹幕连接信息: host=${hostInfo?.host}, port=${hostInfo?.port}, token=${token ? '已获取' : '缺失'}`);

      // 显示弹幕输出通道并清空旧内容
      this.outputChannelManager.showDanmakuChannel(true);
      this.outputChannelManager.clearDanmakuChannel();

      // 获取当前登录用户的 UID（用于弹幕认证，真实 UID 避免弹幕用户名脱敏为 X***）
      const uid = await this.apiService.getMyMid() || 0;

      // 连接到直播弹幕 WebSocket 服务器（传入 API 返回的服务器地址和用户 UID）
      this.danmakuService.connectLiveDanmaku(
        roomId,
        token,
        (danmaku) => {
          const text = this.danmakuService.formatDanmakuText(danmaku);
          this.outputChannelManager.appendDanmaku(text);
        },
        hostInfo,
        uid
      );
    } catch (error) {
      logger.error(`连接直播弹幕失败: ${error}`);
    }
  }

  /**
   * 断开直播弹幕连接
   *
   * 停止 WebSocket 连接并清理回调
   *
   * @returns {void}
   */
  /**
   * 断开直播弹幕连接并清理弹幕状态
   *
   * 修改日期：2026-05-04
   * 修改人：zls3434
   * 修改目的：将视频弹幕清理逻辑委托给 VideoDanmakuTracker.clear() 方法
   *
   * @returns {void}
   */
  private _disconnectDanmaku(): void {
    this.danmakuService.disconnectLiveDanmaku();
    // 清理视频弹幕队列（委托给 VideoDanmakuTracker）
    this._danmakuTracker.clear();
  }

  // _loadFollowsData、_loadFollowsVideosData、_loadFollowsLiveData、
  // _loadFavoritesData、_loadRecommendedVideosData、_loadRecommendedLivesData 方法
  // 已移至 ViewDataLoader 类，参见 viewDataLoader.ts

  // ==================== HTML 模板生成 ====================
  // HTML 模板已移至 htmlTemplate.ts，参见 getWebviewHtml 函数

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return getWebviewHtml(webview, this.extensionUri);
  }
}
