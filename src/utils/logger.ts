/**
 * @file src/utils/logger.ts
 * @description 全局日志管理器
 *
 * 主要功能：
 * - 提供全局的日志输出接口，替代 console.log/warn/error
 * - 日志同时输出到 VSCode 输出通道（bilibili）和控制台
 * - 非 VSCode 环境下自动降级为纯 console 输出
 * - 日志输出格式包含毫秒级时间戳，便于精确定位事件时序
 *
 * 在项目中的角色：
 * 作为插件的统一日志入口，所有模块通过此 logger 记录日志，
 * 确保日志在 VSCode 输出面板中可见
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建全局日志管理器
 * @modification 2026-05-06 zls3434 优化日志输出格式，降级模式下也增加毫秒级时间戳
 */

import { OutputChannelManager } from './outputChannelManager';
import { formatTimestamp } from './outputChannelManager';

/**
 * 全局日志管理器
 *
 * 封装 OutputChannelManager 提供便捷的全局日志方法。
 * 所有模块直接导入 logger 即可使用，无需传递 OutputChannelManager 实例。
 *
 * 使用示例：
 * ```typescript
 * import { logger } from '../utils/logger';
 * logger.info('代理服务器已启动');
 * logger.warn('获取数据失败');
 * logger.error('连接超时');
 * ```
 */
class Logger {
  /** 输出通道管理器实例（延迟初始化） */
  private channelManager: OutputChannelManager | null = null;

  /**
   * 初始化日志管理器
   *
   * 必须在 OutputChannelManager 创建后调用此方法，
   * 将输出通道绑定到日志管理器
   *
   * @param {OutputChannelManager} manager - 输出通道管理器实例
   * @returns {void}
   */
  public init(manager: OutputChannelManager): void {
    this.channelManager = manager;
  }

  /**
   * 输出信息级别日志
   *
   * 若 OutputChannelManager 已初始化，则通过 VSCode 输出通道输出（含时间戳）；
   * 否则降级为 console.log 输出，同样包含毫秒级时间戳
   *
   * @param {string} message - 日志消息
   * @returns {void}
   */
  public info(message: string): void {
    if (this.channelManager) {
      this.channelManager.info(message);
    } else {
      const timestamp = formatTimestamp();
      console.log(`[bilibili] [${timestamp}] [INFO] ${message}`);
    }
  }

  /**
   * 输出警告级别日志
   *
   * 若 OutputChannelManager 已初始化，则通过 VSCode 输出通道输出（含时间戳）；
   * 否则降级为 console.warn 输出，同样包含毫秒级时间戳
   *
   * @param {string} message - 警告消息
   * @returns {void}
   */
  public warn(message: string): void {
    if (this.channelManager) {
      this.channelManager.warn(message);
    } else {
      const timestamp = formatTimestamp();
      console.warn(`[bilibili] [${timestamp}] [WARN] ${message}`);
    }
  }

  /**
   * 输出错误级别日志
   *
   * 若 OutputChannelManager 已初始化，则通过 VSCode 输出通道输出（含时间戳）；
   * 否则降级为 console.error 输出，同样包含毫秒级时间戳
   *
   * @param {string} message - 错误消息
   * @returns {void}
   */
  public error(message: string): void {
    if (this.channelManager) {
      this.channelManager.error(message);
    } else {
      const timestamp = formatTimestamp();
      console.error(`[bilibili] [${timestamp}] [ERROR] ${message}`);
    }
  }
}

/** 全局日志管理器单例 */
export const logger = new Logger();