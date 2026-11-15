/** Task retirement and confirmed-fact retention share the existing story generations.
 * Pause retires work; content reset also retires already-returning receipts.
 * Optional generation readers keep focused adapter hosts usable outside the service. */
export interface StoryTaskHost {
    databaseResetting?: boolean;
    desktopRuntimePhase?: string;
    disposed?: boolean;
    deliveryGeneration?: (storyId: string) => string;
    taskGeneration?: (storyId: string) => string;
}
export declare function captureStoryTask(host: StoryTaskHost, storyId: string): {
    contentCurrent: () => boolean;
    taskCurrent: () => boolean;
};
