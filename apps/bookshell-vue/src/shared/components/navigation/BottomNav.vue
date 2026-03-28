<template>
  <nav class="bottom-nav">
    <RouterLink
      v-for="item in primaryNavigation"
      :key="item.label"
      :to="item.to"
      class="bottom-nav__item"
      active-class="is-active"
    >
      <span>{{ item.icon }}</span>
      <small>{{ item.label }}</small>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { primaryNavigation } from '@/app/constants/navigation';
</script>

<style scoped>
.bottom-nav {
  position: fixed;
  inset: auto 1rem 1rem;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(255, 250, 242, 0.92);
  border: 1px solid var(--color-border);
  border-radius: 20px;
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(14px);
}

.bottom-nav__item {
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  padding: 0.55rem 0.2rem;
  color: var(--color-muted);
  border-radius: 14px;
}

.bottom-nav__item.is-active {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

@media (min-width: 900px) {
  .bottom-nav {
    grid-template-columns: repeat(10, minmax(0, 1fr));
    max-width: calc(var(--shell-width) - 2rem);
    margin: 0 auto;
  }
}
</style>
