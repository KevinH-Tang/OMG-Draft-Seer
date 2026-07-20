export function localAbilityIconUrl(abilityId: number | undefined, shortName: string, isHero = false): string | undefined {
  if (isHero && abilityId !== undefined) return `/assets/hero-icons/${abilityId}.png`
  if (abilityId === undefined) return undefined
  return `/assets/ability-icons/${abilityId}.png`
}

export function remoteAbilityIconUrl(shortName: string, isHero = false): string {
  return isHero
    ? `https://cdn.datdota.com/images/miniheroes/${encodeURIComponent(shortName)}.png`
    : `https://cdn.datdota.com/images/ability/${encodeURIComponent(shortName)}.png`
}
