/**
 * @file src/webview/videoDanmakuTracker.ts
 * @description 视频弹幕进度追踪器
 *
 * 主要功能：
 * - 根据视频播放进度逐条推送弹幕到弹幕面板
 * - 支持视频拖拽进度条（seek）后回退弹幕指针
 * - 使用二分查找快速定位弹幕位置
 * - 弹幕按时间排序并去重
 *
 * @author zls3434
 * @date 2026-05-02
 * @modification 2026-05-06 zls3434 重构弹幕输出：从 OutputChannel 改为使用独立弹幕面板 DanmakuPanelProvider
 */

import { DanmakuItem } from '../services/danmakuService';
import { DanmakuService } from '../services/danmakuService';
import { DanmakuPanelProvider } from './DanmakuPanelProvider';
import { BiliApiService } from '../services/biliApi';
import { logger } from '../utils/logger';

/**
 * 视频弹幕进度追踪器
 *
 * 管理视频弹幕按播放进度逐条显示的逻辑：
 * - 存储按时间排序的弹幕列表
 * - 维护当前位置指针，避免重复输出
 * - 支持 seek 操作后回退指针
 * - 将弹幕数据推送到 DanmakuPanelProvider（独立弹幕面板）进行渲染
 *
 * 修改日期：2026-05-06
 * 修改人：zls3434
 * 修改目的：将弹幕输出从 OutputChannel 改为使用 DanmakuPanelProvider
 */
export class VideoDanmakuTracker {
  /** 按时间排序的弹幕列表 */
  private _danmakuList: DanmakuItem[] = [];
  /** 当前输出位置指针 */
  private _danmakuIndex: number = 0;

  /**
   * 弹幕面板提供者实例，用于将弹幕数据推送到独立弹幕面板渲染
   *
   * 修改日期：2026-05-06
   * 修改人：zls3434
   * 修改目的：替代原 outputChannelManager，弹幕输出改用 DanmakuPanelProvider
   */
  private _danmakuPanel: DanmakuPanelProvider | null = null;

  constructor(
    private readonly danmakuService: DanmakuService,
    private readonly apiService: BiliApiService,
  ) {}

  /**
   * 注入弹幕面板提供者实例
   *
   * 由于 VideoDanmakuTracker 在 BiliMainViewProvider 构造时初始化，
   * 而 DanmakuPanelProvider 在 extension.ts 中独立创建后再注入，
   * 因此需要通过 setter 方法延迟注入。
   *
   * 修改日期：2026-05-06
   * 修改人：zls3434
   * 修改目的：新增方法，支持从 BiliMainViewProvider 注入 DanmakuPanelProvider 实例
   *
   * @param {DanmakuPanelProvider} danmakuPanel - 弹幕面板提供者实例
   * @returns {void}
   */
  public setDanmakuPanel(danmakuPanel: DanmakuPanelProvider): void {
    this._danmakuPanel = danmakuPanel;
  }

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
      // 清空弹幕面板中的旧弹幕数据
      // 注意：不需要调用 activateForVideo，因为 BiliMainViewProvider.openVideo 已在调用此方法前激活了弹幕面板
      this._danmakuPanel?.clearDanmaku();

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
   * 根据当前播放时间（毫秒），将已到达时间的弹幕逐条推送到弹幕面板。
   * 支持视频拖拽进度条（seek）后回退指针。
   *
   * 修改日期：2026-05-06
   * 修改人：zls3434
   * 修改目的：将弹幕输出从 OutputChannel 改为使用 DanmakuPanelProvider，
   *          直接传递 DanmakuItem 对象，由面板自行格式化和渲染
   *
   * @param {number} currentMs - 当前视频播放时间（毫秒）
   */
  onVideoProgress(currentMs: number): void {
    if (this._danmakuList.length === 0) { return; }

    // 检测视频是否被拖拽（seek）到更早的时间点
    // 如果当前时间比上一次输出的弹幕时间早超过3秒，则认为发生了 seek
    if (this._danmakuIndex > 0 && this._danmakuList.length > 0) {
      const lastOutputtedTime = this._danmakuList[this._danmakuIndex - 1].timestamp;
      if (currentMs < lastOutputtedTime - 3000) {
        // seek 回退：重新定位弹幕指针，清空面板后重新输出
        this._danmakuIndex = this._findDanmakuIndexByTime(currentMs);
        this._danmakuPanel?.clearDanmaku();
      }
    }

    // 逐条输出已到达当前时间点的弹幕
    while (this._danmakuIndex < this._danmakuList.length) {
      const danmaku = this._danmakuList[this._danmakuIndex];
      if (danmaku.timestamp <= currentMs) {
        // 直接传递 DanmakuItem 对象到弹幕面板，由面板负责格式化渲染
        this._danmakuPanel?.appendDanmaku(danmaku);
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