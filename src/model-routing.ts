import type {
  ModelConfig, ModelProfile, ProviderConfig, ProviderMode, ProviderResponseFormat,
} from './narrator'
import type { AlterSystemConfig } from './types'

export type ModelTask = 'main' | 'compaction' | 'timeline' | 'alter' | 'embedding' | 'stickers' | 'vision'

export interface ResolvedModelTarget {
  providerId: string
  model: string
  maxTokens?: number
  timeout?: number
  responseFormat?: ProviderResponseFormat
}

export interface ResolvedModelRoute {
  task: ModelTask
  target: ResolvedModelTarget
  /** Ordered static candidates. Runtime cooldown may temporarily reorder them. */
  providers: ProviderConfig[]
  assigned: boolean
  available: boolean
  reason: 'assigned-provider' | 'model-profile' | 'task-config' | 'legacy-fallback' | 'disabled' | 'unavailable'
}

export interface ModelRoutingTable {
  providers: ProviderConfig[]
  main: ResolvedModelRoute
  compaction: ResolvedModelRoute
  timeline: ResolvedModelRoute
  alter: ResolvedModelRoute
  embedding: ResolvedModelRoute
  stickers: ResolvedModelRoute
  vision: ResolvedModelRoute
}

export const ZHIPU_OFFICIAL_CHAT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

export function resolveModelRouting(config: ModelConfig, alterConfig?: AlterSystemConfig): ModelRoutingTable {
  const providers = configuredProviders(config)
  const mainTarget = resolveModelTarget(config, effectiveMainModelId(config), '', '')
  const compact = config.compaction
  const compactionTarget = resolveModelTarget(config, compact?.modelId || effectiveMainModelId(config), compact?.providerId, compact?.model)
  const alterTarget = resolveModelTarget(config, alterConfig?.modelId || effectiveMainModelId(config), alterConfig?.providerId, alterConfig?.model)
  const embedding = config.embedding
  const embeddingTarget = resolveModelTarget(config, embedding?.modelId, embedding?.providerId, embedding?.model)

  const main = resolveRoute('main', providers, mainTarget, true)
  const compaction = compact?.enabled === false
    ? disabledRoute('compaction', compactionTarget)
    : resolveRoute('compaction', providers, compactionTarget, true)
  return {
    providers,
    main,
    compaction,
    timeline: { ...compaction, task: 'timeline' },
    alter: alterConfig?.enabled === false
      ? disabledRoute('alter', alterTarget)
      : resolveRoute('alter', providers, alterTarget, true),
    embedding: embedding?.enabled
      ? resolveRoute('embedding', providers, embeddingTarget, false)
      : disabledRoute('embedding', embeddingTarget),
    stickers: resolveAssignedOnlyRoute('stickers', providers),
    vision: resolveAssignedOnlyRoute('vision', providers),
  }
}

export function resolveModelTarget(config: ModelConfig, modelId: string | undefined, providerId: string | undefined, model: string | undefined): ResolvedModelTarget {
  const selected = modelId?.trim()
    ? config.models?.find(entry => entry.enabled !== false && entry.id === modelId.trim())
    : undefined
  return {
    providerId: selected?.providerId?.trim() || providerId?.trim() || '',
    model: selected?.model?.trim() || model?.trim() || '',
    maxTokens: selected?.maxTokens,
    timeout: selected?.timeout,
    responseFormat: selected?.responseFormat,
  }
}

export function effectiveMainModelId(config: ModelConfig) {
  const explicit = config.mainModelId?.trim()
  if (explicit) return explicit
  const available = enabledModelProfiles(config)
  return available.length === 1 ? available[0].id : ''
}

export function configuredProviders(config: ModelConfig): ProviderConfig[] {
  return config.providers.map(normalizeProvider)
}

export function usesRemoteProviders(config: ModelConfig) {
  const routing = resolveModelRouting(config)
  return routing.main.available || routing.compaction.available || routing.embedding.available
    || routing.stickers.available || routing.vision.available
}

