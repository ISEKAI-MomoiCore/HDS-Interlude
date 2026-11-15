import { h } from 'vue'
import type { Context } from '@koishijs/client'
import { icons } from '@koishijs/client'
import HdsiApp from './src/HdsiApp.vue'
import './src/console.css'

/** HDSI Console 客户端入口：单页面注册，内部自带侧栏。 */
export default function (ctx: Context): void {
  icons.register('hdsi', {
    render: () => h('svg', {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      width: 24, height: 24, style: 'width:24px;height:24px;max-width:100%;display:block;margin:auto;flex:none',
    }, [
      h('rect', { x: '4', y: '4', width: '10', height: '10', transform: 'rotate(45 9 9)' }),
      h('path', { d: 'M20 11v9h-9' }),
      h('circle', { cx: '20', cy: '8', r: '2' }),
    ]),
  })
  ctx.page({
    id: 'hdsi',
    path: '/hdsi/:page*',
    name: 'HDS Interlude',
    icon: 'hdsi',
    order: 600,
    component: HdsiApp,
  })
}
