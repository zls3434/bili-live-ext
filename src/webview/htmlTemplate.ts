/**
 * @file src/webview/htmlTemplate.ts
 * @description Webview HTML 模板生成
 *
 * 负责生成侧边栏 Webview 面板的完整 HTML 内容，包含：
 * - B站粉色主题样式（#FB7299），搭配 VSCode CSS 变量实现主题适配
 * - 顶部导航栏（标题 + 返回按钮 + 登录/用户按钮）
 * - Tab 切换按钮（关注/收藏/推荐/直播）
 * - 内容区域（列表视图 / 播放器视图 / 登录 QR 码视图）
 * - 内嵌前端 JavaScript 脚本（Tab 切换、列表渲染、消息通信）
 *
 * @author zls3434
 * @date 2026-05-04
 */

import * as vscode from 'vscode';

/**
 * 生成 Webview 的完整 HTML 内容
 *
 * @param {vscode.Webview} webview - Webview 实例，用于生成 URI
 * @param {vscode.Uri} extensionUri - 扩展根目录 URI
 * @returns {string} 完整的 HTML 文档字符串
 */
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {    // 构建本地资源 URI（flv.js 播放库）
    const flvJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'flv.min.js'));

    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' ${webview.cspSource}; img-src https: data:; media-src https: http://127.0.0.1:* blob:; connect-src https: wss: http://127.0.0.1:*;">
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
        .refresh-btn {
          background: none;
          border: none;
          color: var(--vscode-sideBar-foreground);
          cursor: pointer;
          padding: 2px 6px;
          font-size: 13px;
          border-radius: 4px;
          line-height: 1;
          opacity: 0.7;
          flex-shrink: 0;
          transition: transform 0.3s ease, opacity 0.15s;
        }
        .refresh-btn:hover { opacity: 1; background-color: var(--vscode-toolbar-hoverBackground); }
        .refresh-btn.spinning { transform: rotate(360deg); }
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
          justify-content: space-between;
          align-items: center;
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
        /* 关注子Tab样式 - 修改日期：2026-05-02 zls3434 新增关注子Tab样式 */
        .follow-sub-tabs {
          display: flex;
          padding: 4px 8px;
          gap: 2px;
          border-bottom: 1px solid var(--vscode-sideBar-border);
        }
        .follow-sub-tab {
          padding: 3px 10px;
          border: none;
          border-radius: 3px;
          background: none;
          color: var(--vscode-foreground);
          cursor: pointer;
          font-size: 11px;
          opacity: 0.7;
          transition: opacity 0.15s, background-color 0.15s, color 0.15s;
        }
        .follow-sub-tab:hover { opacity: 0.9; background-color: var(--vscode-toolbar-hoverBackground); }
        .follow-sub-tab.active {
          opacity: 1;
          color: #FB7299;
          font-weight: 600;
          background-color: rgba(251, 114, 153, 0.1);
        }
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
      <!-- flv.js 直播播放库（通过 MSE 在浏览器中播放 FLV 流） -->
      <script src="${flvJsUri}"></script>
      <div class="container">
        <!-- Tab 切换按钮组 + 设置按钮 -->
        <div class="tab-bar" id="tab-bar">
          <button class="tab-btn active" data-view="recommendedVideos">推荐</button>
          <button class="tab-btn" data-view="recommendedLives">直播</button>
          <button class="tab-btn" data-view="followsVideos">关注</button>
          <button class="tab-btn" data-view="favorites">收藏</button>
          <span class="tab-spacer"></span>
          <button class="refresh-btn" id="btn-refresh" title="刷新">↻</button>
          <button class="settings-btn" id="btn-settings" title="设置">⚙</button>
        </div>

        <!-- 设置菜单（下拉） -->
        <div class="settings-menu" id="settings-menu">
          <button class="settings-menu-item" id="menu-login">登录</button>
          <button class="settings-menu-item hidden" id="menu-logout">退出登录</button>
          <button class="settings-menu-item" id="menu-clear-cache">清理缓存</button>
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

        // 尝试从持久化状态恢复（Webview 被重建时，前端需要从 getState 恢复 UI）
        const savedState = vscodeApi.getState() || {};
        let currentView = savedState.currentView || 'recommendedVideos';
        let isPlayerMode = savedState.isPlayerMode || false;
        let playerMediaType = savedState.playerMediaType || '';
        const viewCache = savedState.viewCache || {};
        let savedListHtml = savedState.savedListHtml || '';
        let hasMoreData = true;

        /** 保存关键状态到 VSCode 持久化存储 */
        function saveState() {
          vscodeApi.setState({
            currentView,
            isPlayerMode,
            playerMediaType,
            viewCache,
            savedListHtml,
          });
        }

        /** 是否正在加载更多数据（防止重复请求） */
        let isLoadingMore = false;

        // ==================== DOM 元素引用 ====================

        const contentEl = document.getElementById('content');
        const tabBar = document.getElementById('tab-bar');
        const btnSettings = document.getElementById('btn-settings');
        const settingsMenu = document.getElementById('settings-menu');
        const menuLogin = document.getElementById('menu-login');
        const menuLogout = document.getElementById('menu-logout');
        const btnRefresh = document.getElementById('btn-refresh');

        // ==================== 恢复持久化状态（Webview 被重建时需要从缓存恢复 UI） ====================

        // 如果有持久化状态，恢复 UI 而非从头开始
        if (savedState.currentView && Object.keys(savedState).length > 0) {
          currentView = savedState.currentView;
          isPlayerMode = savedState.isPlayerMode || false;
          playerMediaType = savedState.playerMediaType || '';

          // 高亮正确的 Tab
          highlightTab(currentView);

          if (isPlayerMode) {
            // 之前处于播放器模式：由于视频源 URL 无法持久化，无法恢复播放器
            // 回退到列表模式，从缓存中恢复进入播放器前的列表内容
            isPlayerMode = false;
            tabBar.style.display = 'flex';
            if (savedState.savedListHtml) {
              // 恢复进入播放器前的列表内容
              contentEl.innerHTML = savedState.savedListHtml;
              viewCache[currentView] = savedState.savedListHtml;
            } else if (viewCache[currentView]) {
              contentEl.innerHTML = viewCache[currentView];
            }
          } else {
            // 处于列表模式：从缓存恢复列表内容
            tabBar.style.display = 'flex';
            if (viewCache[currentView]) {
              contentEl.innerHTML = viewCache[currentView];
            }
          }
          // 保存恢复后的状态
          saveState();
        }

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

        // ==================== 刷新按钮事件 ====================

        /** 刷新当前列表 */
        btnRefresh.addEventListener('click', () => {
          btnRefresh.classList.add('spinning');
          setTimeout(() => { btnRefresh.classList.remove('spinning'); }, 300);
          vscodeApi.postMessage({ type: 'refresh', view: currentView });
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

        /** 清理缓存按钮（设置菜单内） */
        const menuClearCache = document.getElementById('menu-clear-cache');
        menuClearCache.addEventListener('click', () => {
          // 清空前端缓存
          Object.keys(viewCache).forEach(key => { viewCache[key] = ''; });
          savedListHtml = '';
          vscodeApi.setState({});
          // 重置视图状态
          contentEl.innerHTML = '<div class="status-area"><div class="icon">✅</div><div class="msg">缓存已清理，刷新中...</div></div>';
          settingsMenu.classList.remove('show');
          // 重新加载当前视图
          setTimeout(() => {
            vscodeApi.postMessage({ type: 'refresh', view: currentView });
          }, 500);
        });

        // ==================== Tab 切换事件 ====================

        tabBar.addEventListener('click', (e) => {
          const target = e.target;
          if (target.classList.contains('tab-btn')) {
            const view = target.dataset.view;
            if (view && view !== currentView && !isPlayerMode) {
              // 保存当前视图内容到缓存
              viewCache[currentView] = contentEl.innerHTML;

              // 更新 Tab 激活状态
              tabBar.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
              target.classList.add('active');
              currentView = view;

              // 如果目标视图有缓存则直接恢复，否则显示加载中
              if (viewCache[view]) {
                contentEl.innerHTML = viewCache[view];
              } else {
                showLoading();
              }

              // 通知扩展主进程切换视图
              vscodeApi.postMessage({ type: 'switchView', view });
            }
          }
        });

        // ==================== 关注子Tab切换事件 ====================

        /**
         * 关注子Tab点击事件处理
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：新增关注子Tab的点击切换逻辑，点击后在"关注列表/动态/直播中"之间切换
         *
         * 使用事件委托监听 follow-sub-tab 按钮的点击事件
         */
        contentEl.addEventListener('click', (e) => {
          const target = e.target;
          if (target.classList.contains('follow-sub-tab')) {
            const subView = target.dataset.subView;
            if (subView && !isPlayerMode) {
              // 保存当前关注视图内容到缓存
              viewCache[currentView] = contentEl.innerHTML;

              // 更新当前视图到子视图
              currentView = subView;

              // 如果目标子视图有缓存则直接恢复，否则显示加载中并请求数据
              if (viewCache[subView]) {
                contentEl.innerHTML = viewCache[subView];
              } else {
                showLoading();
                vscodeApi.postMessage({ type: 'switchView', view: subView });
              }
            }
          }
        });

        // ==================== 消息接收处理 ====================

        window.addEventListener('message', (event) => {
          const msg = event.data;
          switch (msg.type) {

            // 切换到指定视图的列表（由后端或恢复状态时触发）
            case 'navigateTo':
            case 'showList':
              exitPlayerMode();
              highlightTab(msg.view);
              currentView = msg.view;
              saveState();

              // 如果消息携带了列表数据，直接渲染并更新缓存
              if (msg.view && msg.data) {
                renderListByView(msg.view, msg.data);
                viewCache[msg.view] = contentEl.innerHTML;
              } else if (msg.view && viewCache[msg.view]) {
                // 没有新数据但缓存中有内容，恢复缓存
                contentEl.innerHTML = viewCache[msg.view];
              }
              break;

            // 接收并渲染列表数据
            case 'updateListData':
              if (msg.view === currentView && !isPlayerMode) {
                renderListByView(msg.view, msg.data, msg.error);
                hasMoreData = msg.hasMore !== false;
                viewCache[msg.view] = contentEl.innerHTML;
                saveState();
              }
              break;

            // 追加更多列表数据（懒加载）
            case 'appendListData':
              if (msg.view === currentView && !isPlayerMode) {
                appendListData(msg.view, msg.data);
                hasMoreData = msg.hasMore !== false;
                isLoadingMore = false;
                viewCache[msg.view] = contentEl.innerHTML;
                saveState();
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

            // 更新登录状态（仅更新按钮可见性，不切换视图）
            case 'updateLoginStatus':
              updateLoginUI(msg);
              break;

            // 登录成功：导航到推荐视频并重新加载数据
            case 'loginSuccess':
              currentView = 'recommendedVideos';
              highlightTab('recommendedVideos');
              vscodeApi.postMessage({ type: 'switchView', view: 'recommendedVideos' });
              saveState();
              break;
          }
        });

        // ==================== 视图渲染 ====================

        /**
         * 根据视图类型渲染内容列表
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：新增 followsVideos 和 followsLive 视图的渲染分支
         *
         * @param {string} view - 视图类型
         * @param {Array} data - 数据数组
         * @param {string} errorMsg - 可选的错误信息
         */
        function renderListByView(view, data, errorMsg) {
          if (errorMsg) {
            // 关注子视图的错误消息需要带子Tab栏
            if (view === 'followsVideos' || view === 'followsLive') {
              let html = buildFollowSubTabs(view);
              html += '<div class="status-area"><div class="icon">😕</div><div class="msg">' + escapeHtml(errorMsg) + '</div></div>';
              contentEl.innerHTML = html;
              return;
            }
            contentEl.innerHTML = '<div class="status-area"><div class="icon">😕</div><div class="msg">' + escapeHtml(errorMsg) + '</div></div>';
            return;
          }
          if (!data || data.length === 0) {
            // 关注子视图的空数据需要带子Tab栏
            if (view === 'followsVideos' || view === 'followsLive') {
              let html = buildFollowSubTabs(view);
              html += '<div class="status-area"><div class="icon">📭</div><div class="msg">暂无内容</div></div>';
              contentEl.innerHTML = html;
              return;
            }
            contentEl.innerHTML = '<div class="status-area"><div class="icon">📭</div><div class="msg">暂无内容</div></div>';
            return;
          }

          switch (view) {
            case 'follows':
              renderFollowingList(data);
              break;
            case 'followsVideos':
              renderFollowsVideos(data);
              break;
            case 'followsLive':
              renderFollowsLive(data);
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
            const timeStr = formatPubTime(v.pubdate);
            html += '<div class="card" data-bvid="' + escapeHtml(v.bvid) + '" onclick="clickVideo(this)">';
            html += '<img class="card-cover" src="' + ensureHttps(escapeHtml(v.cover)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src=&#39;data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%2256%22><rect fill=%22%23eee%22 width=%2290%22 height=%2256%22/></svg>&#39;" />';
            html += '<div class="card-info">';
            html += '<div class="card-title">' + escapeHtml(v.title) + '</div>';
            html += '<div class="card-meta">';
            html += '<span>' + (v.author ? escapeHtml(v.author) : '') + '</span>';
            html += '<span>▶︎ ' + durationStr + '</span>';
            html += '</div>';
            html += '<div class="card-meta">';
            html += '<span>' + playStr + '播放</span>';
            html += '<span>⌚︎ ' + (timeStr || '') + '</span>';
            html += '</div>';
            html += '</div></div>';
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
            html += '<img class="card-cover" src="' + ensureHttps(escapeHtml(l.cover)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src=&#39;data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%2256%22><rect fill=%22%23eee%22 width=%2290%22 height=%2256%22/></svg>&#39;" />';
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
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：在关注列表下方添加子Tab（动态/直播中），支持子视图切换
         */
        /**
         * 构建关注子Tab栏 HTML
         *
         * @param {string} activeView - 当前激活的子视图名称
         * @returns {string} 子Tab栏 HTML
         */
        function buildFollowSubTabs(activeView) {
          let html = '<div class="follow-sub-tabs">';
          html += '<button class="follow-sub-tab' + (activeView === 'followsVideos' ? ' active' : '') + '" data-sub-view="followsVideos">动态</button>';
          html += '<button class="follow-sub-tab' + (activeView === 'followsLive' ? ' active' : '') + '" data-sub-view="followsLive">直播中</button>';
          html += '<button class="follow-sub-tab' + (activeView === 'follows' ? ' active' : '') + '" data-sub-view="follows">关注列表</button>';
          html += '</div>';
          return html;
        }

        function renderFollowingList(followItems) {
          let html = buildFollowSubTabs('follows');
          html += '<div class="card-list">' + buildFollowCards(followItems);
          if (hasMoreData) { html += '<div id="load-more-indicator" class="status-area" style="display:none"><div class="loading-spinner"></div><span class="msg">加载更多...</span></div>'; }
          html += '</div>';
          contentEl.innerHTML = html;
        }

        /**
         * 渲染"关注动态"子Tab（关注UP主的最新视频投稿列表）
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：新增关注动态渲染函数，复用视频卡片样式
         */
        function renderFollowsVideos(videos) {
          let html = buildFollowSubTabs('followsVideos');
          html += '<div class="card-list">' + buildVideoCards(videos);
          if (hasMoreData) { html += '<div id="load-more-indicator" class="status-area" style="display:none"><div class="loading-spinner"></div><span class="msg">加载更多...</span></div>'; }
          html += '</div>';
          contentEl.innerHTML = html;
        }

        /**
         * 渲染"关注直播中"子Tab（正在直播的关注UP主列表）
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：新增关注直播渲染函数，复用直播卡片样式
         */
        function renderFollowsLive(lives) {
          let html = buildFollowSubTabs('followsLive');
          html += '<div class="card-list">' + buildLiveCards(lives);
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
            html += '<img class="fav-cover" src="' + ensureHttps(escapeHtml(f.cover)) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src=&#39;data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><rect fill=%22%23eee%22 width=%2248%22 height=%2248%22/></svg>&#39;" />';
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
          saveState();

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
         * flv.js 播放器实例（直播用）
         * @type {object|null}
         */
        let flvPlayer = null;

        /**
         * 设置播放器
         *
         * 视频播放：直接设置 video.src（浏览器原生支持 MP4）
         * 直播播放：使用 flv.js 通过 MSE 播放 FLV 流（浏览器不原生支持 FLV）
         *
         * @param {Object} data - 播放器配置数据
         * @param {string} data.url - 视频流 URL（已代理）
         * @param {string} data.mediaType - 媒体类型（'video' 或 'live'）
         * @param {string} data.format - 流格式（'mp4' 或 'flv'）
         */
       // 上次推送弹幕的播放时间（毫秒），用于避免重复推送
        let lastPushedMs = -1;

        function setupPlayer(data) {
          const videoEl = document.getElementById('video-player');
          if (!videoEl) { return; }

          // 销毁之前的 flv.js 实例（如有）
          if (flvPlayer) {
            flvPlayer.destroy();
            flvPlayer = null;
          }

          // 移除旧的 timeupdate 监听器（如有）
          videoEl.removeEventListener('timeupdate', onVideoTimeUpdate);

          if (data.mediaType === 'live' && data.format === 'flv' && typeof flvjs !== 'undefined' && flvjs.isSupported()) {
            // 直播：使用 flv.js 通过 MSE 播放 FLV 流
            flvPlayer = flvjs.createPlayer({
              type: 'flv',
              url: data.url,
              isLive: true,
              hasAudio: true,
              hasVideo: true,
            }, {
              enableStashBuffer: false,
              autoCleanupSourceBuffer: true,
            });
            flvPlayer.attachMediaElement(videoEl);
            flvPlayer.load();
            flvPlayer.play();
          } else {
            // 视频：直接设置 src（MP4 格式，浏览器原生支持）
            videoEl.src = data.url;
          }

          // 视频（非直播）模式：监听 timeupdate 事件推送弹幕
          if (data.mediaType === 'video') {
            lastPushedMs = -1;
            videoEl.addEventListener('timeupdate', onVideoTimeUpdate);
          }
        }

        /**
         * 视频播放进度更新回调
         *
         * 将当前播放时间（毫秒）发送给扩展侧，
         * 扩展侧根据播放进度推送对应时间的弹幕到 bilidm 通道。
         * 使用节流机制（时间变化小于 200ms 时不推送）避免消息过多。
         */
        function onVideoTimeUpdate(event) {
          var videoEl = event.target;
          var currentMs = Math.floor(videoEl.currentTime * 1000);
          // 节流：时间变化小于 200ms 时不推送
          if (currentMs - lastPushedMs < 200 && currentMs >= lastPushedMs) { return; }
          lastPushedMs = currentMs;
          vscodeApi.postMessage({ type: 'videoProgress', currentMs: currentMs });
        }

        /**
         * 退出播放器模式，回到列表
         */
        function exitPlayerMode() {
          isPlayerMode = false;
          saveState();
          tabBar.style.display = 'flex';

          // 清理 flv.js 播放器（直播用）
          if (flvPlayer) {
            flvPlayer.destroy();
            flvPlayer = null;
          }

          // 清理 video 元素和 timeupdate 事件监听器
          const videoEl = document.getElementById('video-player');
          if (videoEl) {
            videoEl.removeEventListener('timeupdate', onVideoTimeUpdate);
            videoEl.pause();
            videoEl.src = '';
          }

          // 重置弹幕进度追踪状态
          lastPushedMs = -1;

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
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：新增 followsVideos 和 followsLive 视图的追加数据支持
         *
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
            case 'followsVideos':
            case 'favorites':
              html = buildVideoCards(data);
              break;
            case 'recommendedLives':
            case 'followsLive':
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

        /**
         * 高亮当前 Tab 按钮
         *
         * 修改日期：2026-05-02
         * 修改人：zls3434
         * 修改目的：支持子视图高亮逻辑，followsVideos 和 followsLive 视图高亮"我的关注"主Tab
         *
         * @param {string} view - 视图类型
         */
        function highlightTab(view) {
          const mainView = (view === 'followsLive' || view === 'follows') ? 'followsVideos' : view;
          tabBar.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === mainView);
          });
        }

        /**
         * 更新登录状态 UI
         *
         * 仅更新登录/退出按钮的可见性，不切换视图。
         * 首次登录成功后跳转到推荐视频由 loginSuccess 消息单独处理。
         *
         * @param {Object} msg - 消息对象
         * @param {boolean} msg.loggedIn - 是否已登录
         * @param {boolean} [msg.scanned] - 是否已扫码
         * @param {boolean} [msg.expired] - 二维码是否过期
         */
        function updateLoginUI(msg) {
          if (msg.loggedIn === true) {
            menuLogin.classList.add('hidden');
            menuLogout.classList.remove('hidden');
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
        function formatPubTime(pubdate) {
          if (!pubdate) { return ''; }
          var now = Math.floor(Date.now() / 1000);
          var diff = now - pubdate;
          if (diff < 0) { diff = 0; }
          if (diff < 3600) {
            var minutes = Math.max(1, Math.floor(diff / 60));
            return minutes + '分钟前';
          }
          var date = new Date(pubdate * 1000);
          var today = new Date();
          var isToday = date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
          if (isToday) {
            var hours = date.getHours().toString().padStart(2, '0');
            var mins = date.getMinutes().toString().padStart(2, '0');
            return hours + ':' + mins;
          }
          var y = date.getFullYear();
          var m = (date.getMonth() + 1).toString().padStart(2, '0');
          var d = date.getDate().toString().padStart(2, '0');
          var h = date.getHours().toString().padStart(2, '0');
          var mi = date.getMinutes().toString().padStart(2, '0');
          return y + '-' + m + '-' + d + ' ' + h + ':' + mi;
        }

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
