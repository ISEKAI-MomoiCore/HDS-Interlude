<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue'

defineOptions({ name: 'InfoDot' })
defineProps<{ info?: string, range?: string }>()
const open = ref(false)
const tooltip = ref<HTMLElement | null>(null)
const tooltipId = useId()
let visibilityRequest = 0
onMounted(() => { if (typeof window !== 'undefined') window.addEventListener('scroll', close, true) })
onUnmounted(() => { if (typeof window !== 'undefined') window.removeEventListener('scroll', close, true) })
const position = ref({ left: '0px', top: '0px', maxWidth: '320px' })
async function show(event: Event) {
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  const width = Math.min(320, window.innerWidth - 32)
  const below = window.innerHeight - rect.bottom > 140
  position.value = {
    left: `${Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))}px`,
    top: `${below ? rect.bottom + 8 : Math.max(16, rect.top - 140)}px`, maxWidth: `${width}px`,
  }
  open.value = true
  const request = ++visibilityRequest
  await nextTick()
  if (!open.value || request !== visibilityRequest || !tooltip.value) return
  const height = tooltip.value.getBoundingClientRect().height
  position.value.top = `${Math.max(8, Math.min(Number.parseFloat(position.value.top), window.innerHeight - height - 8))}px`
}
function close() { open.value = false; visibilityRequest++ }
</script>

<template>
  <button type="button" class="info-dot" aria-label="查看说明（悬停或按住）" :aria-expanded="open" :aria-describedby="open ? tooltipId : undefined"
    @mouseenter="show" @mouseleave="close" @pointerdown.stop="show" @pointerup="close" @pointercancel="close"
    @focus="show" @blur="close" @click.stop="close" @keydown.esc="close"
    @keydown.space.prevent="show" @keydown.enter.prevent="show" @keyup.space="close" @keyup.enter="close">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
    </svg>
    <span v-if="open" :id="tooltipId" ref="tooltip" class="hdsi-tip" role="tooltip" :style="position">
      <span v-if="info">{{ info }}</span><span v-if="range" class="tip-range">范围：{{ range }}</span>
    </span>
  </button>
</template>

<style scoped>
.info-dot { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; min-height: 22px !important; flex: 0 0 22px; padding: 3px; margin-left: 3px; border: 0; background: transparent; color: inherit; opacity: .65; cursor: help; touch-action: manipulation; }
.info-dot:hover, .info-dot:focus-visible { opacity: 1; }
.info-dot svg { width: 14px; height: 14px; display: block; flex: none; }
.hdsi-tip { position: fixed; z-index: 5000; width: 320px; background: var(--k-card-bg, #24272e); color: var(--k-text-normal, #ece6d8); font-size: 12px; line-height: 1.7; font-weight: 400; padding: 12px 14px; border: 1px solid var(--k-color-divider, #676970); border-radius: 8px; white-space: normal; text-align: left; box-shadow: 0 8px 28px #0003; pointer-events: none; overflow-wrap: anywhere; }
.tip-range { display: block; opacity: .8; margin-top: 6px; }
</style>
