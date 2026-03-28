<template>
  <div class="app-shell">
    <header class="app-shell__header">
      <div>
        <p class="eyebrow">Bookshell Vue Rewrite</p>
        <h1>{{ route.meta.title ?? 'Bookshell' }}</h1>
      </div>
    </header>

    <main class="app-shell__main">
      <RouterView />
    </main>

    <BottomNav />
  </div>
</template>

<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router';
import BottomNav from '@/shared/components/navigation/BottomNav.vue';

const route = useRoute();
</script>
