<template>
  <BaseCard class="stack">
    <h2>{{ title }}</h2>
    <p class="muted">{{ description }}</p>
  </BaseCard>
</template>

<script setup lang="ts">
import BaseCard from '@/shared/components/ui/BaseCard.vue';

defineProps<{
  title: string;
  description: string;
}>();
</script>
