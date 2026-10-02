import type { Specimen } from '@/types'
import { buildSpecimenCode, nextSerial, parseSpecimenCode } from '@/utils/codec'

/** 一条重编记录：标本 id + 旧编号 + 新编号 */
export interface RenumberChange {
  id: string
  oldCode: string
  newCode: string
}

/**
 * 规划换前缀重编（纯函数：同样的输入必然得到同样的方案，可安全重跑）。
 *
 * 规则：
 * - 编号已是新前缀、且未与他人撞号的标本直接跳过 —— 重跑时已经改好的不再变；
 * - 年份沿用原编号，原编号无法解析时退回采集日期年份；
 * - 流水号优先沿用；与在册编号、本批已分配编号或已注销旧号冲突时，顺延到下一个空号；
 * - 不参与本次重编的标本编号原样保留并先行占位，保证新编号不会撞上它们。
 */
export function planRenumber(
  specimens: Specimen[],
  targetIds: ReadonlySet<string>,
  newPrefix: string,
  retiredCodes: readonly string[]
): RenumberChange[] {
  const prefix = newPrefix.trim().toUpperCase()
  const taken = new Set<string>()
  specimens.forEach((item) => {
    if (!targetIds.has(item.id)) taken.add(item.code.trim().toUpperCase())
  })
  retiredCodes.forEach((code) => taken.add(code.trim().toUpperCase()))

  // 稳定顺序处理，保证部分成功后重跑的结果与一次跑完一致
  const targets = specimens
    .filter((item) => targetIds.has(item.id))
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))

  const changes: RenumberChange[] = []
  for (const item of targets) {
    const parsed = parseSpecimenCode(item.code)
    const currentKey = item.code.trim().toUpperCase()
    if (parsed && parsed.siteCode === prefix && !taken.has(currentKey)) continue

    const year = parsed?.year ?? (item.collectDate.slice(0, 4) || String(new Date().getFullYear()))
    let serial = parsed?.serial ?? 0
    let candidate = serial > 0 ? buildSpecimenCode(prefix, year, serial) : ''
    if (candidate === '' || taken.has(candidate.toUpperCase())) {
      serial = nextSerial(prefix, year, [...taken])
      candidate = buildSpecimenCode(prefix, year, serial)
      while (taken.has(candidate.toUpperCase())) {
        serial += 1
        candidate = buildSpecimenCode(prefix, year, serial)
      }
    }
    taken.add(candidate.toUpperCase())
    changes.push({ id: item.id, oldCode: item.code, newCode: candidate })
  }
  return changes
}
