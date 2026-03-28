export const videosHubPaths = {
  root: (uid: string) => `v2/users/${uid}/videosHub`,
  videos: (uid: string) => `v2/users/${uid}/videosHub/videos`,
};
