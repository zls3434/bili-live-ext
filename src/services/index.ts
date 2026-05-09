/**
 * @file src/services/index.ts
 * @description 业务服务层入口文件
 *
 * 主要功能：
 * - 统一导出所有业务服务模块
 * - 提供登录、会话管理、API 请求等服务
 *
 * 在项目中的角色：
 * 作为服务层的中转站，方便其他模块统一导入服务
 *
 * @author zls3434
 * @date 2026-04-30
 * @modification 2026-04-30 zls3434 更新导出，添加所有核心业务服务
 * @modification 2026-07-14 zls3434 重构 BiliApiService 为委托模式，
 *           新增 BaseBiliApiService 和按业务领域拆分的子服务导出
 */

export { BiliLoginService } from './biliLogin';
export { SessionManager } from './sessionManager';
export { BiliApiService } from './biliApi';
export { DanmakuService } from './danmakuService';
export { ProxyServer } from './proxyServer';

export { BaseBiliApiService } from './baseBiliApi';
export { UserApiService } from './userApi';
export { FollowApiService } from './followApi';
export { FavoriteApiService } from './favoriteApi';
export { RecommendApiService } from './recommendApi';
export { VideoApiService } from './videoApi';
export { LiveApiService } from './liveApi';
export { DanmakuApiService } from './danmakuApi';
export { HistoryApiService } from './historyApi';
export { ViewHistoryManager } from './viewHistoryManager';