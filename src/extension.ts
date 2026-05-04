/**
 * @file src/extension.ts
 * @description VSCode 扩展主入口文件
 *
 * 主要功能：
 * - 注册扩展激活和停用生命周期
 * - 注册侧边栏视图提供者（BiliMainViewProvider）
 * - 注册所有扩展命令（登录、打开视频、打开直播、返回）
 * - 管理扩展全局状态
 * - 初始化全局日志管理器
 *
 * 在项目中的角色：
 * 该文件是整个 VSCode 扩展的启动入口，负责将所有模块串联起来
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 初始化全局日志管理器，替代独立的输出通道
 */

import * as vscode from 'vscode';
import { BiliMainViewProvider } from './webview/BiliMainViewProvider';
import { ProxyServer } from './services/proxyServer';
import { OutputChannelManager } from './utils/outputChannelManager';
import { logger } from './utils/logger';

/** 代理服务器实例，在扩展激活时启动，停用时关闭 */
let proxyServer: ProxyServer | null = null;

/**
 * 扩展激活函数（异步）
 *
 * 初始化流程：
 * 1. 初始化全局日志管理器
 * 2. 启动本地代理服务器（用于绕过 B站 CDN 防盗链）
 * 3. 创建 BiliMainViewProvider 实例并注册到侧边栏
 * 4. 注册所有用户可触发的命令
 *
 * @param {vscode.ExtensionContext} context - VSCode 扩展上下文
 * @returns {Promise<void>}
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    // 初始化全局日志管理器
    const outputChannelManager = OutputChannelManager.getInstance();
    logger.init(outputChannelManager);
    context.subscriptions.push(outputChannelManager);

    logger.info('bilibili 扩展开始激活...');

    // 步骤0：启动本地代理服务器（用于绕过 B站 CDN 403 防盗链）
    proxyServer = new ProxyServer();
    await proxyServer.start();
    const proxyBaseUrl = proxyServer.getBaseUrl();
    logger.info(`代理服务器已启动: ${proxyBaseUrl}`);

    // 步骤1：创建主视图提供者实例，传入代理 URL
    const provider = new BiliMainViewProvider(context.extensionUri, context, proxyBaseUrl);

    // 步骤2：注册侧边栏 Webview 视图提供者
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        'bilibili-main-view',
        provider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        }
      )
    );

    // 步骤3：注册登录命令
    context.subscriptions.push(
      vscode.commands.registerCommand('bilibili.login', () => {
        provider.initiateLogin();
      })
    );

    // 步骤4：注册打开视频命令
    context.subscriptions.push(
      vscode.commands.registerCommand('bilibili.openVideo', (bvid?: string) => {
        if (bvid) {
          provider.openVideo(bvid);
        } else {
          vscode.window.showInputBox({
            placeHolder: '请输入视频 BV 号',
            prompt: '输入 B站视频的 BV 号来播放',
          }).then((inputBvid) => {
            if (inputBvid) {
              provider.openVideo(inputBvid.trim());
            }
          });
        }
      })
    );

    // 步骤5：注册打开直播命令
    context.subscriptions.push(
      vscode.commands.registerCommand('bilibili.openLive', (roomId?: number) => {
        if (roomId) {
          provider.openLive(roomId);
        } else {
          vscode.window.showInputBox({
            placeHolder: '请输入直播间房间号',
            prompt: '输入 B站直播间的房间号来观看直播',
            validateInput: (value) => {
              const num = parseInt(value, 10);
              if (isNaN(num) || num <= 0) {
                return '请输入有效的直播间房间号（正整数）';
              }
              return undefined;
            },
          }).then((inputRoomId) => {
            if (inputRoomId) {
              provider.openLive(parseInt(inputRoomId.trim(), 10));
            }
          });
        }
      })
    );

    // 步骤6：注册返回上一页命令
    context.subscriptions.push(
      vscode.commands.registerCommand('bilibili.goBack', () => {
        provider.goBack();
      })
    );

    logger.info('bilibili 扩展激活完成');
  } catch (error) {
    logger.error(`bilibili 扩展激活失败: ${error}`);
    vscode.window.showErrorMessage(`bilibili 扩展激活失败: ${error}`);
  }
}

/**
 * 扩展停用函数
 *
 * 当扩展被禁用或 VSCode 关闭时调用，用于执行清理工作。
 *
 * @returns {Promise<void>}
 */
export function deactivate(): Promise<void> {
  if (proxyServer) {
    return proxyServer.stop();
  }
  return Promise.resolve();
}