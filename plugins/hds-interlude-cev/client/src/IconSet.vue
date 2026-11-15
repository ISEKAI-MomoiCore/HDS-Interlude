<script lang="ts">
const PATHS: Record<string, string> = {
  overview: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  desk: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm9.1 15.6L15.5 15.5M7.5 10.5h6M10.5 7.5v6',
  density: 'M4 20v-6M9.3 20V9M14.6 20V4M20 20v-9',
  config: 'M4 7.5h7M15 7.5h5M15 4.5v6M4 16.5h3M11 16.5h9M9 13.5v6',
}

export default { name: 'IconSet', props: { name: { type: String, required: true } }, render(this: any, h: any) {
  return h('path', { attrs: { d: PATHS[this.name] ?? PATHS.overview } })
} }
</script>
