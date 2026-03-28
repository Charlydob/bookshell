export const gamesPaths = {
  root: (uid: string) => `v2/users/${uid}/games`,
  groups: (uid: string) => `v2/users/${uid}/games/gameGroups`,
  modes: (uid: string) => `v2/users/${uid}/games/games/modes`,
  matches: (uid: string) => `v2/users/${uid}/games/games/matches`,
  daily: (uid: string) => `v2/users/${uid}/games/gameModeDaily`,
  sandboxEvents: (uid: string) => `v2/users/${uid}/games/games/sandboxEvents`,
  sandboxWorlds: (uid: string) => `v2/users/${uid}/games/games/sandboxWorlds`,
};
