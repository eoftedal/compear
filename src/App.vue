<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div id="app">
    <nav class="main-nav">
      <div class="nav-container">
        <h1 class="nav-logo">Compear 🍐</h1>
        <div class="nav-links">
          <RouterLink to="/" class="nav-link">Comparison</RouterLink>
          <RouterLink to="/topics" class="nav-link">Topic Modeling</RouterLink>
        </div>
      </div>
    </nav>
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
    'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main-nav {
  background: #ffffff;
  border-bottom: 2px solid #e9ecef;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-logo {
  font-size: 1.5rem;
  font-weight: 700;
  color: #007bff;
  margin: 0;
}

.nav-links {
  display: flex;
  gap: 2rem;
}

.nav-link {
  text-decoration: none;
  color: #495057;
  font-weight: 500;
  font-size: 1rem;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  transition: all 0.2s;
}

.nav-link:hover {
  background: #f8f9fa;
  color: #007bff;
}

.nav-link.router-link-active {
  color: #007bff;
  background: #e7f3ff;
}

.main-content {
  flex: 1;
  background: #f8f9fa;
}
</style>
