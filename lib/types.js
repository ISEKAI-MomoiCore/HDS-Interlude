export const emptyStorySetting = () => ({
    character: { name: 'Unnamed character', profile: '' },
    user: { displayName: '', profile: '' },
    relationship: '', world: '', perspective: '', supportingCast: '', location: '',
    style: 'Realistic, restrained, and centered on ordinary life.',
    timezone: 'Asia/Shanghai',
});
export const emptyStoryState = () => ({ schemaVersion: 1, settingOverlay: { characterTraits: [] }, automation: {}, narrativeUpdateCount: 0 });
export const emptyParticipantState = () => ({
    openThreads: [], relationshipNotes: [], unreadMessageCount: 0, pendingReplyCount: 0,
});
