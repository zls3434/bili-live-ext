/**
 * @file src/services/biliLogin.ts
 * @description B站扫码登录服务
 *
 * 主要功能：
 * - 调用 B站官方 API 生成登录二维码 URL 和扫码密钥
 * - 轮询登录状态，检测用户扫码确认结果
 * - 登录成功后提取并格式化 Cookie 信息
 *
 * 在项目中的角色：
 * 负责 B站扫码登录的完整生命周期管理，是用户认证流程的核心服务
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 修复登录轮询状态判断问题：
 *   B站 API 在二维码未扫描时也可能返回 code=0 但无有效 Cookie，
 *   需要校验 SESSDATA 是否存在才能确认为真正的登录成功
 */

import axios from 'axios';

export class BiliLoginService {

  /**
   * 生成扫码登录二维码
   *
   * @returns {Promise<{ qrCodeUrl: string; qrCodeKey: string }>}
   * @throws 当 API 返回非 0 的 code 时抛出错误
   */
  async generateQRCode(): Promise<{ qrCodeUrl: string; qrCodeKey: string }> {
    const apiUrl = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';

    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const { code, data } = response.data;

    if (code !== 0) {
      throw new Error(`获取二维码失败: code=${code}, message=${response.data.message}`);
    }

    return {
      qrCodeUrl: data.url,
      qrCodeKey: data.qrcode_key,
    };
  }

  /**
   * 轮询扫码登录状态
   *
   * B站扫码登录 API 返回码含义：
   * - 0: 登录成功（但需校验 SESSDATA 是否存在，排除无效的 code=0 响应）
   * - 86101: 未扫描
   * - 86090: 已扫描未确认
   * - 86038: 二维码已过期
   *
   * 重要：B站 API 在某些情况下（如二维码刚生成时），即使 code=0，
   * 但 data.url 中并没有真正的登录信息。需要检查 SESSDATA
   * 是否存在才能确认为有效的登录成功。
   *
   * @param {string} qrCodeKey - 二维码扫码密钥
   * @returns {Promise<{ status: string; cookie?: string }>}
   */
  async pollLoginStatus(qrCodeKey: string): Promise<{ status: string; cookie?: string }> {
    const apiUrl = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrCodeKey}`;

    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      },
    });

    const { code, data } = response.data;

    switch (code) {
      case 0: {
        let cookie = '';

        // 方法1：从 data.url 的查询参数中提取关键 Cookie 字段
        if (data && data.url) {
          try {
            const urlObj = new URL(data.url);
            const sessdata = urlObj.searchParams.get('SESSDATA');
            const biliJct = urlObj.searchParams.get('bili_jct');
            const dedeUserId = urlObj.searchParams.get('DedeUserID');
            const dedeUserIdCkMd5 = urlObj.searchParams.get('DedeUserID__ckMd5');

            // 核心：SESSDATA 是 B站登录态的最关键凭证，
            // 没有 SESSDATA 说明不是真正的登录成功
            if (sessdata) {
              const parts: string[] = [`SESSDATA=${sessdata}`];
              if (biliJct) { parts.push(`bili_jct=${biliJct}`); }
              if (dedeUserId) { parts.push(`DedeUserID=${dedeUserId}`); }
              if (dedeUserIdCkMd5) { parts.push(`DedeUserID__ckMd5=${dedeUserIdCkMd5}`); }
              cookie = parts.join('; ');
            }
          } catch {
            // URL 解析失败
          }
        }

        // 方法2：从 Set-Cookie 响应头中提取（补充）
        if (!cookie) {
          const setCookieHeaders = response.headers['set-cookie'];
          if (setCookieHeaders && Array.isArray(setCookieHeaders)) {
            const extracted = setCookieHeaders
              .map((c: string) => {
                const match = c.match(/^([^=]+=[^;]+)/);
                return match ? match[1] : '';
              })
              .filter(Boolean);

            // 检查提取的 Cookie 中是否包含 SESSDATA
            const hasSessdata = extracted.some((c: string) => c.startsWith('SESSDATA='));
            if (hasSessdata) {
              cookie = extracted.join('; ');
            }
          }
        }

        // 如果 Cookie 中没有 SESSDATA，这不是真正的登录成功，
        // 可能是 B站 API 的异常响应，继续等待轮询
        if (!cookie || !cookie.includes('SESSDATA=')) {
          console.log('[bilibili] code=0 但无有效 SESSDATA，继续轮询');
          return { status: 'waiting' };
        }

        console.log('[bilibili] 登录成功，Cookie 长度:', cookie.length);
        return { status: 'success', cookie };
      }
      case 86101:
        return { status: 'waiting' };
      case 86090:
        return { status: 'scanned' };
      case 86038:
        return { status: 'expired' };
      default:
        console.warn('[bilibili] 未知登录状态码:', code);
        return { status: 'waiting' };
    }
  }
}