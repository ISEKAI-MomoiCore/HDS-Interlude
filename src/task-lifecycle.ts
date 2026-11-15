/** Task retirement and confirmed-fact retention share the existing story generations.
 * Pause retires work; content reset also retires already-returning receipts.
 * Optional generation readers keep focused adapter hosts usable outside the service. */
export interface StoryTaskHost {
  databaseResetting?: boolean
  desktopRuntimePhase?: string
  disposed?: boolean
  deliveryGeneration?: (storyId: string) => string
  taskGeneration?: (storyId: string) => string
}

export function captureStoryTask(host: StoryTaskHost, storyId: string) {
  const contentGeneration = host.deliveryGeneration?.(storyId)
  const taskGeneration = host.taskGeneration?.(storyId)
  const contentCurrent = () => !host.databaseResetting && !host.disposed
    && (contentGeneration === undefined || host.deliveryGeneration?.(storyId) === contentGeneration)
  const taskCurrent = () => contentCurrent() && host.desktopRuntimePhase !== 'paused'
    && (taskGeneration === undefined || host.taskGeneration?.(storyId) === taskGeneration)
  return { contentCurrent, taskCurrent }
}
