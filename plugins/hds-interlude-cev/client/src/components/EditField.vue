<script lang="ts">
/** 可编辑字段：文本/数字/布尔/选择，带 ⓘ 值域提示。 */
import InfoDot from './InfoDot.vue'

export default {
  name: 'EditField',
  components: { InfoDot },
  props: {
    label: { type: String, required: true },
    modelValue: { type: [String, Number, Boolean], default: '' },
    type: { type: String, default: 'text' }, // text | number | boolean | select
    options: { type: Array as () => Array<{ value: string, label: string }>, default: () => [] },
    placeholder: { type: String, default: '' },
    info: { type: String, default: '' },
    range: { type: String, default: '' },
    min: { type: Number },
    max: { type: Number },
    textarea: { type: Boolean, default: false },
    secret: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  data() {
    return { visible: false }
  },
  computed: {
    currentValue: {
      get() { return this.modelValue },
      set(val: any) { this.$emit('update:modelValue', val) },
    },
  },
  methods: {
    onBool() { this.$emit('update:modelValue', !this.modelValue) },
  },
}
</script>

<template>
  <div class="field">
    <label class="field-label">
      {{ label }}
      <InfoDot v-if="info || range" :info="info" :range="range" />
    </label>
    <div class="field-input">
      <textarea v-if="textarea" :value="String(modelValue ?? '')" :placeholder="placeholder"
        class="input area" @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
      <select v-else-if="type === 'select'" :value="String(modelValue)" class="input" @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button v-else-if="type === 'boolean'" class="toggle" :class="{ on: modelValue }" @click="onBool">
        <span class="toggle-dot" />
      </button>
      <input v-else-if="type === 'number'" type="number" :value="Number(modelValue)" :min="min" :max="max"
        class="input" @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" />
      <input v-else :type="secret && !visible ? 'password' : 'text'" :value="String(modelValue ?? '')"
        :placeholder="placeholder" class="input" @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
      <button v-if="secret" class="reveal" @click="visible = !visible">{{ visible ? '隐藏' : '显示' }}</button>
    </div>
  </div>
</template>

<style scoped>
.field { margin-bottom: 10px; }
.field-label { display: flex; align-items: center; gap: 4px; font-size: 11.5px; opacity: .55; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; margin-bottom: 4px; }
.field-input { display: flex; gap: 6px; align-items: center; }
.input { flex: 1; background: rgba(128,128,128,.08); border: 1px solid rgba(128,128,128,.2); border-radius: 0; padding: 6px 10px; font-size: 13px; color: inherit; font-family: inherit; outline: none; min-width: 0; }
.input:focus { border-color: var(--fg3, #3b82f6); }
.input.area { min-height: 60px; resize: vertical; font-family: 'Cascadia Code', monospace; font-size: 12px; line-height: 1.5; }
.toggle { width: 36px; height: 20px; border: 1.5px solid rgba(128,128,128,.3); border-radius: 0; background: transparent; cursor: pointer; position: relative; padding: 0; flex-shrink: 0; }
.toggle-dot { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; background: rgba(128,128,128,.4); transition: .15s; }
.toggle.on { border-color: #14b8a6; }
.toggle.on .toggle-dot { left: 18px; background: #14b8a6; }
.reveal { font-size: 11px; padding: 4px 8px; border: 1px solid rgba(128,128,128,.2); background: transparent; color: inherit; cursor: pointer; white-space: nowrap; }
</style>
