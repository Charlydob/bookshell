import { ref } from 'vue';

export function useAsyncState() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function run<T>(task: () => Promise<T>) {
    loading.value = true;
    error.value = null;
    try {
      return await task();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, run };
}
