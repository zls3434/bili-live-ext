/**
 * @file src/services/sessionManager.ts
 * @description B站登录会话管理器
 *
 * 主要功能：
 * - 基于 VSCode ExtensionContext.globalState 持久化存储登录 Cookie
 * - 提供会话的保存、读取、清除和有效性校验
 * - 支持插件重启后自动恢复登录态
 *
 * 在项目中的角色：
 * 管理用户登录状态的持久化存储，确保会话在插件生命周期内可用
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建会话管理器，实现 Cookie 持久化存储和会话校验
 */

import * as vscode from 'vscode';
import axios from 'axios';

/** globalState 中存储 Cookie 的 key 常量 */
const SESSION_COOKIE_KEY = 'codebili.session.cookie';

/**
 * 会话管理器类
 *
 * 封装 B站登录 Cookie 的 CRUD 操作和有效性校验逻辑
 * 通过 VSCode 的 globalState 机制实现跨会话的数据持久化
 */
export class SessionManager {

  /**
   * 构造函数
   * @param {vscode.ExtensionContext} context - VSCode 扩展上下文，用于访问 globalState
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * 保存登录 Cookie 到 globalState
   *
   * @param {string} cookie - 登录后的完整 Cookie 字符串
   *                          格式如 "SESSDATA=xxx; bili_jct=xxx"
   * @returns {Promise<void>}
   */
  async saveSession(cookie: string): Promise<void> {
    await this.context.globalState.update(SESSION_COOKIE_KEY, cookie);
  }

  /**
   * 从 globalState 中读取已保存的 Cookie
   *
   * @returns {Promise<string | undefined>}
   *          已保存的 Cookie 字符串，不存在时返回 undefined
   */
  async getSession(): Promise<string | undefined> {
    return this.context.globalState.get<string>(SESSION_COOKIE_KEY);
  }

  /**
   * 清除 globalState 中存储的 Cookie
   *
   * @returns {Promise<void>}
   */
  async clearSession(): Promise<void> {
    await this.context.globalState.update(SESSION_COOKIE_KEY, undefined);
  }

  /**
   * 判断当前是否有已保存的登录会话
   *
   * @returns {Promise<boolean>} 是否有有效的 Cookie 存储
   */
  async isLoggedIn(): Promise<boolean> {
    const cookie = await this.getSession();
    return !!cookie;
  }

  /**
   * 校验已保存 Cookie 的有效性
   *
   * 调用 B站 nav 接口，通过响应中的 isLogin 字段判断 Cookie 是否仍然有效
   *
   * 使用场景：
   * - 插件激活时验证已缓存的会话是否过期
   * - 用户手动触发登录态刷新
   *
   * @param {string} cookie - 待校验的 Cookie 字符串
   * @returns {Promise<boolean>} Cookie 是否有效（登录态是否保持）
   */
  async checkSessionValidity(cookie: string): Promise<boolean> {
    try {
      const response = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
          'Cookie': cookie,
        },
      });

      const { code, data } = response.data;
      // code=0 且 data.isLogin 为 true 表示会话有效
      return code === 0 && data && data.isLogin === true;
    } catch {
      return false;
    }
  }
}
