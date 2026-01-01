import { createRouter, createWebHistory } from 'vue-router'
import ComparisonView from '@/views/ComparisonView.vue'
import TopicModelingView from '@/views/TopicModelingView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
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
  ],
})

export default router