export function providerKey(provider: ProviderConfig) {
  return provider.id?.trim() || `${provider.label.trim()}:${provider.model.trim()}:${provider.endpoint.trim()}`
}

export function isAssignedTo(provider: ProviderConfig, task: Exclude<ModelTask, 'timeline'>) {
  return task === 'main' ? provider.useForMain === true
    : task === 'compaction' ? provider.useForCompaction === true
      : task === 'alter' ? provider.useForAlter === true
        : task === 'embedding' ? provider.useForEmbedding === true
          : task === 'stickers' ? provider.useForStickers === true
            : provider.useForVision === true
}

export function formatModelRouting(table: ModelRoutingTable) {
  const tasks: ModelTask[] = ['main', 'compaction', 'timeline', 'alter', 'embedding', 'stickers', 'vision']
  return tasks.map(task => {
    const route = table[task]
    const provider = route.providers[0]
    const model = route.assigned ? provider?.model : route.target.model || provider?.model
    return `${task}=${route.available ? `${provider?.label || provider?.id}/${model || '未指定'}` : '未配置'}[${route.reason}]`
  }).join(' ')
}

function resolveRoute(task: Exclude<ModelTask, 'timeline' | 'stickers' | 'vision'>, providers: ProviderConfig[], target: ResolvedModelTarget, requireChatModel: boolean): ResolvedModelRoute {
  // Messages API has no embeddings endpoint. Keep vector traffic on its own compatible connection.
  if (task === 'embedding') providers = providers.filter(provider => provider.protocol !== 'anthropic-messages' && provider.protocol !== 'gemini-interactions')
  const assigned = providers.filter(provider => provider.enabled && provider.endpoint && provider.model && isAssignedTo(provider, task))
  if (assigned.length) return { task, target, providers: assigned, assigned: true, available: true, reason: 'assigned-provider' }

  const targeted = target.providerId
    ? providers.filter(provider => provider.enabled && provider.endpoint && (provider.id === target.providerId || providerKey(provider) === target.providerId))
    : []
  const targetedUsable = targeted.filter(provider => !!(target.model || provider.model))
  if (targetedUsable.length) {
    const profileSelected = !!target.providerId && !!target.model
    return { task, target, providers: targetedUsable, assigned: false, available: true, reason: profileSelected ? 'model-profile' : 'task-config' }
  }

  // Keep legacy installations operational, but never treat an embedding-only
  // connection as a chat fallback. Explicit task assignment remains preferred.
  const fallback = providers.filter(provider => provider.enabled && provider.endpoint
    && (!requireChatModel || !!provider.model)
    && !isExclusivelyNonChat(provider))
  if (fallback.length) return { task, target, providers: fallback, assigned: false, available: true, reason: 'legacy-fallback' }
  return { task, target, providers: [], assigned: false, available: false, reason: 'unavailable' }
}

function resolveAssignedOnlyRoute(task: 'stickers' | 'vision', providers: ProviderConfig[]): ResolvedModelRoute {
  const assigned = providers.filter(provider => provider.enabled && provider.endpoint && provider.model && isAssignedTo(provider, task))
  return {
    task,
    target: { providerId: assigned[0]?.id ?? '', model: assigned[0]?.model ?? '' },
    providers: assigned,
    assigned: assigned.length > 0,
    available: assigned.length > 0,
    reason: assigned.length ? 'assigned-provider' : 'unavailable',
  }
}

function disabledRoute(task: ModelTask, target: ResolvedModelTarget): ResolvedModelRoute {
  return { task, target, providers: [], assigned: false, available: false, reason: 'disabled' }
}

function isExclusivelyNonChat(provider: ProviderConfig) {
  const chat = provider.useForMain || provider.useForCompaction || provider.useForAlter
  const sidecar = provider.useForEmbedding || provider.useForStickers || provider.useForVision
  return !!sidecar && !chat
}

function enabledModelProfiles(config: ModelConfig): ModelProfile[] {
  return (config.models ?? []).filter(entry => entry.enabled !== false && entry.id.trim() && entry.providerId.trim() && entry.model.trim())
}

