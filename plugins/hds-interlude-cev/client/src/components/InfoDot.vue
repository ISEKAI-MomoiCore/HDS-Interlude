<script lang="ts">
/** 信息提示组件：值含义 + 值域文档，点击 ⓘ 展开/收起。 */
export default {
  name: 'InfoDot',
  props: {
    info: { type: String, default: '' },
    range: { type: String, default: '' },
  },
  data() {
    return { open: false }
  },
}
</script>

<template>
  <span class="info-dot" @click.stop="open = !open">
    <svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
    <span v-if="open" class="tip">
      <span v-if="info" class="tip-info">{{ info }}</span>
      <span v-if="range" class="tip-range">值域：{{ range }}</span>
    </span>
  </span>
</template>

<style scoped>
.info-dot { position: relative; display: inline-flex; align-items: center; cursor: pointer; opacity: .35; flex-shrink: 0; margin-left: 5px; }
.info-dot:hover { opacity: .8; }
.glyph { width: 13px; height: 13px; }
.tip { position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%); z-index: 10; min-width: 200px; max-width: 340px; background: rgba(20,22,28,.96); color: #ece6d8; font-size: 11.5px; line-height: 1.55; padding: 8px 12px; border-left: 2.5px solid #ff8a58; white-space: normal; text-align: left; box-shadow: -8px 10px 20px -10px rgba(0,0,0,.5); pointer-events: none; }
.tip::before { content: ""; position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); border: 5px solid transparent; border-bottom-color: rgba(20,22,28,.96); }
.tip-info { display: block; }
.tip-range { display: block; opacity: .6; margin-top: 4px; font-family: 'Cascadia Code', monospace; font-size: 10.5px; }
</style>
