export const habitsPaths = {
  root: (uid: string) => `v2/users/${uid}/habits`,
  habits: (uid: string) => `v2/users/${uid}/habits/habits`,
  checks: (uid: string) => `v2/users/${uid}/habits/habitChecks`,
  sessions: (uid: string) => `v2/users/${uid}/habits/habitSessions`,
  counts: (uid: string) => `v2/users/${uid}/habits/habitCounts`,
  groups: (uid: string) => `v2/users/${uid}/habits/habitGroups`,
  prefs: (uid: string) => `v2/users/${uid}/habits/habitPrefs`,
  compare: (uid: string) => `v2/users/${uid}/habits/habitsCompareSettings`,
  schedule: (uid: string) => `v2/users/${uid}/habits/habitsSchedule`,
  activeSessions: (uid: string) => `v2/users/${uid}/habits/habits/activeSessions`,
};
