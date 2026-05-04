/**
 * @file src/services/danmakuService.ts
 * @description B站弹幕服务
 *
 * 主要功能：
 * - 解析 B站直播弹幕 WebSocket 协议（Broccoli 协议）
 * - 从 XML 格式解析视频弹幕
 * - 将弹幕数据格式化为可读文本
 * - 支持心跳包保活、zlib 解压缩、认证握手
 *
 * 在项目中的角色：
 * 为扩展提供弹幕数据的实时解析能力，将原始二进制/XML弹幕转为结构化文本
 *
 * 协议说明：
 * 直播弹幕使用 B站自研 Broccoli 协议（基于 WebSocket + 自定义二进制帧）：
 * - 数据包头部 16 字节：PacketLength(4) + HeaderLength(2) + ProtoVer(2) + Operation(4) + Sequence(4)
 * - ProtoVer: 0=纯JSON, 1=心跳人气值, 2=zlib压缩, 3=brotli压缩
 * - Operation: 2=心跳请求, 3=心跳回复(人气值), 5=弹幕消息, 7=认证请求, 8=认证成功
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建弹幕解析服务
 * @modification 2026-04-30 zls3434 修复弹幕连接：添加心跳包、zlib解压缩、使用API返回的服务器地址
 */

import WebSocket from 'ws';
import * as zlib from 'zlib';
import { logger } from '../utils/logger';

/** 弹幕服务器连接信息（从 getDanmuInfo API 获取） */
export interface DanmakuHostInfo {
  /** 服务器主机地址 */
  host: string;
  /** 服务器端口 */
  port: number;
  /** WebSocket 连接协议（ws 或 wss） */
  wsScheme: string;
}

