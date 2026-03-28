export const videosPaths = {
  root: (uid: string) => `v2/users/${uid}/videos`,
  videos: (uid: string) => `v2/users/${uid}/videos/videos`,
  videoLog: (uid: string) => `v2/users/${uid}/videos/videoLog`,
  workLog: (uid: string) => `v2/users/${uid}/videos/videoWorkLog`,
  links: (uid: string) => `v2/users/${uid}/videos/links`,
  books: (uid: string) => `v2/users/${uid}/videos/books`,
  quoteBooks: (uid: string) => `v2/users/${uid}/videos/quoteBooks`,
  categoryGroups: (uid: string) => `v2/users/${uid}/videos/categoryGroups`,
};
