export const worldPaths = {
  root: (uid: string) => `v2/users/${uid}/world`,
  legacyTrips: (uid: string) => `v2/users/${uid}/trips`,
};