/** 解析后的弹幕数据 */
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

  /** 心跳包定时器 */
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** 心跳包间隔（毫秒），B站要求 30 秒内发送心跳，否则 70 秒后断开 */
  private static readonly HEARTBEAT_INTERVAL = 30000;

  /**
   * 连接 B站直播弹幕 WebSocket 服务器
   *
   * 流程：
   * 1. 建立 WebSocket 连接（默认 wss://broadcastlv.chat.bilibili.com:443/sub）
   * 2. 发送认证包（JSON 格式，包含房间号和 token）
   * 3. 收到认证成功回复后，每 30 秒发送心跳包维持连接
   * 4. 持续接收并解析弹幕数据包（支持 zlib 压缩和纯 JSON）
   *
   * @param {number} roomId - 直播间房间号
   * @param {string} token - 弹幕服务器认证 token（从 getDanmuInfo API 获取）
   * @param {(danmaku: DanmakuItem) => void} callback - 弹幕接收回调函数
   * @param {DanmakuHostInfo} [hostInfo] - 可选的服务器连接信息（从 getDanmuInfo 获取）
   * @returns {void}
   */
  public connectLiveDanmaku(
    roomId: number,
    token: string,
    callback: (danmaku: DanmakuItem) => void,
    hostInfo?: DanmakuHostInfo,
    uid: number = 0
  ): void {
    this.disconnectLiveDanmaku();
    this.onDanmakuCallback = callback;

    // 使用 API 返回的服务器地址或默认地址（wss 加密连接，端口 443）
    const host = hostInfo?.host || 'broadcastlv.chat.bilibili.com';
    const port = hostInfo?.port || 443;
    const scheme = hostInfo?.wsScheme || 'wss';
    const wsUrl = `${scheme}://${host}:${port}/sub`;

    logger.info(`连接弹幕服务器: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info('弹幕 WebSocket 已连接，发送认证包');
      this._sendLiveAuthPacket(roomId, token, uid);
    });

    this.ws.on('message', (data: Buffer) => {
      this._parseLivePacket(data);
    });

    this.ws.on('close', (code: number, reason: string) => {
        logger.info(`弹幕 WebSocket 已断开: code=${code}, reason=${reason || '无原因'}`);
      this._stopHeartbeat();
      this.ws = null;
    });

    this.ws.on('error', (err: Error) => {
        logger.error(`弹幕 WebSocket 连接错误: ${err.message}`);
      this._stopHeartbeat();
      this.ws = null;
    });

    this.ws.on('unexpected-response', (req: unknown, res: { statusCode?: number; statusMessage?: string }) => {
      logger.error(`弹幕 WebSocket 意外响应: ${res.statusCode} ${res.statusMessage}`);
    });
  }

  /**
   * 断开直播弹幕 WebSocket 连接
   *
   * 安全关闭连接、停止心跳包并清理回调引用
   *
   * @returns {void}
   */
  public disconnectLiveDanmaku(): void {
    this._stopHeartbeat();
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
   * 包含 uid、roomid、protover、platform、type 和 key(token)
   *
   * @param {number} roomId - 直播间房间号
   * @param {string} token - 认证 token
   * @returns {void}
   */
  private _sendLiveAuthPacket(roomId: number, token: string, uid: number = 0): void {
    if (!this.ws) { return; }

    const authData = {
      uid,
      roomid: roomId,
      protover: 3,
      platform: 'web',
      type: 2,
      key: token,
      clientver: '1.6.3',
    };
    const authPacket = JSON.stringify(authData);

    logger.info(`发送认证包: uid=${uid}, roomid=${roomId}, protover=3, clientver=1.6.3`);

    // B站 WebSocket 协议：认证包头部 16 字节 + JSON 体
    const header = this._packHeader(16 + authPacket.length, 16, 1, 7);
    this.ws.send(Buffer.concat([header, Buffer.from(authPacket)]));
  }

  /**
   * 启动心跳包定时器
   *
   * B站弹幕协议要求每 30 秒发送心跳包，否则 70 秒后断开连接
   *
   * @returns {void}
   */
  private _startHeartbeat(): void {
    this._stopHeartbeat();
    // 认证成功后立即发送第一个心跳包
    this._sendHeartbeat();
    // 之后每 30 秒发送一次
    this.heartbeatTimer = setInterval(() => {
      this._sendHeartbeat();
    }, DanmakuService.HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳包定时器
   *
   * @returns {void}
   */
  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送心跳数据包
   *
   * 心跳包格式：16 字节头 + 5 字节体 "[object Object]"
   * 操作码为 2（心跳请求）
   *
   * @returns {void}
   */
  private _sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { return; }

    // 心跳包：头部 16 字节，操作码 2
    const heartbeatBody = Buffer.from('[object Object]');
    const header = this._packHeader(16 + heartbeatBody.length, 16, 1, 2);
    this.ws.send(Buffer.concat([header, heartbeatBody]));
  }

  /**
   * 解析直播弹幕 WebSocket 数据包（Broccoli 协议）
   *
   * 数据包结构（16 字节头）：
   * ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
   * │ Packet Length│ Header Length│ Protocol Ver │ Operation    │ Sequence Id  │
   * │  (4 bytes)   │  (2 bytes)   │  (2 bytes)   │  (4 bytes)   │  (4 bytes)   │
   * └──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
   *
   * Protocol Version (ProtoVer):
   * - 0: 纯 JSON 文本
   * - 1: 心跳回复（Body 为 4 字节人气值）
   * - 2: zlib 压缩数据
   * - 3: brotli 压缩数据
   *
   * Operation Code:
   * - 2: 心跳请求
   * - 3: 心跳回复（人气值）
   * - 5: 弹幕/用户消息
   * - 7: 认证请求
   * - 8: 认证成功回复
   *
   * 一个 WebSocket 帧可能包含多个 Broccoli 数据包，需要按 PacketLength 切割
   *
   * @param {Buffer} data - 接收到的原始二进制数据
   * @returns {void}
   */
  private _parseLivePacket(data: Buffer): void {
    let offset = 0;

    // 一个 WebSocket 帧可能包含多个数据包，需要逐个解析
    while (offset + 16 <= data.length) {
      const packetLen = data.readUInt32BE(offset);
      const headerLen = data.readUInt16BE(offset + 4);
      const protoVer = data.readUInt16BE(offset + 6);
      const op = data.readUInt32BE(offset + 8);

      // 数据包不完整，等待更多数据（不应该发生在 WebSocket 帧边界内）
      if (offset + packetLen > data.length) {
        break;
      }

      const bodyBuffer = data.slice(offset + headerLen, offset + packetLen);

      switch (op) {
        // 认证成功回复
        case 8:
          logger.info('弹幕认证成功，开始发送心跳包');
          this._startHeartbeat();
          break;

        // 心跳回复（人气值）
        case 3:
          // 人气值在 body 中（4 字节大端序整数）
          if (bodyBuffer.length >= 4) {
            const popularity = bodyBuffer.readUInt32BE(0);
            logger.info(`直播人气: ${popularity}`);
          }
          break;

        // 弹幕/用户消息
        case 5:
          logger.info(`收到弹幕消息: protoVer=${protoVer}, bodyLen=${bodyBuffer.length}`);
          this._parseMessageBody(bodyBuffer, protoVer);
          break;

        default:
          break;
      }

      // 移动到下一个数据包
      offset += packetLen;
    }
  }

  /**
   * 解析消息体（根据协议版本解压缩后提取弹幕）
   *
   * 解压缩后可能是纯 JSON 文本（op=5 + protoVer=0），
   * 也可能包含嵌套的数据包（需要递归解析）。
   *
   * @param {Buffer} body - 消息体原始数据
   * @param {number} protoVer - 协议版本（0=纯JSON, 2=zlib, 3=brotli）
   * @returns {void}
   */
  private _parseMessageBody(body: Buffer, protoVer: number): void {
    let decompressed: Buffer;

    switch (protoVer) {
      // 纯 JSON 文本
      case 0:
        this._parseJsonMessage(body.toString('utf-8'));
        return;

      // zlib 压缩
      case 2:
        try {
          decompressed = zlib.inflateSync(body);
          logger.info(`zlib 解压成功: ${body.length} -> ${decompressed.length} 字节`);
        } catch (e) {
          logger.warn(`zlib 解压失败: ${e}`);
          return;
        }
        break;

      // brotli 压缩
      case 3:
        try {
          decompressed = zlib.brotliDecompressSync(body);
          logger.info(`brotli 解压成功: ${body.length} -> ${decompressed.length} 字节`);
        } catch (e) {
          logger.warn(`brotli 解压失败: ${e}`);
          return;
        }
        break;

      default:
        return;
    }

    // 解压缩后可能包含多个嵌套的数据包，需要递归解析
    this._parseLivePacket(decompressed);
  }

  /**
   * 解析 JSON 格式的弹幕消息
   *
   * @param {string} text - JSON 格式的消息文本
   * @returns {void}
   */
  private _parseJsonMessage(text: string): void {
    try {
      const body = JSON.parse(text);
      logger.info(`解析弹幕消息: cmd=${body.cmd}`);
      this._handleDanmakuMessage(body);
    } catch (e) {
      logger.warn(`弹幕消息 JSON 解析失败: ${String(e).substring(0, 100)}`);
    }
  }

  /**
   * 构建 Broccoli 协议数据包头
   *
   * @param {number} totalLen - 数据包总长度（头部 + 消息体）
   * @param {number} headerLen - 头部长度（固定 16）
   * @param {number} protoVer - 协议版本（1=认证/心跳, 2=zlib压缩）
   * @param {number} op - 操作码
   * @returns {Buffer} 16 字节的头部 Buffer
   */
  private _packHeader(totalLen: number, headerLen: number, protoVer: number, op: number): Buffer {
    const header = Buffer.alloc(headerLen);
    header.writeUInt32BE(totalLen, 0);
    header.writeUInt16BE(headerLen, 4);
    header.writeUInt16BE(protoVer, 6);
    header.writeUInt32BE(op, 8);
    header.writeUInt32BE(1, 12);
    return header;
  }

  /**
   * 从解压缩后的 JSON 数据中提取弹幕信息
   *
   * 支持的消息命令：
   * - DANMU_MSG: 普通弹幕消息
   * - SUPER_CHAT_MESSAGE: 醒目留言（SC）
   * - SEND_GIFT: 送礼物消息
   * - GUARD_BUY: 上舰长消息
   * - INTERACT_WORD: 入场消息
   * - INTERACT_WORD_V2: 入场消息 V2
   * - LIKE_CLICKV2: 点赞
   * - ONLINE_RANK_COUNT / ONLINE_RANK_V3: 人气排名
   * - POPULARITY_CHANGE: 人气变化
   * - ROOM_CHANGE: 房间信息变更
   * - STOP_LIVE_ROOM_LIST: 停播房间列表
   * - 其他未识别的命令也会输出简短信息
   *
   * @param {Record<string, unknown>} body - 解析后的 JSON 消息体
   * @returns {void}
   */
  private _handleDanmakuMessage(body: Record<string, unknown>): void {
    const cmd = body.cmd as string;
    if (!cmd) { return; }

    // 提取基础 cmd（去掉冒号后的变体后缀）
    const baseCmd = cmd.split(':')[0];

    switch (baseCmd) {
      // 弹幕消息
      case 'DANMU_MSG': {
        const info = body.info as unknown[] || [];
        const danmakuContent = info[1] as string || '';
        const userInfo = info[2] as unknown[] || [];
        const username = userInfo[1] as string || '匿名用户';
        const danmakuType = Array.isArray(info[0]) ? (info[0][1] as number || 0) : 0;
        if (danmakuContent && this.onDanmakuCallback) {
          this.onDanmakuCallback({
            username,
            text: danmakuContent,
            timestamp: Date.now(),
            type: danmakuType,
            isLive: true,
          });
        }
        break;
      }

      // 醒目留言（SC）
      case 'SUPER_CHAT_MESSAGE': {
        const data = body.data as Record<string, unknown>;
        if (data && this.onDanmakuCallback) {
          const userInfo = data.user_info as Record<string, unknown> || {};
          this.onDanmakuCallback({
            username: (userInfo.uname as string) || '匿名用户',
            text: `[SC ¥${data.price || 0}] ${data.message || ''}`,
            timestamp: Date.now(),
            type: 0,
            isLive: true,
          });
        }
        break;
      }

      // 送礼物
      case 'SEND_GIFT': {
        const data = body.data as Record<string, unknown>;
        if (data && this.onDanmakuCallback) {
          const uname = data.uname as string || '匿名用户';
          const giftName = data.giftName as string || '礼物';
          const num = data.num as number || 1;
          const coinType = data.coin_type as string;
          const unit = coinType === 'gold' ? '金瓜子' : '银瓜子';
          this.onDanmakuCallback({
            username: uname,
            text: `🎁 ${uname} 赠送 ${giftName} x${num} (${unit})`,
            timestamp: Date.now(),
            type: 0,
            isLive: true,
          });
        }
        break;
      }

      // 上舰长
      case 'GUARD_BUY': {
        const data = body.data as Record<string, unknown>;
        if (data && this.onDanmakuCallback) {
          const username = data.username as string || '匿名用户';
          const giftName = data.gift_name as string || '舰长';
          const num = data.num as number || 1;
          const price = data.price as number || 0;
          this.onDanmakuCallback({
            username,
            text: `⚓️ ${username} 开通了 ${giftName} x${num} (¥${price})`,
            timestamp: Date.now(),
            type: 0,
            isLive: true,
          });
        }
        break;
      }

      // 入场消息
      case 'INTERACT_WORD':
      case 'INTERACT_WORD_V2': {
        const data = body.data as Record<string, unknown>;
        if (data && this.onDanmakuCallback) {
          const uname = data.uname as string || '';
          if (uname) {
            this.onDanmakuCallback({
              username: uname,
              text: `➡️ ${uname} 进入直播间`,
              timestamp: Date.now(),
              type: 0,
              isLive: true,
            });
          }
        }
        break;
      }

      // 关注
      case 'LIKE_CLICKV2': {
        const data = body.data as Record<string, unknown>;
        if (data && this.onDanmakuCallback) {
          const uname = data.uname as string || '';
          if (uname) {
            this.onDanmakuCallback({
              username: uname,
              text: `👍 ${uname} 点赞了`,
              timestamp: Date.now(),
              type: 0,
              isLive: true,
            });
          }
        }
        break;
      }

      // 以下消息类型不推送到弹幕通道，仅记录调试日志
      case 'ONLINE_RANK_COUNT':
      case 'ONLINE_RANK_V3':
      case 'POPULARITY_CHANGE':
      case 'COLLABORATION_LIVE_WATCHED':
      case 'COLLABORATION_LIVE_POPULARITY':
      case 'COLLABORATION_LIVE_ONLINE':
      case 'STOP_LIVE_ROOM_LIST':
      case 'ROOM_CHANGE':
      case 'ROOM_SILENT_OFF':
      case 'ROOM_SILENT_ON':
      case 'PREPARING':
      case 'LIVE':
      case 'viewer_toast':
      case 'WEEK_STAR_CLOCK':
      case 'HOT_RANK_CHANGE':
      case 'HOT_RANK_SETTLEMENT':
      case 'BOX_ACTIVITY':
        // 排队类消息不推送，静默忽略
        break;

      // 其他未知消息类型
      default:
        // 首次遇到新 cmd 时记录日志，帮助发现新的消息类型
        if (this.onDanmakuCallback) {
          logger.info(`未知弹幕命令: cmd=${cmd}`);
        }
        break;
    }
  }

  /**
   * 从 XML 字符串解析视频弹幕
   *
   * B站视频弹幕 XML 格式示例：
   * ```xml
   * <d p="timeline,type,fontsize,color,sendtime,pool,uid,hash">弹幕文本</d>
   * ```
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
        username: '',
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