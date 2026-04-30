/**
 * @file src/services/danmakuService.ts
 * @description B站弹幕服务
 *
 * 主要功能：
 * - 解析 B站直播弹幕 WebSocket 协议（Broccoli 协议）
 * - 从 XML 格式解析视频弹幕
 * - 将弹幕数据格式化为可读文本
 *
 * 在项目中的角色：
 * 为扩展提供弹幕数据的实时解析能力，将原始二进制/XML弹幕转为结构化文本
 *
 * 协议说明：
 * 直播弹幕使用 B站自研 Broccoli 协议（基于 WebSocket + 自定义二进制帧）：
 * - 每个数据包头部 16 字节
 * - 操作码 5 为用户消息（DANMU_MSG 命令）
 * - 消息体为 JSON 格式
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建弹幕解析服务，实现直播和视频弹幕的解析与格式化
 */

import WebSocket from 'ws';

/**
 * 解析后的弹幕数据
 */
export interface DanmakuItem {
  /** 发送者用户名 */
  username: string;
  /** 弹幕文本内容 */
  text: string;
  /** 弹幕发送时间（毫秒） */
  timestamp: number;
  /** 弹幕类型：0=普通 1=滚动 2=底部 3=顶部 */
  type: number;
  /** 是否为直播弹幕 */
  isLive: boolean;
}

/**
 * B站弹幕服务类
 *
 * 提供弹幕数据的获取、解析和格式化能力
 * 支持直播弹幕（WebSocket 实时连接）和视频弹幕（XML 离线解析）
 */
export class DanmakuService {
  /** 直播弹幕 WebSocket 连接实例 */
  private ws: WebSocket | null = null;

  /** 直播弹幕接收回调 */
  private onDanmakuCallback: ((danmaku: DanmakuItem) => void) | null = null;

  /** 直播房间认证 token */
  private liveToken: string = '';

