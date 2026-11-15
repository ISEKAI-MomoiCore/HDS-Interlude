/** D3a（解耦设计 §6）：私聊回合叙事编排——自 service.ts 迁出（行为不变，
 * D0 顺序特征测试为证）。service.flushBufferedNarrative 保留同名薄委托。
 * 平台交互全部经 PlatformAdapter 端口（svc.platformPort）；本文件不直接
 * 出现平台函数名。 */
export declare function executePrivateNarrativeTurn(svc: any, key: string, revision: number): Promise<void>;
/** D3b（解耦设计 §6）：群聊回合叙事编排——自 service.ts 迁出（行为不变）。
 * service.flushGroupTurnUnlocked 保留同名薄委托。群平台调用的端口化
 * （群能力/历史图片/群发/群反应）按设计归 D4；本文件现阶段经宿主调用。 */
export declare function executeGroupNarrativeTurn(svc: any, key: string, turn: any): Promise<void>;
