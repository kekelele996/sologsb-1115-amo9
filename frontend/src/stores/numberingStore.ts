import { create } from 'zustand'
import type { RetiredCode } from '@/types'
import { db, loadAll } from '@/hooks/usePersistentStore'

export interface NumberingState {
  /** 已注销的旧编号（改代码/合并回填后退役） */
  retired: RetiredCode[]
  loaded: boolean
  hydrate: () => Promise<void>
}

/** 编号登记簿：持有已注销旧号，采集登记发新号时避开 */
export const numberingStore = create<NumberingState>((set) => ({
  retired: [],
  loaded: false,
  hydrate: async () => {
    const retired = await loadAll<RetiredCode>(db.retiredCodes)
    retired.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ retired, loaded: true })
  }
}))
