/**
 * @file src/webview/danmakuPanelHtml.ts
 * @description 弹幕面板 Webview HTML 模板生成
 *
 * 主要功能：
 * - 生成弹幕面板的完整 HTML 文档字符串
 * - 包含弹幕列表、输入框、回到底部按钮等 UI 组件
 * - 实现弹幕自动滚动、SC/礼物/入场消息样式高亮
 * - 处理前端消息接收（弹幕追加、清空、登录状态同步等）
 * - 处理前端弹幕发送请求（回车/按钮触发）
 *
 * 在项目中的角色：
 * 为 DanmakuPanelProvider 提供 Webview 的 HTML 内容，
 * 是弹幕面板前端的完整实现（样式 + 逻辑）
 *
 * @author zls3434
 * @date 2026-05-06
 * @modification 2026-05-06 zls3434 创建弹幕面板 HTML 模板
 */

import * as vscode from 'vscode';

/**
 * 生成弹幕面板 Webview 的完整 HTML 内容
 *
 * 包含弹幕列表区域、回到底部按钮、底部输入/登录提示区域，
 * 以及所有前端交互逻辑（自动滚动、消息收发、弹幕发送等）
 *
 * @param {vscode.Webview} webview - Webview 实例，用于生成 CSP 等安全策略
 * @param {vscode.Uri} _extensionUri - 扩展根目录 URI，用于加载本地资源（预留，当前未使用）
 * @returns {string} 完整的 HTML 文档字符串
 */
