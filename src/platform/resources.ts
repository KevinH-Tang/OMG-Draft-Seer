function withBasePath(path: string, baseUrl: string): string {
  const normalizedPath = path.replace(/^\/+/, '')
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${normalizedBase}${normalizedPath}`
}

export function appResourceUrl(
  path: string,
  baseUrl = import.meta.env.BASE_URL,
): string {
  return withBasePath(path, baseUrl || '/')
}

export function localAbilityIconUrl(
  abilityId: number | undefined,
  shortName: string,
  isHero = false,
): string | undefined {
  if (isHero && abilityId !== undefined)
    return appResourceUrl(`/assets/hero-icons/${abilityId}.png`)
  if (abilityId === undefined) return undefined
  return appResourceUrl(`/assets/ability-icons/${abilityId}.png`)
}

export function remoteAbilityIconUrl(
  shortName: string,
  isHero = false,
): string {
  return isHero
    ? `https://cdn.datdota.com/images/miniheroes/${encodeURIComponent(shortName)}.png`
    : `https://cdn.datdota.com/images/ability/${encodeURIComponent(shortName)}.png`
}
