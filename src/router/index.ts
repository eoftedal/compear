import { createRouter, createWebHashHistory } from 'vue-router'
import ComparisonView from '@/views/ComparisonView.vue'
import TopicModelingView from '@/views/TopicModelingView.vue'
import StatsView from '@/views/StatsView.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'comparison',
      component: ComparisonView,
    },
    {
      path: '/topics',
      name: 'topics',
      component: TopicModelingView,
    },
    {
      path: '/stats',
      name: 'stats',
      component: StatsView,
    },
  ],
})

export default router
