export const recipesPaths = {
  root: (uid: string) => `v2/users/${uid}/recipes`,
  recipes: (uid: string) => `v2/users/${uid}/recipes/recipes`,
  nutrition: (uid: string) => `v2/users/${uid}/recipes/nutrition`,
  products: (uid: string) => `v2/users/${uid}/recipes/foodItems`,
};
