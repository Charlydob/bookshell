<template>
  <div class="stack">
    <BaseEmptyState
      title="Acceso pendiente"
      description="La autenticación se implementará aquí con Firebase Auth, sin mezclar UI con inicialización global."
    />
  </div>
</template>

<script setup lang="ts">
import BaseEmptyState from '@/shared/components/ui/BaseEmptyState.vue';
</script>
