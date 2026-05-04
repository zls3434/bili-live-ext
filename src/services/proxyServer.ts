/**
 * @file src/services/proxyServer.ts
 * @description 本地代理服务器
 *
 * 主要功能：
 * - 启动本地 HTTP 代理服务器，转发视频/直播流请求
 * - 为请求添加正确的 Referer 和 User-Agent 头，绕过 B站 CDN 防盗链
 * - 支持 video 和 live 两种代理路径
 * - 自动根据目标 URL 协议选择 http 或 https 模块
 * - 自动跟随 HTTP 重定向（301/302/307/308），最多 5 次重定向
 *
 * 在项目中的角色：
 * 解决 VSCode WebView 中直接请求 B站 CDN 返回 403 的问题，
 * 因为 WebView 发出的请求 Referer 不是 bilibili.com
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 创建本地代理服务器，解决 403 防盗链问题
 * @modification 2026-04-30 zls3434 修复 http.request 无法请求 HTTPS URL 的问题
 * @modification 2026-04-30 zls3434 添加自动跟随重定向，解决直播流 302 重定向问题
 */

import * as http from 'http';
import * as https from 'https';
import { logger } from '../utils/logger';

/** 最大重定向跟随次数，防止无限重定向 */
const MAX_REDIRECTS = 5;

/**
 * 根据 URL 协议自动选择 http 或 https 模块发起请求
 *
 * @param {string} url - 目标 URL
 * @param {http.RequestOptions} options - 请求选项
 * @param {(res: http.IncomingMessage) => void} callback - 响应回调
 * @returns {http.ClientRequest} 客户端请求对象
 */
function requestWithProtocol(url: string, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void): http.ClientRequest {
  if (url.startsWith('https://')) {
    return https.request(url, options, callback);
  }
  return http.request(url, options, callback);
}

/**
 * 本地代理服务器类
 *
 * 在本地启动一个 HTTP 服务器，接收 WebView 中的视频播放请求，
 * 添加正确的请求头后转发到 B站 CDN，解决 403 防盗链限制
 */
export class ProxyServer {
  /** HTTP 服务器实例 */
  private server: http.Server | null = null;

  /** 服务器监听端口 */
  private port: number = 0;

  /**
   * 启动代理服务器
   *
   * @returns {Promise<number>} 返回服务器实际监听的端口号
   */
  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
          logger.info(`代理服务器已启动，端口: ${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('无法获取代理服务器端口'));
        }
      });

      this.server.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  /**
   * 获取代理服务器的基地址
   *
   * @returns {string} 代理服务器 URL
   */
  public getBaseUrl(): string {
    if (!this.port) {
      throw new Error('代理服务器尚未启动');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * 停止代理服务器
   *
   * @returns {Promise<void>}
   */
  public async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          this.port = 0;
          resolve();
        });
      });
    }
  }

  /**
   * 构建代理请求头
   *
   * 添加 B站 CDN 要求的 Referer、Origin 和 User-Agent 头
   *
   * @param {http.IncomingMessage} [req] - 客户端请求（用于转发 Range 头）
   * @returns {Record<string, string>} 请求头字典
   */
  private _buildProxyHeaders(req?: http.IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {
      'Referer': 'https://www.bilibili.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://www.bilibili.com',
      'Accept': '*/*',
    };

    // 转发 Range 头以支持视频进度条拖拽
    if (req?.headers.range) {
      headers['Range'] = req.headers.range as string;
    }

    return headers;
  }

  /**
   * 发起代理请求并自动跟随重定向
   *
   * 当目标服务器返回 301/302/307/308 重定向时，代理会自动跟随 Location 头，
   * 最多跟随 MAX_REDIRECTS 次，防止无限重定向。
   * 重定向时保持原始请求头（Referer、Origin 等），确保 CDN 防盗链验证通过。
   *
   * @param {string} targetUrl - 目标 URL
   * @param {http.ServerResponse} res - 客户端响应对象
   * @param {http.IncomingMessage} [req] - 客户端请求对象
   * @param {number} [redirectCount=0] - 当前重定向次数
   * @returns {void}
   */
  private _proxyRequest(targetUrl: string, res: http.ServerResponse, req?: http.IncomingMessage, redirectCount: number = 0): void {
    // 超过最大重定向次数，返回错误
    if (redirectCount > MAX_REDIRECTS) {
      logger.error(`代理重定向次数过多: ${targetUrl.substring(0, 100)}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end('Too many redirects');
      return;
    }

    const requestHeaders = this._buildProxyHeaders(req);

    const proxyReq = requestWithProtocol(targetUrl, {
      method: 'GET',
      headers: requestHeaders,
    }, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;

      // 处理重定向：自动跟随 Location 头
      if ([301, 302, 307, 308].includes(statusCode) && proxyRes.headers.location) {
        const location = proxyRes.headers.location;
        // 解析重定向 URL（可能是相对路径，需要拼接为完整 URL）
        let redirectUrl: string;
        if (location.startsWith('http://') || location.startsWith('https://')) {
          redirectUrl = location;
        } else {
          // 相对路径：基于原始 URL 拼接
          const baseUrl = new URL(targetUrl);
          redirectUrl = new URL(location, baseUrl.origin).href;
        }
        logger.info(`代理跟随重定向 (${statusCode}): ${redirectUrl.substring(0, 100)}`);
        // 消费当前响应体（防止内存泄漏）
        proxyRes.resume();
        // 递归跟随重定向
        this._proxyRequest(redirectUrl, res, req, redirectCount + 1);
        return;
      }

      // 非重定向：转发响应
      const responseHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      };

      if (proxyRes.headers['content-type']) {
        responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
      }
      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['accept-ranges']) {
        responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }

      res.writeHead(statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err: Error) => {
      logger.error(`代理请求失败: ${targetUrl.substring(0, 100)} - ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end(`Proxy error: ${err.message}`);
    });

    proxyReq.end();
  }

  /**
   * 处理代理请求
   *
   * 解析客户端请求中的目标 URL，发起代理请求并自动跟随重定向。
   *
   * @param {http.IncomingMessage} req - 客户端请求
   * @param {http.ServerResponse} res - 服务器响应
   * @returns {void}
   */
  private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!req.url) {
      res.writeHead(400);
      res.end('Missing URL');
      return;
    }

    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 解析目标 URL
    const urlObj = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const targetUrl = urlObj.searchParams.get('url');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url parameter');
      return;
    }

    const decodedUrl = decodeURIComponent(targetUrl);
    // 发起代理请求（内部自动跟随重定向）
    this._proxyRequest(decodedUrl, res, req);
  }
}