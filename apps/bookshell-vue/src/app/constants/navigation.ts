import { routeNames } from '@/app/router/route-names';

export const primaryNavigation = [
  { label: 'Books', icon: '📖', to: { name: routeNames.books } },
  { label: 'Videos', icon: '📹', to: { name: routeNames.videos } },
  { label: 'Hub', icon: '🎬', to: { name: routeNames.videosHub } },
  { label: 'Recipes', icon: '🍳', to: { name: routeNames.recipes } },
  { label: 'Habits', icon: '✅', to: { name: routeNames.habits } },
  { label: 'Games', icon: '🎮', to: { name: routeNames.games } },
  { label: 'Media', icon: '🎞️', to: { name: routeNames.media } },
  { label: 'World', icon: '🌍', to: { name: routeNames.world } },
  { label: 'Finance', icon: '€', to: { name: routeNames.finance } },
  { label: 'Gym', icon: '🏋️', to: { name: routeNames.gym } },
] as const;
