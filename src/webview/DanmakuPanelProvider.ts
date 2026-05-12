/**
 * @file src/webview/DanmakuPanelProvider.ts
 * @description 弹幕面板 WebviewView 提供者
 *
 * 主要功能：
 * - 实现 vscode.WebviewViewProvider 接口，在 VSCode 侧边栏注册弹幕面板
 * - 接收来自 DanmakuService 的弹幕数据并推送到前端 Webview 渲染
 * - 支持直播弹幕模式（实时推送）和视频弹幕模式（按时间同步）
 * - 处理前端发送弹幕的请求，调用 BiliApiService 发送弹幕
 * - 管理弹幕面板的激活、停用和登录状态同步
 *
 * 在项目中的角色：
 * 替代原有的 OutputChannel 弹幕输出方式，提供独立的交互式弹幕面板，
 * 支持弹幕滚动、发送弹幕、自动滚动等交互功能
 *
 * @author zls3434
 * @date 2026-05-06
 * @modification 2026-05-06 zls3434 创建独立弹幕面板替代输出面板弹幕通道
 */

import * as vscode from 'vscode';
import { DanmakuItem } from '../services/danmakuService';
import { SessionManager } from '../services/sessionManager';
import { BiliApiService } from '../services/biliApi';
import { getDanmakuPanelHtml } from './danmakuPanelHtml';
import { logger } from '../utils/logger';

/**
 * 弹幕面板提供者类
 *
 * 实现 vscode.WebviewViewProvider 接口，负责：
 * - 创建和管理侧边栏弹幕面板的 Webview 视图
 * - 接收弹幕数据并实时推送到前端渲染
 * - 处理前端发送弹幕的请求
 * - 维护当前弹幕面板的模式（直播/视频）和状态
 *
 * 使用方式：
 * 1. 在 extension.ts 中注册：vscode.window.registerWebviewViewProvider('bilibili-danmaku-panel', provider)
 * 2. 直播时调用 activateForLive(roomId) 激活弹幕面板
 * 3. 视频时调用 activateForVideo(bvid, cid) 激活弹幕面板
 * 4. 通过 appendDanmaku(item) 推送弹幕数据
 * 5. 退出时调用 deactivate() 停用面板
 */
export class DanmakuPanelProvider implements vscode.WebviewViewProvider {
  /** Webview 视图实例，undefined 表示面板尚未创建或已销毁 */
  private _view?: vscode.WebviewView;

  /** 当前直播间房间号，null 表示未在直播弹幕模式 */
  private _currentRoomId: number | null = null;

  /** 当前视频 BV 号，null 表示未在视频弹幕模式 */
  private _currentBvid: string | null = null;

  /** 当前视频 cid（分P标识），null 表示未在视频弹幕模式 */
  private _currentCid: number | null = null;

  /** 当前视频播放进度（毫秒），用于发送视频弹幕时附带的播放时间 */
  private _currentVideoMs: number = 0;

  /** 是否为直播弹幕模式，true=直播弹幕，false=视频弹幕 */
  private _isLiveMode: boolean = false;

  /** 扩展根目录 URI，用于加载 Webview 静态资源 */
  private readonly extensionUri: vscode.Uri;

  /** 会话管理器实例，用于获取登录态 Cookie 以发送弹幕 */
  private readonly sessionManager: SessionManager;

  /** B站 API 服务实例，用于调用弹幕发送接口 */
  private readonly apiService: BiliApiService;

  /**
   * 构造函数
   *
   * 初始化弹幕面板提供者，注入依赖的服务实例
   *
   * @param {vscode.Uri} extensionUri - 扩展的根目录 URI，用于生成 Webview 资源路径
   * @param {SessionManager} sessionManager - 会话管理器，用于获取登录态 Cookie
   * @param {BiliApiService} apiService - B站 API 服务，用于调用弹幕发送接口
   */
  constructor(
    extensionUri: vscode.Uri,
    sessionManager: SessionManager,
    apiService: BiliApiService
  ) {
    this.extensionUri = extensionUri;
    this.sessionManager = sessionManager;
    this.apiService = apiService;
  }

  // ==================== WebviewViewProvider 接口实现 ====================

