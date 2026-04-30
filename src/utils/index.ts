/**
 * @file src/utils/index.ts
 * @description 工具函数入口文件
 *
 * 主要功能：
 * - 统一导出所有通用工具函数和管理器
 * - 提供输出通道管理、加密解密、URL 解析、时间格式化等辅助工具
 *
 * 在项目中的角色：
 * 提供跨模块共享的纯函数工具集，不依赖业务状态
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 更新导出，添加输出通道管理器
 */

export { OutputChannelManager } from './outputChannelManager';
