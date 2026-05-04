/**
 * @file src/webview/videoDanmakuTracker.ts
 * @description 视频弹幕进度追踪器
 *
 * 主要功能：
 * - 根据视频播放进度逐条推送弹幕到输出通道
 * - 支持视频拖拽进度条（seek）后回退弹幕指针
 * - 使用二分查找快速定位弹幕位置
 * - 弹幕按时间排序并去重
 *
 * @author zls3434
 * @date 2026-05-02
 */

import { DanmakuItem } from '../services/danmakuService';
import { DanmakuService } from '../services/danmakuService';
import { OutputChannelManager } from '../utils/outputChannelManager';
import { BiliApiService } from '../services/biliApi';
import { logger } from '../utils/logger';

/**
 * 视频弹幕进度追踪器
 *
 * 管理视频弹幕按播放进度逐条显示的逻辑：
 * - 存储按时间排序的弹幕列表
 * - 维护当前位置指针，避免重复输出
 * - 支持 seek 操作后回退指针
 */
export class VideoDanmakuTracker {
  /** 按时间排序的弹幕列表 */
  private _danmakuList: DanmakuItem[] = [];
  /** 当前输出位置指针 */
  private _danmakuIndex: number = 0;

  constructor(
    private readonly danmakuService: DanmakuService,
    private readonly outputChannelManager: OutputChannelManager,
    private readonly apiService: BiliApiService,
  ) {}

  /**
   * 加载视频弹幕数据
   *
   * 根据视频时长分段获取弹幕 XML，解析后按时间排序并去重。
   *
   * @param {number} cid - 视频 cid
   * @param {number} videoDurationSec - 视频时长（秒）
   * @returns {Promise<void>}
   */
  async loadDanmaku(cid: number, videoDurationSec: number = 0): Promise<void> {
    try {
      this.outputChannelManager.showDanmakuChannel(true);
      this.outputChannelManager.clearDanmakuChannel();
      this.outputChannelManager.appendDanmaku('--- 弹幕将随视频播放进度显示 ---');

      this._danmakuList = [];
      this._danmakuIndex = 0;

      const SEGMENT_DURATION = 360;
      const maxSegments = videoDurationSec > 0
        ? Math.ceil(videoDurationSec / SEGMENT_DURATION)
        : 1;

      const allDanmaku: DanmakuItem[] = [];
      for (let seg = 1; seg <= maxSegments; seg++) {
        const xmlData = await this.apiService.getVideoDanmaku(cid, seg);
        if (!xmlData) { continue; }
        const danmakuList = this.danmakuService.parseVideoDanmakuXML(xmlData);
        allDanmaku.push(...danmakuList);
        if (danmakuList.length === 0) { break; }
      }

      allDanmaku.sort((a, b) => a.timestamp - b.timestamp);
      const dedupedDanmaku: DanmakuItem[] = [];
      for (const item of allDanmaku) {
        const prev = dedupedDanmaku[dedupedDanmaku.length - 1];
        if (!prev || prev.timestamp !== item.timestamp || prev.text !== item.text) {
          dedupedDanmaku.push(item);
        }
      }

      this._danmakuList = dedupedDanmaku;
      logger.info(`视频弹幕已加载: ${dedupedDanmaku.length} 条（原始 ${allDanmaku.length} 条，${maxSegments} 段），等待播放进度推送`);
    } catch (error) {
      logger.error(`加载视频弹幕失败: ${error}`);
    }
  }

  /**
   * 视频播放进度更新回调
   *
   * 根据当前播放时间（毫秒），将已到达时间的弹幕逐条输出到 bilidm 通道。
   * 支持视频拖拽进度条（seek）后回退指针。
   *
   * @param {number} currentMs - 当前视频播放时间（毫秒）
   */
  onVideoProgress(currentMs: number): void {
    if (this._danmakuList.length === 0) { return; }

    if (this._danmakuIndex > 0 && this._danmakuList.length > 0) {
      const lastOutputtedTime = this._danmakuList[this._danmakuIndex - 1].timestamp;
      if (currentMs < lastOutputtedTime - 3000) {
        this._danmakuIndex = this._findDanmakuIndexByTime(currentMs);
        this.outputChannelManager.clearDanmakuChannel();
        this.outputChannelManager.appendDanmaku('--- 弹幕将随视频播放进度显示 ---');
      }
    }

    while (this._danmakuIndex < this._danmakuList.length) {
      const danmaku = this._danmakuList[this._danmakuIndex];
      if (danmaku.timestamp <= currentMs) {
        const text = this.danmakuService.formatDanmakuText(danmaku);
        this.outputChannelManager.appendDanmaku(text);
        this._danmakuIndex++;
      } else {
        break;
      }
    }
  }

  /**
   * 清空弹幕数据
   */
  clear(): void {
    this._danmakuList = [];
    this._danmakuIndex = 0;
  }

  /**
   * 二分查找弹幕索引位置
   *
   * 找到第一个 timestamp >= targetMs 的弹幕索引，
   * 用于视频 seek 后恢复弹幕位置指针。
   */
  private _findDanmakuIndexByTime(targetMs: number): number {
    let lo = 0;
    let hi = this._danmakuList.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this._danmakuList[mid].timestamp < targetMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}