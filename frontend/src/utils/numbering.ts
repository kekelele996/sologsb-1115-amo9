import type { CollectSite, Specimen } from '../types'
import { buildSpecimenCode, collectUsedCodes, parseSpecimenCode } from './codec'

/**
 * 按目标前缀重编一批标本的在册编号（纯函数，不触库）。
 * - 已是目标前缀的标本原样返回（引用不变），重跑不再变（幂等）；
 * - 换前缀时保持「年份-流水号」，撞号则顺延；
 * - 换下的旧号记入 formerCodes，旧号永久留存、发新号时一并避开。
 * used 为全表现用编号 + 曾用号集合，会随重编同步更新。
 */
export function renumberRows(
  specimens: Specimen[],
  targetPrefix: string,
  used: Set<string>
): { rows: Specimen[]; changed: number } {
  const rows: Specimen[] = []
  let changed = 0
  for (const specimen of specimens) {
    const parsed = parseSpecimenCode(specimen.code)
    // 已是目标前缀 → 不动
    if (parsed && parsed.siteCode === targetPrefix) {
      rows.push(specimen)
      continue
    }
    const year = parsed?.year ?? specimen.collectDate.slice(0, 4)
    let serial = parsed?.serial ?? 1
    let candidate = buildSpecimenCode(targetPrefix, year, serial)
    used.delete(specimen.code) // 自身现号将被替换，不参与撞号
    while (used.has(candidate)) {
      serial += 1
      candidate = buildSpecimenCode(targetPrefix, year, serial)
    }
    used.add(candidate)
    rows.push({
      ...specimen,
      code: candidate,
      formerCodes: Array.from(new Set([...(specimen.formerCodes ?? []), specimen.code].filter(Boolean)))
    })
    changed += 1
  }
  return { rows, changed }
}

/**
 * 全量对账（纯函数）：让每份在册标本的编号前缀与所属采集地当前代码一致。
 * 返回需要落库的重编行；采集地已撤且未合并（siteId 找不到）的标本保留原号。
 * 幂等：前缀已一致的标本不在返回结果中。
 */
export function reconcileRows(specimens: Specimen[], sites: CollectSite[]): Specimen[] {
  const siteById = new Map(sites.map((site) => [site.id, site]))
  const used = new Set(collectUsedCodes(specimens))
  const bySite = new Map<string, Specimen[]>()
  for (const specimen of specimens) {
    const group = bySite.get(specimen.siteId) ?? []
    group.push(specimen)
    bySite.set(specimen.siteId, group)
  }
  const changed: Specimen[] = []
  for (const [siteId, group] of bySite) {
    const site = siteById.get(siteId)
    if (!site) continue // 采集地已撤且未合并：无新前缀可依，保留原号
    const { rows } = renumberRows(group, site.code.trim().toUpperCase(), used)
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i] !== group[i]) changed.push(rows[i])
    }
  }
  return changed
}
