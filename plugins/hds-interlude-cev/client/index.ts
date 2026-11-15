import type { Context } from '@koishijs/client'
import { icons } from '@koishijs/client'
import HdsiApp from './src/HdsiApp.vue'

/** HDSI Console 客户端入口：单页面注册，内部自带侧栏。 */
export default function (ctx: Context): void {
  icons.register('hdsi-cev', {
    render: (h: any) => h('svg', {
      attrs: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      style: 'width:100%;height:100%',
    }, [
      h('rect', { attrs: { x: '4', y: '4', width: '10', height: '10', transform: 'rotate(45 9 9)' } }),
      h('path', { attrs: { d: 'M20 11v9h-9' } }),
      h('circle', { attrs: { cx: '20', cy: '8', r: '2' } }),
    ]),
  })
  ctx.page({
    id: 'hdsi-cev',
    path: '/hdsi-cev/:page*',
    name: 'HDS Interlude CEV',
    icon: 'hdsi-cev',
    order: 600,
    component: HdsiApp,
  })
}
