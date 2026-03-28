import type { RouteRecordRaw } from 'vue-router';
import { routeNames } from '@/app/router/route-names';
import AppShell from '@/app/layouts/AppShell.vue';
import AuthSignInView from '@/modules/auth/views/AuthSignInView.vue';
import BooksView from '@/modules/books/views/BooksView.vue';
import FinanceView from '@/modules/finance/views/FinanceView.vue';
import GamesView from '@/modules/games/views/GamesView.vue';
import GymView from '@/modules/gym/views/GymView.vue';
import HabitsView from '@/modules/habits/views/HabitsView.vue';
import MediaView from '@/modules/media/views/MediaView.vue';
import RecipesView from '@/modules/recipes/views/RecipesView.vue';
import VideosWorkspaceView from '@/modules/videos/views/VideosWorkspaceView.vue';
import VideosDayView from '@/modules/videos/views/VideosDayView.vue';
import VideosLinksView from '@/modules/videos/views/VideosLinksView.vue';
import VideosScriptView from '@/modules/videos/views/VideosScriptView.vue';
import VideosTeleprompterView from '@/modules/videos/views/VideosTeleprompterView.vue';
import VideosHubView from '@/modules/videos-hub/views/VideosHubView.vue';
import WorldView from '@/modules/world/views/WorldView.vue';

export const routes: RouteRecordRaw[] = [
  {
    path: '/auth',
    name: routeNames.auth,
    component: AuthSignInView,
    meta: { public: true, title: 'Acceso' },
  },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', redirect: { name: routeNames.books } },
      { path: 'books', name: routeNames.books, component: BooksView, meta: { title: 'Books', nav: true } },
      { path: 'videos', name: routeNames.videos, component: VideosWorkspaceView, meta: { title: 'Videos', nav: true } },
      { path: 'videos/script', name: routeNames.videosScript, component: VideosScriptView, meta: { title: 'Script' } },
      { path: 'videos/teleprompter', name: routeNames.videosTeleprompter, component: VideosTeleprompterView, meta: { title: 'Teleprompter' } },
      { path: 'videos/day', name: routeNames.videosDay, component: VideosDayView, meta: { title: 'Día' } },
      { path: 'videos/links', name: routeNames.videosLinks, component: VideosLinksView, meta: { title: 'Links' } },
      { path: 'videos-hub', name: routeNames.videosHub, component: VideosHubView, meta: { title: 'Videos Hub', nav: true } },
      { path: 'recipes', name: routeNames.recipes, component: RecipesView, meta: { title: 'Recipes', nav: true } },
      { path: 'habits', name: routeNames.habits, component: HabitsView, meta: { title: 'Habits', nav: true } },
      { path: 'games', name: routeNames.games, component: GamesView, meta: { title: 'Games', nav: true } },
      { path: 'media', name: routeNames.media, component: MediaView, meta: { title: 'Media', nav: true } },
      { path: 'world', name: routeNames.world, component: WorldView, meta: { title: 'World', nav: true } },
      { path: 'finance', name: routeNames.finance, component: FinanceView, meta: { title: 'Finance', nav: true } },
      { path: 'gym', name: routeNames.gym, component: GymView, meta: { title: 'Gym', nav: true } },
    ],
  },
];
