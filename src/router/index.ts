import { createRouter, createWebHistory } from 'vue-router'
import ComparisonView from '@/views/ComparisonView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'comparison',
      component: ComparisonView,
    },
  ],
})

export default router
