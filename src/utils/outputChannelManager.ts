/**
 * @file src/utils/outputChannelManager.ts
 * @description VSCode 输出通道管理器
 *
 * 主要功能：
 * - 创建和管理 VSCode 输出面板中的通用日志输出通道
 * - 提供通用日志通道（bilibili），替代所有 console.log/warn/error
 * - 支持追加行、显示通道、清空内容等操作
 * - 日志输出格式包含毫秒级时间戳，便于精确定位事件时序
 *
 * 在项目中的角色：
 * 为插件提供结构化日志的输出能力，
 * 弹幕输出已迁移至独立的 DanmakuPanelProvider（弹幕面板），不再由此类管理
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建输出通道管理器，实现弹幕输出通道的创建和管理
 * @modification 2026-04-30 zls3434 添加通用日志通道，将所有 console 日志统一输出到 bilibili 通道
 * @modification 2026-05-06 zls3434 移除弹幕通道方法，弹幕输出已迁移至独立弹幕面板 DanmakuPanelProvider
 * @modification 2026-05-06 zls3434 优化日志输出格式，增加毫秒级时间戳，便于精确定位事件时序
 */

import * as vscode from 'vscode';

/**
 * 格式化当前时间为毫秒级时间戳字符串
 *
 * 输出格式：YYYY-MM-DD HH:mm:ss.SSS
 * 例如：2026-05-06 14:30:25.137
 *
 * @returns {string} 格式化后的时间戳字符串，精确到毫秒
 */
export function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * 输出通道管理类
 *
 * 封装 VSCode OutputChannel API，提供简便的输出操作接口。
 * 采用单例模式，确保输出通道全局唯一。
 *
 * 输出通道：
 * - 「bilibili」：通用日志通道（info/warn/error）
 *
 * 注意：弹幕专用通道（原「bilidm」）已移除，
 * 弹幕输出已迁移至独立的 DanmakuPanelProvider 弹幕面板
 */
export class OutputChannelManager {
  /** 单例实例 */
  private static instance: OutputChannelManager;

  /** 通用日志输出通道 */
  private logChannel: vscode.OutputChannel;

  /**
   * 私有构造函数，防止外部通过 new 创建
   *
   * 初始化时创建通用日志输出通道：
   * - 「bilibili」：通用日志通道
   *
   * 注意：弹幕专用通道（原「bilidm」）已移除，
   * 弹幕输出已迁移至独立的 DanmakuPanelProvider 弹幕面板
   */
  private constructor() {
    this.logChannel = vscode.window.createOutputChannel('bilibili');
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
   * 同时写入「bilibili」输出通道和浏览器控制台，
   * 日志格式：[时间戳] [INFO] 消息内容
   * 例如：[2026-05-06 14:30:25.137] [INFO] 代理服务器已启动
   *
   * @param {string} message - 日志消息
   * @returns {void}
   */
  public info(message: string): void {
    const timestamp = formatTimestamp();
    this.logChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
    console.log(`[bilibili] [${timestamp}] [INFO] ${message}`);
  }

  /**
   * 输出警告级别日志
   *
   * 同时写入「bilibili」输出通道和浏览器控制台，
   * 日志格式：[时间戳] [WARN] 消息内容
   * 例如：[2026-05-06 14:30:25.137] [WARN] 获取数据失败
   *
   * @param {string} message - 警告消息
   * @returns {void}
   */
  public warn(message: string): void {
    const timestamp = formatTimestamp();
    this.logChannel.appendLine(`[${timestamp}] [WARN] ${message}`);
    console.warn(`[bilibili] [${timestamp}] [WARN] ${message}`);
  }

  /**
   * 输出错误级别日志
   *
   * 同时写入「bilibili」输出通道和浏览器控制台，
   * 日志格式：[时间戳] [ERROR] 消息内容
   * 例如：[2026-05-06 14:30:25.137] [ERROR] 连接超时
   *
   * @param {string} message - 错误消息
   * @returns {void}
   */
  public error(message: string): void {
    const timestamp = formatTimestamp();
    this.logChannel.appendLine(`[${timestamp}] [ERROR] ${message}`);
    console.error(`[bilibili] [${timestamp}] [ERROR] ${message}`);
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

  /**
   * 释放所有输出通道资源
   *
   * 扩展停用时调用，确保资源被正确释放
   *
   * @returns {void}
   */
  public dispose(): void {
    this.logChannel.dispose();
  }
}