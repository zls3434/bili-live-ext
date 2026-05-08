/**
 * @file src/services/viewHistoryManager.ts
 * @description 关注UP主视频列表查看时间戳管理器
 *
 * 主要功能：
 * - 基于 VSCode ExtensionContext.globalState 持久化存储用户查看关注UP主视频列表的时间戳
 * - 提供单个/批量读取、写入查看时间的操作
 * - 管理"初始化时间"，作为无查看记录时的回退值
 *
 * 在项目中的角色：
 * 为"关注视频更新"功能提供时间基准，判断哪些视频是用户上次查看后新增的
 *
 * @author zls3434
 * @date 2026-05-07
 * @modification 2026-05-07 zls3434 创建查看时间戳管理器，实现关注UP主视频列表查看记录的持久化存储
 */

import * as vscode from 'vscode';

/** globalState 中存储单个UP主查看时间的 key 前缀 */
const FOLLOW_VIEW_TIME_PREFIX = 'followViewTime.';

/** globalState 中存储初始化时间的 key */
const FOLLOW_VIEW_INIT_TIME_KEY = 'followViewInitTime';

/**
 * 查看时间戳管理器类
 *
 * 封装关注UP主视频列表查看时间戳的 CRUD 操作
 * 通过 VSCode 的 globalState 机制实现跨会话的数据持久化
 * 用于追踪用户上次浏览各UP主视频列表的时间，以判断新增视频
 */
export class ViewHistoryManager {

  /**
   * 构造函数
   * @param {vscode.ExtensionContext} context - VSCode 扩展上下文，用于访问 globalState
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * 获取用户上次查看某UP主视频列表的时间戳
   *
   * @param {number} mid - UP主的用户ID（mid）
   * @returns {Promise<number | null>}
   *          上次查看的时间戳（毫秒），若无记录返回 null
   */
  async getViewTime(mid: number): Promise<number | null> {
    const key = `${FOLLOW_VIEW_TIME_PREFIX}${mid}`;
    const value = this.context.globalState.get<number>(key);
    // globalState.get 在 key 不存在时返回 undefined，转为 null
    return value ?? null;
  }

  /**
   * 记录当前时间戳到 globalState，表示用户正在查看该UP主的视频列表
   *
   * @param {number} mid - UP主的用户ID（mid）
   * @returns {Promise<void>}
   */
  async setViewTime(mid: number): Promise<void> {
    const key = `${FOLLOW_VIEW_TIME_PREFIX}${mid}`;
    await this.context.globalState.update(key, Date.now());
  }

  /**
   * 获取初始化时间
   *
   * 行为说明：
   * - 若 globalState 中已存在 followViewInitTime，直接返回
   * - 若不存在（首次启动），以当前时间戳创建并持久化，后续启动均返回该值
   *
   * 用途：当用户从未查看过某UP主的视频列表时，使用该时间作为回退值
   *
   * @returns {Promise<number>} 初始化时间戳（毫秒）
   */
  async getInitTime(): Promise<number> {
    const existing = this.context.globalState.get<number>(FOLLOW_VIEW_INIT_TIME_KEY);
    if (existing !== undefined) {
      return existing;
    }
    // 首次访问：创建当前时间戳并持久化
    const now = Date.now();
    await this.context.globalState.update(FOLLOW_VIEW_INIT_TIME_KEY, now);
    return now;
  }

  /**
   * 批量获取多个UP主的查看时间
   *
   * 对于没有查看记录的UP主，使用 getInitTime() 的值作为回退，
   * 确保返回结果中每个 mid 都有对应的时间戳
   *
   * @param {number[]} mids - UP主的用户ID数组
   * @returns {Promise<Record<number, number>>}
   *          以 mid 为 key、查看时间戳为 value 的映射对象，所有值均非 null
   */
  async getViewTimesBatch(mids: number[]): Promise<Record<number, number>> {
    // 获取初始化时间作为无记录时的回退值
    const initTime = await this.getInitTime();
    const result: Record<number, number> = {};

    for (const mid of mids) {
      const viewTime = await this.getViewTime(mid);
      // 无查看记录则使用初始化时间
      result[mid] = viewTime ?? initTime;
    }

    return result;
  }
}