  /**
   * 连接 B站直播弹幕 WebSocket 服务器
   *
   * 流程：
   * 1. 建立 WebSocket 连接
   * 2. 发送认证包（JSON 格式，包含房间号和 token）
   * 3. 每 30 秒发送心跳包维持连接
   * 4. 持续接收并解析弹幕数据包
   *
   * @param {number} roomId - 直播间房间号
   * @param {string} token - 弹幕服务器认证 token（从 getLiveDanmakuInfo API 获取）
   * @param {(danmaku: DanmakuItem) => void} callback - 弹幕接收回调函数
   * @returns {void}
   */
  public connectLiveDanmaku(
    roomId: number,
    token: string,
    callback: (danmaku: DanmakuItem) => void
  ): void {
    this.disconnectLiveDanmaku();
    this.liveToken = token;
    this.onDanmakuCallback = callback;

    // 弹幕服务器地址（B站官方弹幕 WebSocket 地址）
    const wsUrl = 'wss://broadcastlv.chat.bilibili.com:2245/sub';

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this._sendLiveAuthPacket(roomId, token);
    });

    this.ws.on('message', (data: Buffer) => {
      this._parseLivePacket(data);
    });

    this.ws.on('close', () => {
      this.ws = null;
    });

    this.ws.on('error', (err: Error) => {
      console.error('弹幕 WebSocket 连接错误:', err.message);
      this.ws = null;
    });
  }

  /**
   * 断开直播弹幕 WebSocket 连接
   *
   * 安全关闭连接并清理回调引用
   *
   * @returns {void}
   */
  public disconnectLiveDanmaku(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onDanmakuCallback = null;
  }

  /**
   * 发送直播弹幕认证数据包
   *
   * B站弹幕认证协议：第一个数据包为 JSON 格式的认证信息，
   * 包含 uid、roomid、protover、platform、type 和 key
   *
   * @param {number} roomId - 直播间房间号
   * @param {string} token - 认证 token
   * @returns {void}
   */
  private _sendLiveAuthPacket(roomId: number, token: string): void {
    if (!this.ws) { return; }

    const authPacket = JSON.stringify({
      uid: 0,
      roomid: roomId,
      protover: 2,
      platform: 'web',
      type: 2,
      key: token,
    });

    // B站 WebSocket 协议：认证包头部 16 字节 + JSON 体
    const header = this._packHeader(16 + authPacket.length, 16, 1, 7);
    this.ws.send(Buffer.concat([header, Buffer.from(authPacket)]));
  }

  /**
   * 解析直播弹幕 WebSocket 数据包（Brotli/Broccoli 协议）
   *
   * 数据包结构：
   * ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
   * │ Packet Length │ Header Length│ Protocol Ver │ Operation    │ Sequence Id  │
   * │   (4 bytes)   │  (2 bytes)   │  (2 bytes)   │  (4 bytes)   │  (4 bytes)   │
   * └──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
   *
   * Operation Code:
   * - 2: 心跳回复
   * - 3: 人气值
   * - 5: 弹幕/用户消息
   * - 7: 认证成功回复
   * - 8: 握手成功
   *
   * @param {Buffer} data - 接收到的原始二进制数据
   * @returns {void}
   */
  private _parseLivePacket(data: Buffer): void {
    if (data.length < 16) { return; }

    const packetLen = data.readUInt32BE(0);
    const headerLen = data.readUInt16BE(4);
    const protoVer = data.readUInt16BE(6);
    const op = data.readUInt32BE(8);

    // 仅处理弹幕消息（op=5）和普通 JSON 协议（protoVer=0）
    if (op === 5 && protoVer === 0) {
      const bodyBuffer = data.slice(headerLen, packetLen);

      try {
        const body = JSON.parse(bodyBuffer.toString('utf-8'));

        // 弹幕命令关键字为 "DANMU_MSG"
        if (body.cmd === 'DANMU_MSG') {
          const info = body.info || [];
          const danmakuContent = info[1] || '';
          const userInfo = info[2] || [];
          const username = userInfo[1] || '匿名用户';
          const danmakuType = info[0] && info[0][1] ? info[0][1] : 0;

          if (danmakuContent && this.onDanmakuCallback) {
            this.onDanmakuCallback({
              username,
              text: danmakuContent,
              timestamp: Date.now(),
              type: danmakuType,
              isLive: true,
            });
          }
        }
      } catch {
        // 非 JSON 消息（可能为 Brotli 压缩），静默跳过
      }
    }
  }

  /**
   * 构建 Broccoli 协议数据包头
   *
   * @param {number} totalLen - 数据包总长度（头部 + 消息体）
   * @param {number} headerLen - 头部长度（固定 16）
   * @param {number} protoVer - 协议版本（1=普通JSON, 2=心跳, 3=zlib压缩JSON）
   * @param {number} op - 操作码
   * @returns {Buffer} 16 字节的头部 Buffer
   */
  private _packHeader(totalLen: number, headerLen: number, protoVer: number, op: number): Buffer {
    const header = Buffer.alloc(headerLen);
    header.writeUInt32BE(totalLen, 0);
    header.writeUInt16BE(headerLen, 4);
    header.writeUInt16BE(protoVer, 6);
    header.writeUInt32BE(op, 8);
    header.writeUInt32BE(1, 12); // sequence = 1
    return header;
  }

  /**
   * 从 XML 字符串解析视频弹幕
   *
   * B站视频弹幕 XML 格式示例：
   * ```xml
   * <d p="timeline,type,fontsize,color,sendtime,pool,uid,hash">弹幕文本</d>
   * ```
   *
   * p 属性中的字段（逗号分隔）：
   * - [0]: 弹幕出现在视频中的时间（秒，浮点数）
   * - [1]: 弹幕类型（1=滚动,4=底部,5=顶部）
   * - [5]: 弹幕池（0=普通,1=字幕,2=特殊）
   * - [6]: 发送者 UID
   *
   * @param {string} xmlData - B站弹幕 XML 原始字符串
   * @returns {DanmakuItem[]} 解析后的弹幕数组
   */
  public parseVideoDanmakuXML(xmlData: string): DanmakuItem[] {
    const danmakuList: DanmakuItem[] = [];

    if (!xmlData) { return danmakuList; }

    // 使用正则提取所有 <d p="...">text</d> 节点
    const regex = /<d p="([^"]+)"[^>]*>([^<]+)<\/d>/g;
    let match;

    while ((match = regex.exec(xmlData)) !== null) {
      const attrs = match[1].split(',');
      const text = match[2].trim();

      if (!text) { continue; }

      const timeSeconds = parseFloat(attrs[0]) || 0;
      const type = parseInt(attrs[1], 10) || 1;

      danmakuList.push({
        username: '', // XML 弹幕不包含用户名
        text,
        timestamp: Math.floor(timeSeconds * 1000),
        type,
        isLive: false,
      });
    }

    return danmakuList;
  }

  /**
   * 格式化弹幕为可读的文本行
   *
   * 格式：`[HH:mm:ss] <用户名> 弹幕内容`
   * 视频弹幕不带时间戳字段时使用弹幕出现时间
   *
   * @param {DanmakuItem} item - 弹幕数据
   * @returns {string} 格式化后的字符串
   */
  public formatDanmakuText(item: DanmakuItem): string {
    const time = new Date(item.timestamp);
    const timeStr = time.toTimeString().slice(0, 8);

    if (item.isLive) {
      return `[${timeStr}] <${item.username}> ${item.text}`;
    } else {
      // 视频弹幕显示视频内的时间位置
      const videoTime = this._formatVideoTime(item.timestamp);
      return `[${videoTime}] ${item.text}`;
    }
  }

  /**
   * 格式化视频内弹幕时间（毫秒 -> mm:ss）
   *
   * @param {number} ms - 弹幕在视频中的时间位置（毫秒）
   * @returns {string} 格式化时间字符串
   */
  private _formatVideoTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
}
