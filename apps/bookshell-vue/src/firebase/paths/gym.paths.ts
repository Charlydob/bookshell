export const gymPaths = {
  root: (uid: string) => `v2/users/${uid}/gym`,
  gym: (uid: string) => `v2/users/${uid}/gym/gym`,
  exercises: (uid: string) => `v2/users/${uid}/gym/gym/exercises`,
  templates: (uid: string) => `v2/users/${uid}/gym/gym/templates`,
  workouts: (uid: string) => `v2/users/${uid}/gym/gym/workouts`,
  body: (uid: string) => `v2/users/${uid}/gym/gym/body`,
  cardio: (uid: string) => `v2/users/${uid}/gym/gym/cardio`,
};
