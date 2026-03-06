import { computeAttribute } from './character-attributes.js';
import { computeSkillXP } from './character-skills.js';
import { computeLanguageXP } from './character-languages.js';

export function computeLevelFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const b = new Date(`${birthdate}T00:00:00`);
  if (!Number.isFinite(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function buildCharacterSheet(snapshot = {}, config = {}, range = 'week') {
  const attributeData = computeAttribute(snapshot, config, range);
  const skills = computeSkillXP(snapshot, config);
  const languages = computeLanguageXP(snapshot, config);
  const level = computeLevelFromBirthdate(config.birthdate);

  return {
    identity: {
      name: config.name || 'Aventurero',
      alias: config.alias || '',
      birthdate: config.birthdate || '',
      level,
      hasBirthdate: !!config.birthdate
    },
    range,
    attributes: attributeData.attributes,
    attributeMappings: attributeData.mappings,
    customAttributes: config.customAttributes || [],
    resources: attributeData.resources,
    world: attributeData.world,
    habits: attributeData.habits,
    skills,
    languages
  };
}