export function getDanmakuPanelHtml(webview: vscode.Webview, _extensionUri: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${webview.cspSource};">
  <title>弹幕面板</title>
  <style>
    /* ========== 全局重置与基础样式 ========== */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-size: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    /* ========== 弹幕列表区域 ========== */
    #danmaku-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 8px;
      scroll-behavior: smooth;
    }
    #danmaku-list::-webkit-scrollbar { width: 4px; }
    #danmaku-list::-webkit-scrollbar-thumb {
      background-color: var(--vscode-scrollbarSlider-background);
      border-radius: 2px;
    }

    /* ========== 弹幕项样式 ========== */
    .danmaku-item {
      font-size: 12px;
      line-height: 1.6;
      padding: 1px 0;
      word-break: break-all;
    }
    .danmaku-item .danmaku-time {
      color: var(--vscode-descriptionForeground);
      margin-right: 4px;
      font-size: 10px;
    }
    .danmaku-item .danmaku-username {
      color: var(--vscode-foreground);
      font-weight: 500;
      margin-right: 4px;
    }
    /* SC 弹幕（包含 [SC] 标识）使用金色高亮 */
    .danmaku-item.sc {
      color: #FFB100;
    }
    .danmaku-item.sc .danmaku-username {
      color: #FFB100;
    }
    /* 礼物弹幕（包含 🎁）使用粉色高亮 */
    .danmaku-item.gift {
      color: #FB7299;
    }
    .danmaku-item.gift .danmaku-username {
      color: #FB7299;
    }
    /* 入场消息（包含 ➡️）使用灰色 */
    .danmaku-item.entry {
      color: var(--vscode-descriptionForeground);
    }
    .danmaku-item.entry .danmaku-username {
      color: var(--vscode-descriptionForeground);
    }
    /* 点赞消息（包含 👍）使用灰色 */
    .danmaku-item.like {
      color: var(--vscode-descriptionForeground);
    }
    .danmaku-item.like .danmaku-username {
      color: var(--vscode-descriptionForeground);
    }

    /* ========== 回到底部按钮 ========== */
    #scroll-bottom-btn {
      position: fixed;
      right: 16px;
      bottom: 48px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      z-index: 10;
      transition: opacity 0.2s ease;
    }
    #scroll-bottom-btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    #scroll-bottom-btn.visible {
      display: flex;
    }

    /* ========== 入场提示栏 ========== */
    #interact-bar {
      display: none;
      padding: 4px 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
      background-color: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-sideBar-border));
      flex-shrink: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    #interact-bar .interact-icon {
      margin-right: 4px;
    }
    /* 入场提示栏滑入动画：0.1s 快速闪烁，新消息可立即打断 */
    #interact-bar.visible {
      display: block;
      animation: interactFlash 0.1s ease;
    }
    @keyframes interactFlash {
      from { opacity: 0.3; }
      to { opacity: 1; }
    }

    /* ========== 底部输入区域 ========== */
    .input-area {
      display: flex;
      align-items: center;
      padding: 6px 8px;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-sideBar-border));
      background-color: var(--vscode-panel-background, var(--vscode-sideBar-background));
      flex-shrink: 0;
      gap: 6px;
    }
    /* 模式状态标签：显示在输入框左侧，直播粉色/视频蓝色/等待灰色 */
    #mode-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #mode-label .mode-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    #mode-label .mode-dot.live { background-color: #FB7299; }
    #mode-label .mode-dot.video { background-color: #00aeec; }
    #danmaku-input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, var(--vscode-sideBar-border)));
      border-radius: 3px;
      background-color: var(--vscode-input-background, var(--vscode-editor-background));
      color: var(--vscode-input-foreground, var(--vscode-foreground));
      font-size: 12px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif);
      outline: none;
    }
    #danmaku-input:focus {
      border-color: var(--vscode-focusBorder, #FB7299);
    }
    #danmaku-input::placeholder {
      color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    }
    #send-btn {
      padding: 4px 12px;
      border: none;
      border-radius: 3px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif);
      white-space: nowrap;
      flex-shrink: 0;
      transition: background-color 0.15s;
    }
    #send-btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    #send-btn:active {
      opacity: 0.8;
    }

    /* ========== 未登录提示 ========== */
    #login-tip {
      display: none;
      padding: 8px 12px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-sideBar-border));
      background-color: var(--vscode-panel-background, var(--vscode-sideBar-background));
      flex-shrink: 0;
      font-size: 12px;
    }

    /* ========== 错误提示（使用 VSCode notification 样式） ========== */
    .error-toast {
      position: fixed;
      top: 8px;
      left: 8px;
      right: 8px;
      padding: 8px 12px;
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: 4px;
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
      font-size: 12px;
      z-index: 100;
      animation: slideDown 0.2s ease;
    }
    @keyframes slideDown {
      from { transform: translateY(-10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <!-- 弹幕列表区域：自动滚动，每条弹幕一个 div -->
  <div id="danmaku-list"></div>

  <!-- 回到底部按钮：仅当用户向上浏览时显示 -->
  <button id="scroll-bottom-btn" title="回到底部">▼</button>

  <!-- 入场提示栏：显示最新的入场/关注/分享消息，不进入弹幕列表 -->
  <div id="interact-bar"></div>

  <!-- 底部输入区域：模式标签 + 输入框 + 发送按钮，未登录时显示登录提示 -->
  <div class="input-area" id="input-area">
    <span id="mode-label"><span class="mode-dot" id="mode-dot"></span><span id="mode-title">等待连接...</span></span>
    <input type="text" id="danmaku-input" placeholder="发送弹幕..." maxlength="100" />
    <button id="send-btn">发送</button>
  </div>

  <!-- 未登录提示：未登录时替代输入区域 -->
  <div id="login-tip">请先登录</div>

  <script>
    /**
     * @file 弹幕面板前端交互脚本
     * @description 处理弹幕列表渲染、自动滚动、弹幕发送、消息收发等前端交互
     * @author zls3434
     * @date 2026-05-06
     */

    /** 获取 VSCode Webview API 实例，用于与扩展主进程通信 */
    const vscodeApi = acquireVsCodeApi();

    /** 是否已登录（默认未登录，等待后端同步） */
    let loggedIn = false;

    /** 是否为直播模式（true=直播, false=视频） */
    let isLiveMode = false;

    /** 是否在底部附近（用于自动滚动判断） */
    let isNearBottomFlag = true;

    /** 当前错误提示定时器引用 */
    let errorToastTimer = null;

    // ==================== DOM 元素引用 ====================

    const danmakuList = document.getElementById('danmaku-list');
    const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
    const danmakuInput = document.getElementById('danmaku-input');
    const sendBtn = document.getElementById('send-btn');
    const inputArea = document.getElementById('input-area');
    const loginTip = document.getElementById('login-tip');
    const modeDot = document.getElementById('mode-dot');
    const modeTitle = document.getElementById('mode-title');
    const interactBar = document.getElementById('interact-bar');

    // ==================== 自动滚动逻辑 ====================

    /**
     * 判断滚动位置是否在底部附近
     *
     * 当用户滚动到距底部 100px 以内时，认为在底部附近，
     * 新弹幕到达时将自动滚动到底部
     *
     * @returns {boolean} 是否在底部附近
     */
    function isNearBottom() {
      if (!danmakuList) { return true; }
      return danmakuList.scrollHeight - danmakuList.scrollTop - danmakuList.clientHeight <= 100;
    }

    /**
     * 滚动弹幕列表到底部
     *
     * @returns {void}
     */
    function scrollToBottom() {
      if (!danmakuList) { return; }
      danmakuList.scrollTop = danmakuList.scrollHeight;
    }

    /**
     * 检测滚动事件，更新回到底部按钮的显示状态
     *
     * 当用户向上滚动浏览历史弹幕时，显示回到底部按钮；
     * 当用户滚动回底部时，隐藏按钮
     *
     * @returns {void}
     */
    danmakuList.addEventListener('scroll', () => {
      isNearBottomFlag = isNearBottom();
      if (isNearBottomFlag) {
        scrollBottomBtn.classList.remove('visible');
      } else {
        scrollBottomBtn.classList.add('visible');
      }
    });

    /**
     * 点击回到底部按钮，滚动到底部并隐藏按钮
     *
     * @returns {void}
     */
    scrollBottomBtn.addEventListener('click', () => {
      scrollToBottom();
      scrollBottomBtn.classList.remove('visible');
      isNearBottomFlag = true;
    });

    // ==================== 弹幕发送逻辑 ====================

    /**
     * 发送弹幕到后端
     *
     * 检查输入框内容不为空时，通过 vscodeApi 发送弹幕请求，
     * 发送后不清空输入框（等后端确认成功后再清空）
     *
     * @returns {void}
     */
    function sendDanmaku() {
      const text = danmakuInput.value.trim();
      if (!text) { return; }
      // 发送弹幕请求到后端，等待确认后再清空输入框
      vscodeApi.postMessage({ type: 'sendDanmaku', text });
    }

    /**
     * 输入框回车事件：触发弹幕发送
     */
    danmakuInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendDanmaku();
      }
    });

    /**
     * 发送按钮点击事件：触发弹幕发送
     */
    sendBtn.addEventListener('click', () => {
      sendDanmaku();
    });

    // ==================== 弹幕渲染逻辑 ====================

    /**
     * 判断弹幕文本应使用的 CSS 类名
     *
     * 特殊弹幕类型：
     * - SC 弹幕：文本包含 [SC]，使用金色高亮
     * - 礼物弹幕：文本包含 🎁，使用粉色高亮
     * - 入场消息：文本包含 ➡️，使用灰色
     * - 点赞消息：文本包含 👍，使用灰色
     *
     * @param {string} text - 弹幕文本内容
     * @returns {string} CSS 类名字符串（逗号分隔）
     */
    function getDanmakuClass(text) {
      // SC 弹幕格式为 [SC ¥30] 消息内容，匹配 "[SC " 而非 "[SC]"（因为价格在中间）
      if (text.indexOf('[SC ') !== -1 || text.indexOf('[SC]') !== -1) { return 'danmaku-item sc'; }
      if (text.indexOf('🎁') !== -1) { return 'danmaku-item gift'; }
      if (text.indexOf('➡️') !== -1) { return 'danmaku-item entry'; }
      if (text.indexOf('👍') !== -1) { return 'danmaku-item like'; }
      return 'danmaku-item';
    }

    /**
     * 格式化弹幕文本中的用户名部分
     *
     * 如果弹幕是直播弹幕且有用户名，显示为 "<用户名>" 格式
     * 视频弹幕无用户名，只显示弹幕内容
     *
     * @param {string} username - 用户名
     * @param {string} text - 弹幕文本
     * @param {boolean} isLive - 是否为直播弹幕
     * @returns {string} 格式化后的弹幕 HTML 字符串
     */
    function formatDanmakuHtml(username, text, isLive) {
      // 防止 XSS 攻击的 HTML 转义
      const escapedText = escapeHtml(text);
      const escapedUsername = escapeHtml(username);

      if (isLive && username) {
        // 直播弹幕：显示时间 + 用户名 + 内容
        return escapedUsername + ' ' + escapedText;
      }
      // 视频弹幕：只显示内容
      return escapedText;
    }

    /**
     * 追加一条弹幕到列表
     *
     * 根据弹幕类型自动添加样式类名，
     * 在底部附近时自动滚动到底部
     *
     * @param {Object} data - 弹幕数据
     * @param {string} data.username - 发送者用户名
     * @param {string} data.text - 弹幕文本内容
     * @param {string} data.timeStr - 格式化的时间字符串（HH:mm:ss）
     * @param {boolean} data.isLive - 是否为直播弹幕
     * @returns {void}
     */
    function appendDanmakuItem(data) {
      const itemClass = getDanmakuClass(data.text);
      const contentHtml = formatDanmakuHtml(data.username, data.text, data.isLive);

      const div = document.createElement('div');
      div.className = itemClass;

      // 添加时间戳前缀（直播弹幕显示 HH:mm:ss，视频弹幕显示 mm:ss）
      if (data.timeStr) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'danmaku-time';
        timeSpan.textContent = '[' + data.timeStr + '] ';
        div.appendChild(timeSpan);
      }

      // 直播弹幕带用户名时，单独高亮用户名
      if (data.isLive && data.username) {
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'danmaku-username';
        usernameSpan.textContent = '<' + data.username + '> ';
        div.appendChild(usernameSpan);

        const textSpan = document.createElement('span');
        textSpan.textContent = data.text;
        div.appendChild(textSpan);
      } else {
        // 视频弹幕或无用户名的直播弹幕：直接追加内容
        div.innerHTML += contentHtml;
      }

      danmakuList.appendChild(div);

      // 如果用户在底部附近，自动滚动到新弹幕
      if (isNearBottomFlag) {
        scrollToBottom();
      }
    }

    // ==================== 消息接收处理 ====================

    /**
     * 监听来自扩展主进程的消息
     *
     * 支持的消息类型：
     * - appendDanmaku: 追加一条弹幕到列表
     * - clearDanmaku: 清空弹幕列表
     * - updateLoginStatus: 更新登录状态
     * - updateMode: 更新弹幕面板模式（live/video/none）
     * - sendDanmakuSuccess: 弹幕发送成功，清空输入框
     * - sendDanmakuError: 弹幕发送失败，显示错误提示
     */
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        // 追加弹幕到列表
        case 'appendDanmaku':
          appendDanmakuItem(msg);
          break;

        // 清空弹幕列表
        case 'clearDanmaku':
          danmakuList.innerHTML = '';
          isNearBottomFlag = true;
          scrollBottomBtn.classList.remove('visible');
          interactBar.classList.remove('visible');
          interactBar.textContent = '';
          break;

        // 交互消息（入场/关注/分享/点赞）：更新底部入场提示栏
        case 'interactMessage':
          if (msg.username) {
            // 立即取消当前动画，直接更新文字
            interactBar.style.animation = 'none';
            void interactBar.offsetHeight;
            interactBar.textContent = msg.text || (msg.username + ' 进入直播间');
            interactBar.classList.add('visible');
            // 重新触发快速闪烁动画
            interactBar.style.animation = '';
          }
          break;

        // 更新登录状态
        case 'updateLoginStatus':
          loggedIn = msg.loggedIn === true;
          updateLoginUI();
          break;

        // 更新弹幕面板模式
        case 'updateMode':
          updateModeUI(msg.mode, msg.title);
          break;

        // 弹幕发送成功：清空输入框
        case 'sendDanmakuSuccess':
          danmakuInput.value = '';
          danmakuInput.focus();
          break;

        // 弹幕发送失败：显示错误提示
        case 'sendDanmakuError':
          showErrorToast(msg.error || '发送失败');
          break;
      }
    });

    // ==================== UI 更新方法 ====================

    /**
     * 更新登录状态 UI
     *
     * 已登录时显示输入框和发送按钮，未登录时显示登录提示
     *
     * @returns {void}
     */
    function updateLoginUI() {
      if (loggedIn) {
        inputArea.style.display = 'flex';
        loginTip.style.display = 'none';
      } else {
        inputArea.style.display = 'none';
        loginTip.style.display = 'block';
      }
    }

    /**
     * 更新弹幕面板模式 UI
     *
     * 根据模式设置底栏左侧标签的圆点颜色和文字提示：
     * - live: 粉色圆点 + 直播间号
     * - video: 蓝色圆点 + BV 号
     * - none: 灰色圆点 + 等待连接
     *
     * @param {string} mode - 模式标识（live/video/none）
     * @param {string} title - 标题文字
     * @returns {void}
     */
    function updateModeUI(mode, title) {
      modeDot.className = 'mode-dot';
      if (mode === 'live') {
        isLiveMode = true;
        modeDot.classList.add('live');
        modeTitle.textContent = title || '直播弹幕';
      } else if (mode === 'video') {
        isLiveMode = false;
        modeDot.classList.add('video');
        modeTitle.textContent = title || '视频弹幕';
      } else {
        // none 模式：面板未激活
        isLiveMode = false;
        modeTitle.textContent = '等待连接...';
      }
    }

    /**
     * 显示错误提示（使用 VSCode notification 样式）
     *
     * 在面板顶部显示错误消息，3秒后自动消失
     *
     * @param {string} message - 错误消息文本
     * @returns {void}
     */
    function showErrorToast(message) {
      // 清除之前的错误提示定时器
      if (errorToastTimer) {
        clearTimeout(errorToastTimer);
      }

      // 移除已存在的错误提示元素
      const existingToast = document.querySelector('.error-toast');
      if (existingToast) {
        existingToast.remove();
      }

      // 创建新的错误提示元素
      const toast = document.createElement('div');
      toast.className = 'error-toast';
      toast.textContent = message;
      document.body.appendChild(toast);

      // 3秒后自动移除
      errorToastTimer = setTimeout(() => {
        toast.remove();
        errorToastTimer = null;
      }, 3000);
    }

    // ==================== 通用工具函数 ====================

    /**
     * 防止 XSS 攻击的 HTML 转义
     *
     * @param {string} str - 需要转义的字符串
     * @returns {string} 转义后的安全字符串
     */
    function escapeHtml(str) {
      if (!str) { return ''; }
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ==================== 初始化 ====================

    /** 初始化：设置默认的登录状态 UI */
    updateLoginUI();
  </script>
</body>
</html>`;
}