import { create } from 'zustand'
import type { CollectSite, RetiredCode } from '@/types'
import { db, loadAll } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { numberingStore } from '@/stores/numberingStore'
import { parseSpecimenCode } from '@/utils/codec'
import { planRenumber, type RenumberChange } from '@/utils/renumber'

export interface SaveSiteResult {
  /** 按新前缀重编的在册标本（旧号 → 新号） */
  renumbered: RenumberChange[]
  /** 回填到本采集地的历史标本数（已撤采集地留下、编号前缀匹配的在册标本） */
  adopted: number
}

export interface MergeSiteResult {
  /** 改挂到目标采集地的标本数 */
  moved: number
  /** 其中按目标前缀回填重编的标本数 */
  renumbered: number
}

export interface SiteState {
  rows: CollectSite[]
  loaded: boolean
  hydrate: () => Promise<void>
  /**
   * 保存采集地。采集地档案持有代码前缀，标本清单持有在册编号，两边各自维护；
   * 代码变更时在同一事务内按在册标本重编编号并登记退役旧号，
   * 已撤采集地留下、前缀匹配的历史标本一并回填到本采集地。
   * 任一步失败整个事务回滚，采集地档案与标本清单各自回到改动前。
   */
  save: (row: CollectSite) => Promise<SaveSiteResult>
  remove: (id: string) => Promise<void>
  /** 合并采集地：sourceId 下的标本改挂到 targetId 并按目标前缀回填编号，然后删除 source 记录 */
  mergeSite: (sourceId: string, targetId: string) => Promise<MergeSiteResult>
}

const today = (): string => new Date().toISOString().slice(0, 10)

export const siteStore = create<SiteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<CollectSite>(db.sites)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    const code = row.code.trim().toUpperCase()
    let renumbered: RenumberChange[] = []
    let adopted = 0
    await db.transaction('rw', [db.sites, db.specimens, db.retiredCodes], async () => {
      const prev = await db.sites.get(row.id)
      await db.sites.put({ ...row, code })

      const siteIds = new Set((await db.sites.toArray()).map((site) => site.id))
      const specimens = await db.specimens.toArray()
      const retired = (await db.retiredCodes.toArray()).map((item) => item.code)

      // 本采集地的在册标本 + 已撤采集地留下、编号前缀与本代码一致的历史标本
      const targetIds = new Set(
        specimens
          .filter(
            (item) =>
              item.siteId === row.id ||
              (!siteIds.has(item.siteId) && parseSpecimenCode(item.code)?.siteCode === code)
          )
          .map((item) => item.id)
      )
      adopted = specimens.filter((item) => targetIds.has(item.id) && item.siteId !== row.id).length

      const codeChanged = prev !== undefined && prev.code.trim().toUpperCase() !== code
      if (targetIds.size === 0 || (!codeChanged && adopted === 0)) return

      renumbered = planRenumber(specimens, targetIds, code, retired)
      const newCodeOf = new Map(renumbered.map((change) => [change.id, change.newCode]))
      const updates = specimens
        .filter((item) => targetIds.has(item.id))
        .map((item) => ({ ...item, siteId: row.id, code: newCodeOf.get(item.id) ?? item.code }))
        .filter((item) => {
          const before = specimens.find((item0) => item0.id === item.id)
          return before !== undefined && (before.code !== item.code || before.siteId !== item.siteId)
        })
      if (updates.length > 0) await db.specimens.bulkPut(updates)
      if (renumbered.length > 0) {
        await db.retiredCodes.bulkPut(
          renumbered.map(
            (change): RetiredCode => ({ code: change.oldCode, replacedBy: change.newCode, retiredAt: today() })
          )
        )
      }
    })
    await get().hydrate()
    await specimenStore.getState().hydrate()
    await numberingStore.getState().hydrate()
    return { renumbered, adopted }
  },
  remove: async (id) => {
    await db.sites.delete(id)
    await get().hydrate()
  },
  mergeSite: async (sourceId, targetId) => {
    let moved = 0
    let renumbered = 0
    await db.transaction('rw', [db.sites, db.specimens, db.retiredCodes], async () => {
      const target = await db.sites.get(targetId)
      if (!target) throw new Error('目标采集地不存在，无法合并')
      const specimens = await db.specimens.toArray()
      const retired = (await db.retiredCodes.toArray()).map((item) => item.code)

      const moving = specimens.filter((item) => item.siteId === sourceId)
      const changes = planRenumber(specimens, new Set(moving.map((item) => item.id)), target.code, retired)
      const newCodeOf = new Map(changes.map((change) => [change.id, change.newCode]))
      const updates = moving.map((item) => ({
        ...item,
        siteId: targetId,
        code: newCodeOf.get(item.id) ?? item.code
      }))
      if (updates.length > 0) await db.specimens.bulkPut(updates)
      if (changes.length > 0) {
        await db.retiredCodes.bulkPut(
          changes.map(
            (change): RetiredCode => ({ code: change.oldCode, replacedBy: change.newCode, retiredAt: today() })
          )
        )
      }
      await db.sites.delete(sourceId)
      moved = updates.length
      renumbered = changes.length
    })
    await get().hydrate()
    await specimenStore.getState().hydrate()
    await numberingStore.getState().hydrate()
    return { moved, renumbered }
  }
}))