function normalizeProvider(provider: ProviderConfig): ProviderConfig {
  const zhipuOfficial = provider.mode === 'zhipu-official'
  const deepseekOfficial = provider.mode === 'deepseek-official'
  const geminiInteractions = provider.mode === 'gemini-interactions'
  const officialEndpoint = presetEndpoint(provider.mode, provider.dashscopeRegion)
  const protocol = geminiInteractions ? 'gemini-interactions'
    : !officialEndpoint && provider.protocol === 'anthropic-messages' ? 'anthropic-messages'
    : 'chat-completions'
  return {
    ...provider,
    id: provider.id?.trim() || `${provider.label?.trim() || 'provider'}:${provider.model?.trim() || ''}`,
    label: provider.label?.trim() || (zhipuOfficial ? 'Zhipu Official' : deepseekOfficial ? 'DeepSeek Official' : 'Model connection'),
    protocol,
    anthropicCache: provider.anthropicCache === true,
    endpoint: officialEndpoint || normalizeProtocolEndpoint(provider.endpoint, protocol),
    apiKey: provider.apiKey ?? '', model: provider.model ?? '',
    proxyAgent: provider.proxyAgent?.trim() || '',
    temperature: provider.temperature ?? (zhipuOfficial ? 1 : 0.8),
    topP: provider.topP ?? (zhipuOfficial ? 0.95 : 1),
    maxTokens: provider.maxTokens ?? 4096,
    timeout: provider.timeout ?? (zhipuOfficial ? 45_000 : 60_000),
    responseFormat: provider.responseFormat ?? 'json-object',
    extraHeaders: provider.extraHeaders ?? '', extraBody: provider.extraBody ?? '',
    zhipuOfficial,
    reasoningEffort: provider.reasoningEffort ?? 'high',
    deepseekOfficial,
    deepseekThinking: deepseekOfficial
      ? provider.deepseekThinking === 'enabled' ? 'enabled' : 'disabled'
      : provider.deepseekThinking === 'enabled' || provider.deepseekThinking === 'disabled' ? provider.deepseekThinking : 'inherit',
    deepseekReasoningEffort: provider.deepseekReasoningEffort ?? 'low',
    useForMain: provider.useForMain === true,
    useForCompaction: provider.useForCompaction === true,
    useForAlter: provider.useForAlter === true,
    useForEmbedding: provider.useForEmbedding === true,
    useForStickers: provider.useForStickers === true,
    useForVision: provider.useForVision === true,
  }
}

export function normalizeProtocolEndpoint(endpoint: string, protocol: ProviderConfig['protocol']) {
  const value = endpoint?.trim() || ''
  if (protocol === 'gemini-interactions') return value.replace(/\/(?:openai\/)?chat\/completions(?=\?|$)/, '/interactions')
  if (protocol !== 'anthropic-messages') return value.replace(/\/messages(?=\?|$)/, '/chat/completions')
  return value.replace(/\/chat\/completions(?=\?|$)/, '/messages')
}

function presetEndpoint(mode: ProviderMode | undefined, dashscopeRegion?: string) {
  if (mode === 'zhipu-official') return ZHIPU_OFFICIAL_CHAT_ENDPOINT
  if (mode === 'openai-official') return 'https://api.openai.com/v1/chat/completions'
  if (mode === 'deepseek-official') return 'https://api.deepseek.com/v1/chat/completions'
  if (mode === 'moonshot-official') return 'https://api.moonshot.cn/v1/chat/completions'
  if (mode === 'siliconflow-official') return 'https://api.siliconflow.cn/v1/chat/completions'
  if (mode === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions'
  if (mode === 'gemini-openai') return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
  if (mode === 'gemini-interactions') return 'https://generativelanguage.googleapis.com/v1beta/interactions'
  if (mode === 'dashscope-official') {
    if (dashscopeRegion === 'singapore') return 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
    if (dashscopeRegion === 'us') return 'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions'
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  }
  return ''
}
