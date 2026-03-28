<template>
  <section class="base-card">
    <slot />
  </section>
</template>

<style scoped>
.base-card {
  padding: var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
</style>
