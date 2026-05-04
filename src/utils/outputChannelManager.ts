/**
 * @file src/utils/outputChannelManager.ts
 * @description VSCode 输出通道管理器
 *
 * 主要功能：
 * - 创建和管理 VSCode 输出面板中的专用输出通道
 * - 为弹幕和其他插件日志提供统一的输出接口
 * - 支持追加行、显示通道、清空内容等操作
 * - 提供通用日志通道（bilibili），替代所有 console.log/warn/error
 *
 * 在项目中的角色：
 * 为插件提供结构化日志和弹幕展示的输出能力，
 * 所有需要展示在输出面板中的内容都通过此类统一管理
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建输出通道管理器，实现弹幕输出通道的创建和管理
 * @modification 2026-04-30 zls3434 添加通用日志通道，将所有 console 日志统一输出到 bilibili 通道
 */

import * as vscode from 'vscode';

/**
 * 输出通道管理类
 *
 * 封装 VSCode OutputChannel API，提供简便的输出操作接口。
 * 采用单例模式，确保输出通道全局唯一。
 *
 * 输出通道：
 * - 「bilibili」：通用日志通道（info/warn/error）
 * - 「bilidm」：弹幕专用通道
 */
export class OutputChannelManager {
  /** 单例实例 */
  private static instance: OutputChannelManager;

  /** 通用日志输出通道 */
  private logChannel: vscode.OutputChannel;

  /** 弹幕专用输出通道 */
  private danmakuChannel: vscode.OutputChannel;

  /**
   * 私有构造函数，防止外部通过 new 创建
   *
   * 初始化时创建两个输出通道：
   * - 「bilibili」：通用日志通道
   * - 「bilidm」：弹幕专用通道
   */
  private constructor() {
    this.logChannel = vscode.window.createOutputChannel('bilibili');
    this.danmakuChannel = vscode.window.createOutputChannel('bilidm');
  }

  /**
   * 获取 OutputChannelManager 的单例实例
   *
   * @returns {OutputChannelManager} 全局唯一的输出通道管理器实例
   */
  public static getInstance(): OutputChannelManager {
    if (!OutputChannelManager.instance) {
      OutputChannelManager.instance = new OutputChannelManager();
    }
    return OutputChannelManager.instance;
  }

  // ==================== 通用日志方法 ====================

  /**
   * 输出信息级别日志
   *
   * 同时写入「bilibili」输出通道和浏览器控制台
   *
   * @param {string} message - 日志消息
   * @returns {void}
   */
  public info(message: string): void {
    this.logChannel.appendLine(`[INFO] ${message}`);
    console.log(`[bilibili] ${message}`);
  }

  /**
   * 输出警告级别日志
   *
   * 同时写入「bilibili」输出通道和浏览器控制台
   *
   * @param {string} message - 警告消息
   * @returns {void}
   */
  public warn(message: string): void {
    this.logChannel.appendLine(`[WARN] ${message}`);
    console.warn(`[bilibili] ${message}`);
  }

  /**
   * 输出错误级别日志
   *
   * 同时写入「bilibili」输出通道和浏览器控制台
   *
   * @param {string} message - 错误消息
   * @returns {void}
   */
  public error(message: string): void {
    this.logChannel.appendLine(`[ERROR] ${message}`);
    console.error(`[bilibili] ${message}`);
  }

  /**
   * 显示通用日志输出通道
   *
   * @param {boolean} [preserveFocus=true] - 是否保持当前焦点不变
   * @returns {void}
   */
  public showLogChannel(preserveFocus: boolean = true): void {
    this.logChannel.show(preserveFocus);
  }

  // ==================== 弹幕通道方法 ====================

  /**
   * 弹幕输出通道
   * 获取弹幕输出通道实例（用于底层操作）
   *
   * @returns {vscode.OutputChannel} 弹幕输出通道实例
   */
  public getDanmakuChannel(): vscode.OutputChannel {
    return this.danmakuChannel;
  }

  /**
   * 追加一行弹幕文本到输出通道
   *
   * @param {string} text - 格式化的弹幕文本行
   * @returns {void}
   */
  public appendDanmaku(text: string): void {
    this.danmakuChannel.appendLine(text);
  }

  /**
   * 显示弹幕输出通道（可选择是否聚焦）
   *
   * @param {boolean} [preserveFocus=true] - 是否保持当前焦点不变，
   *                                         true 时仅显示通道但不切换焦点
   * @returns {void}
   */
  public showDanmakuChannel(preserveFocus: boolean = true): void {
    this.danmakuChannel.show(preserveFocus);
  }

  /**
   * 清空弹幕输出通道中的所有内容
   *
   * @returns {void}
   */
  public clearDanmakuChannel(): void {
    this.danmakuChannel.clear();
  }

  /**
   * 释放所有输出通道资源
   *
   * 扩展停用时调用，确保资源被正确释放
   *
   * @returns {void}
   */
  public dispose(): void {
    this.logChannel.dispose();
    this.danmakuChannel.dispose();
  }
}