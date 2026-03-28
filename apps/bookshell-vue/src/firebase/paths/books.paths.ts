export const booksPaths = {
  root: (uid: string) => `v2/users/${uid}/books`,
  books: (uid: string) => `v2/users/${uid}/books/books`,
  readingLog: (uid: string) => `v2/users/${uid}/books/readingLog`,
  links: (uid: string) => `v2/users/${uid}/books/links`,
  metaGenres: (uid: string) => `v2/users/${uid}/books/meta/genres`,
};
