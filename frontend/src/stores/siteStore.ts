import { create } from 'zustand'
import type { CollectSite, Specimen } from '@/types'
import { db, deleteRow, loadAll, putRow, putRows } from '@/hooks/usePersistentStore'
import { collectUsedCodes } from '@/utils/codec'
import { reconcileRows, renumberRows } from '@/utils/numbering'
import { specimenStore } from './specimenStore'

export interface SiteState {
  rows: CollectSite[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: CollectSite) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 合并采集地：source 下标本改挂 target，并按 target 代码回填在册编号，然后删除 source 记录 */
  mergeSite: (sourceId: string, targetId: string) => Promise<number>
  /** 改代码：把该采集地下在册标本的编号前缀换成新代码（原子事务，幂等；返回重编份数） */
  renumberSiteCode: (site: CollectSite) => Promise<number>
  /** 全量对账：让在册标本编号前缀与所属采集地当前代码一致（改代码/合并中途失败后的兜底重跑） */
  reconcilePrefixes: () => Promise<number>
}

export const siteStore = create<SiteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<CollectSite>(db.sites)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<CollectSite>(db.sites, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<CollectSite>(db.sites, id)
    await get().hydrate()
  },
  mergeSite: async (sourceId, targetId) => {
    let moved = 0
    // 采集地删除与标本改挂 / 回填编号同处一个事务，失败整体回滚（按侧恢复）
    await db.transaction('rw', db.sites, db.specimens, async (tx) => {
      const siteTable = tx.table<CollectSite, string>('sites')
      const specimenTable = tx.table<Specimen, string>('specimens')
      const target = await siteTable.get(targetId)
      if (!target) return
      const specimens = await specimenTable.where('siteId').equals(sourceId).toArray()
      const all = await specimenTable.toArray()
      const used = new Set(collectUsedCodes(all))
      const { rows } = renumberRows(specimens, target.code.trim().toUpperCase(), used)
      // 鉴定记录与柜位按 specimenId 关联，改挂后天然跟随标本，无需挪动
      const movedRows = rows.map((row) => ({ ...row, siteId: targetId }))
      moved = movedRows.length
      if (movedRows.length > 0) await specimenTable.bulkPut(movedRows)
      await siteTable.delete(sourceId)
    })
    await Promise.all([get().hydrate(), specimenStore.getState().hydrate()])
    return moved
  },
  renumberSiteCode: async (site) => {
    const targetPrefix = site.code.trim().toUpperCase()
    let changed = 0
    // 采集地档案（代码前缀）与标本在册编号同处一个事务，失败整体回滚（按侧恢复）
    await db.transaction('rw', db.sites, db.specimens, async (tx) => {
      const siteTable = tx.table<CollectSite, string>('sites')
      const specimenTable = tx.table<Specimen, string>('specimens')
      const specimens = await specimenTable.where('siteId').equals(site.id).toArray()
      const all = await specimenTable.toArray()
      const used = new Set(collectUsedCodes(all))
      const { rows, changed: n } = renumberRows(specimens, targetPrefix, used)
      changed = n
      if (rows.length > 0) await specimenTable.bulkPut(rows)
      await siteTable.put({ ...site, code: targetPrefix })
    })
    await Promise.all([get().hydrate(), specimenStore.getState().hydrate()])
    return changed
  },
  reconcilePrefixes: async () => {
    const [sites, specimens] = await Promise.all([
      loadAll<CollectSite>(db.sites),
      loadAll<Specimen>(db.specimens)
    ])
    const changedRows = reconcileRows(specimens, sites)
    if (changedRows.length > 0) await putRows<Specimen>(db.specimens, changedRows)
    if (changedRows.length > 0) await specimenStore.getState().hydrate()
    return changedRows.length
  }
}))
