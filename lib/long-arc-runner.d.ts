import { type LongArcGuidanceRecord, type LongArcProgressRow } from './long-arc';
import type { InterludeStory, ScriptEntry } from './types';
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function longHorizonSweep(svc: any, story: InterludeStory, _now?: Date): Promise<void>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function longHorizonProgress(svc: any, storyId: string): Promise<LongArcProgressRow>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function saveLongHorizonProgress(svc: any, progress: LongArcProgressRow): Promise<void>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function getActiveLongArcGuidance(svc: any, storyId: string): Promise<LongArcGuidanceRecord>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function ensureLongHorizonGuidanceLoaded(svc: any, storyId: string): Promise<void>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function longHorizonGenerate(svc: any, story: InterludeStory, evidence: ScriptEntry[], currentScore: number, progress: LongArcProgressRow): Promise<void>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function longHorizonInput(svc: any, story: InterludeStory, eligible: ScriptEntry[]): Promise<{
    storySetting: {
        characterName: string;
        characterProfile: string;
        userProfile: string;
        relationship: string;
        world: string;
        perspective: string;
    };
    overlay: import("./types").StorySettingOverlay;
    currentArcs: {
        id: any;
        summary: string;
    }[];
    participants: {
        id: any;
        displayName: any;
        relationship: string;
        state: any;
    }[];
    durableFacts: {
        scope: any;
        content: string;
        importance: any;
        confidence: any;
    }[];
    activeGuidance: {
        version: any;
        title: any;
        direction: any;
        premise: any;
        currentStage: any;
        developmentPhase: any;
        latentTension: any;
        firstExpression: any;
        responseBranches: any;
    };
    weightedScore: {
        total: any;
        privateCount: any;
        privateScore: any;
        groupCount: any;
        groupScore: any;
        unknownCount: any;
    };
    recentScript: any;
    keyEvidence: {
        id: number;
        kind: string;
        content: string;
    }[];
    historicalEvidence: {
        id: number;
        kind: string;
        content: string;
    }[];
    intensity: any;
    privacy: {
        shareParticipantDetails: any;
        participantScopedEvidenceIncluded: any;
        otherParticipantEvidenceExcluded: boolean;
    };
}>;
/** P6 自 service.ts 后台外设区迁出（2026-10-29），行为不变；宿主经 service 同名委托传入。 */
export declare function longHorizonPromptProjection(svc: any, storyId: string): string;
