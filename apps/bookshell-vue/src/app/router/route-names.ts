export const routeNames = {
  auth: 'auth',
  books: 'books',
  videos: 'videos',
  videosScript: 'videos-script',
  videosTeleprompter: 'videos-teleprompter',
  videosDay: 'videos-day',
  videosLinks: 'videos-links',
  videosHub: 'videos-hub',
  recipes: 'recipes',
  habits: 'habits',
  games: 'games',
  media: 'media',
  world: 'world',
  finance: 'finance',
  gym: 'gym',
} as const;

export type AppRouteName = (typeof routeNames)[keyof typeof routeNames];
