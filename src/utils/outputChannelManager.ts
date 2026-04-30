/**
 * @file src/utils/outputChannelManager.ts
 * @description VSCode 输出通道管理器
 *
 * 主要功能：
 * - 创建和管理 VSCode 输出面板中的专用输出通道
 * - 为弹幕和其他插件日志提供统一的输出接口
 * - 支持追加行、显示通道、清空内容等操作
 *
 * 在项目中的角色：
 * 为插件提供结构化日志和弹幕展示的输出能力，
 * 所有需要展示在输出面板中的内容都通过此类统一管理
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建输出通道管理器，实现弹幕输出通道的创建和管理
 */

import * as vscode from 'vscode';

/**
 * 输出通道管理类
 *
 * 封装 VSCode OutputChannel API，提供简便的输出操作接口。
 * 采用单例模式，确保「bilidm」弹幕通道全局唯一
 *
 * 使用示例：
 * ```typescript
 * const manager = OutputChannelManager.getInstance();
 * manager.showDanmakuChannel();
 * manager.appendDanmaku('[12:34] 弹幕内容');
 * ```
 */
export class OutputChannelManager {
  /** 单例实例 */
  private static instance: OutputChannelManager;

  /** 弹幕专用输出通道 */
  private danmakuChannel: vscode.OutputChannel;

  /**
   * 私有构造函数，防止外部通过 new 创建
   *
   * 初始化时创建「bilidm」输出通道，通道名称与 spec 保持一致
   */
  private constructor() {
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
   * 释放弹幕输出通道资源
   *
   * 扩展停用时调用，确保资源被正确释放
   *
   * @returns {void}
   */
  public dispose(): void {
    this.danmakuChannel.dispose();
  }
}
