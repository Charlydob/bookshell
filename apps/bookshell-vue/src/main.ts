import { createApp } from 'vue';
import App from './App.vue';
import { pinia } from '@/app/providers/pinia';
import { router } from '@/app/providers/router';
import '@/app/styles/tokens.css';
import '@/app/styles/base.css';
import '@/app/styles/utilities.css';

createApp(App).use(pinia).use(router).mount('#app');
