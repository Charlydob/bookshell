export const MET_CATALOG = [
  { id: "strength_light", label: "Fuerza ligera", metValue: 3.5 },
  { id: "strength_moderate", label: "Fuerza moderada", metValue: 5.0 },
  { id: "strength_vigorous", label: "Fuerza intensa", metValue: 6.0 },
  { id: "hiit", label: "HIIT / circuito intenso", metValue: 8.0 },
  { id: "walking_moderate", label: "Caminar moderado", metValue: 3.5 },
  { id: "running_moderate", label: "Correr moderado", metValue: 9.0 },
  { id: "cycling_moderate", label: "Bicicleta moderada", metValue: 7.0 },
  { id: "rowing_moderate", label: "Remo moderado", metValue: 7.0 },
  { id: "elliptical_moderate", label: "Elíptica moderada", metValue: 5.0 },
  { id: "mobility_stretching", label: "Movilidad / estiramientos", metValue: 2.8 }
];

export function getMetCategoryById(metCategoryId) {
  const key = String(metCategoryId || "").trim();
  if (!key) return null;
  return MET_CATALOG.find((item) => item.id === key) || null;
}