  /**
   * Webview 视图创建和初始化
   *
   * 当侧边栏弹幕面板首次展开时，VSCode 调用此方法。
   * 配置 Webview 选项、注入 HTML 内容并注册消息监听器。
   *
   * 配置说明：
   * - retainContextWhenHidden: true，面板隐藏时保留状态，避免重建
   * - enableScripts: true，允许前端 JavaScript 与扩展主进程通信
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
    // 保存 Webview 视图引用
    this._view = webviewView;

    // 配置 Webview 选项
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
      ],
    };

    // 注入 HTML 内容
    webviewView.webview.html = getDanmakuPanelHtml(webviewView.webview, this.extensionUri);

    // 注册消息监听器，处理来自前端的用户操作
    webviewView.webview.onDidReceiveMessage(
      async (message: Record<string, unknown>) => {
        switch (message.type) {
          case 'sendDanmaku': {
            // 前端请求发送弹幕，验证参数类型和非空
            if (typeof message.text !== 'string' || !message.text.trim()) {
              logger.warn('弹幕发送请求参数无效');
              break;
            }
            await this._handleSendDanmaku(message.text);
            break;
          }
          default:
            logger.warn(`弹幕面板收到未知消息类型: ${message.type}`);
        }
      }
    );

    // 视图可见性变化时同步登录状态到前端
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        // 面板重新可见时，检查并同步登录状态
        this.sessionManager.isLoggedIn().then((loggedIn) => {
          this._postMessage({ type: 'updateLoginStatus', loggedIn });
        });
      }
    });

    // 初始化完成后立即同步当前状态到前端
    // 修复问题：首次打开弹幕面板时登录状态和模式状态未及时更新，
    // 因为 onDidChangeVisibility 在首次 resolve 时可能不会触发
    this.sessionManager.isLoggedIn().then((loggedIn) => {
      this._postMessage({ type: 'updateLoginStatus', loggedIn });
    });
    // 同步当前弹幕模式（直播/视频/未激活）
    if (this._isLiveMode && this._currentRoomId !== null) {
      this._postMessage({
        type: 'updateMode',
        mode: 'live',
        title: `直播间 ${this._currentRoomId}`,
      });
    } else if (!this._isLiveMode && this._currentBvid !== null) {
      this._postMessage({
        type: 'updateMode',
        mode: 'video',
        title: `视频 ${this._currentBvid}`,
      });
    }

    logger.info('弹幕面板 Webview 已初始化');
  }

  // ==================== 公开方法（供 extension.ts 或其他模块调用） ====================

  /**
   * 向弹幕面板推送一条弹幕数据
   *
   * 将弹幕数据格式化后通过 postMessage 推送到前端 Webview 渲染。
   * 前端收到后会自动追加到弹幕列表，并根据滚动位置决定是否自动滚动。
   *
   * @param {DanmakuItem} danmaku - 弹幕数据项，包含 username、text、timestamp 等字段
   * @returns {void}
   */
  public appendDanmaku(danmaku: DanmakuItem): void {
    if (!this._view) {
      return;
    }

    // 交互消息（入场/关注/分享）不进入弹幕列表，更新到底部入场提示栏
    if (danmaku.isInteract) {
      this._postMessage({
        type: 'interactMessage',
        username: danmaku.username,
        text: danmaku.text,
      });
      return;
    }

    // 格式化时间戳
    // 直播弹幕：timestamp 是真实时间戳（毫秒），格式化为 HH:mm:ss
    // 视频弹幕：timestamp 是视频内时间（毫秒），格式化为 mm:ss
    let timeStr: string;
    if (danmaku.isLive) {
      timeStr = new Date(danmaku.timestamp).toTimeString().slice(0, 8);
    } else {
      const totalSec = Math.floor(danmaku.timestamp / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      timeStr = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    this._postMessage({
      type: 'appendDanmaku',
      username: danmaku.username,
      text: danmaku.text,
      timestamp: danmaku.timestamp,
      timeStr,
      isLive: danmaku.isLive,
    });
  }

  /**
   * 清空弹幕面板中的所有弹幕
   *
   * 通知前端清空弹幕列表 DOM，通常在切换直播间/视频时调用
   *
   * @returns {void}
   */
  public clearDanmaku(): void {
    this._postMessage({ type: 'clearDanmaku' });
  }

  /**
   * 激活弹幕面板用于直播模式
   *
   * 设置当前模式为直播弹幕，清空旧数据，通知前端更新标题和模式
   *
   * @param {number} roomId - 直播间房间号
   * @returns {void}
   */
  public activateForLive(roomId: number): void {
    this._currentRoomId = roomId;
    this._currentBvid = null;
    this._currentCid = null;
    this._currentVideoMs = 0;
    this._isLiveMode = true;

    // 清空旧弹幕数据
    this.clearDanmaku();

    // 通知前端切换到直播弹幕模式
    this._postMessage({
      type: 'updateMode',
      mode: 'live',
      title: `直播间 ${roomId}`,
    });

    // 自动展开弹幕面板，确保用户进入直播时能看到弹幕
    // 使用命令聚焦面板视图，比 show() 更可靠（面板未 resolve 时也能工作）
    vscode.commands.executeCommand('bilibili-danmaku-panel.focus');

    logger.info(`弹幕面板已激活为直播模式，房间号: ${roomId}`);
  }

  /**
   * 激活弹幕面板用于视频模式
   *
   * 设置当前模式为视频弹幕，清空旧数据，通知前端更新标题和模式
   *
   * @param {string} bvid - 视频 BV 号，如 "BV1xx411c7m9"
   * @param {number} cid - 视频分P的 cid 标识
   * @returns {void}
   */
  public activateForVideo(bvid: string, cid: number): void {
    this._currentRoomId = null;
    this._currentBvid = bvid;
    this._currentCid = cid;
    this._currentVideoMs = 0;
    this._isLiveMode = false;

    // 清空旧弹幕数据
    this.clearDanmaku();

    // 通知前端切换到视频弹幕模式
    this._postMessage({
      type: 'updateMode',
      mode: 'video',
      title: `视频 ${bvid}`,
    });

    // 自动展开弹幕面板，确保用户进入视频播放时能看到弹幕
    vscode.commands.executeCommand('bilibili-danmaku-panel.focus');

    logger.info(`弹幕面板已激活为视频模式，BV号: ${bvid}, cid: ${cid}`);
  }

  /**
   * 停用弹幕面板
   *
   * 清空所有状态和弹幕数据，将面板恢复为初始状态
   * 通常在退出直播/视频播放时调用
   *
   * @returns {void}
   */
  public deactivate(): void {
    this._currentRoomId = null;
    this._currentBvid = null;
    this._currentCid = null;
    this._currentVideoMs = 0;
    this._isLiveMode = false;

    // 清空弹幕数据
    this.clearDanmaku();

    // 通知前端面板已停用
    this._postMessage({
      type: 'updateMode',
      mode: 'none',
      title: '',
    });

    logger.info('弹幕面板已停用');
  }

  /**
   * 设置当前视频播放进度（毫秒）
   *
   * 视频弹幕模式下，发送弹幕时需要附上当前视频播放进度（秒），
   * 此方法由外部播放进度回调更新
   *
   * @param {number} ms - 当前视频播放进度，单位毫秒
   * @returns {void}
   */
  public setVideoProgress(ms: number): void {
    this._currentVideoMs = ms;
  }

  /**
   * 更新前端登录状态
   *
   * 当登录状态发生变化时（登录成功/退出登录），通知前端更新 UI
   *
   * @param {boolean} loggedIn - 是否已登录
   * @returns {void}
   */
  public updateLoginStatus(loggedIn: boolean): void {
    this._postMessage({ type: 'updateLoginStatus', loggedIn });
  }

  // ==================== 私有方法 ====================

  /**
   * 向 Webview 前端发送消息的便捷方法
   *
   * 安全地向前端推送消息，如果 Webview 尚未初始化则静默忽略
   *
   * @param {Record<string, unknown>} message - 要发送的消息对象
   * @returns {void}
   */
  private _postMessage(message: Record<string, unknown>): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * 处理前端发送弹幕请求
   *
   * 根据当前模式（直播/视频）调用不同的 B站 API 发送弹幕：
   * - 直播模式：调用 apiService.sendLiveDanmaku(roomId, text, cookie)
   * - 视频模式：调用 apiService.sendVideoDanmaku(bvid, cid, text, currentVideoMs/1000, cookie)
   *
   * 发送成功：通知前端清空输入框（sendDanmakuSuccess）
   * 发送失败：通知前端显示错误提示（sendDanmakuError）
   *
   * @param {string} text - 弹幕文本内容
   * @returns {Promise<void>}
   */
  private async _handleSendDanmaku(text: string): Promise<void> {
    if (!text || text.trim().length === 0) {
      // 弹幕内容为空，忽略
      return;
    }

    // 获取登录态 Cookie
    const cookie = await this.sessionManager.getSession();
    if (!cookie) {
      // 未登录，通知前端显示错误提示
      this._postMessage({ type: 'sendDanmakuError', error: '请先登录后再发送弹幕' });
      return;
    }

    try {
      if (this._isLiveMode && this._currentRoomId !== null) {
        // 直播模式：调用 B站 msg/send API 发送直播弹幕
        const success = await this.apiService.sendLiveDanmaku(this._currentRoomId, text);
        if (success) {
          logger.info(`直播弹幕发送成功 [房间${this._currentRoomId}]: ${text}`);
          // 发送成功通知前端清空输入框
          this._postMessage({ type: 'sendDanmakuSuccess' });
        } else {
          // API 返回失败
          this._postMessage({ type: 'sendDanmakuError', error: '弹幕发送失败，请稍后重试' });
        }
      } else if (!this._isLiveMode && this._currentBvid !== null && this._currentCid !== null) {
        // 视频模式：调用 B站 dmpost/post API 发送视频弹幕（附带当前播放进度秒数）
        const videoTimeSeconds = Math.floor(this._currentVideoMs / 1000);
        const success = await this.apiService.sendVideoDanmaku(this._currentCid, text, videoTimeSeconds, this._currentBvid);
        if (success) {
          logger.info(`视频弹幕发送成功 [${this._currentBvid} @ ${videoTimeSeconds}s]: ${text}`);
          // 发送成功通知前端清空输入框
          this._postMessage({ type: 'sendDanmakuSuccess' });
        } else {
          // API 返回失败
          this._postMessage({ type: 'sendDanmakuError', error: '弹幕发送失败，请稍后重试' });
        }
      } else {
        // 弹幕面板未激活（没有正在观看的直播或视频）
        this._postMessage({ type: 'sendDanmakuError', error: '当前没有活跃的弹幕频道' });
      }
    } catch (error) {
      // 弹幕发送失败，通知前端显示错误提示
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`发送弹幕失败: ${errorMessage}`);
      this._postMessage({ type: 'sendDanmakuError', error: `发送失败: ${errorMessage}` });
    }
  }
}