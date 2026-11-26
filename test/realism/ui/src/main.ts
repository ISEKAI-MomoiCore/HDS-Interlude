import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import OverviewView from './views/OverviewView.vue'
import RunnerView from './views/RunnerView.vue'
import ReviewView from './views/ReviewView.vue'
import CompareView from './views/CompareView.vue'
import SettingsView from './views/SettingsView.vue'
import { startPolling } from './store'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: OverviewView },
    { path: '/run', component: RunnerView },
    { path: '/review', component: ReviewView },
    { path: '/compare', component: CompareView },
    { path: '/settings', component: SettingsView },
  ],
})

createApp(App).use(router).mount('#app')
startPolling()
