import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from '@/router'
import { seedDemoData, stampDbVersion } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { storageStore } from '@/stores/storageStore'
import { determinationStore } from '@/stores/determinationStore'
import '@/styles/index.css'

/** 启动时：写入示例数据（仅首次）→ 记录 schemaVersion → 编号前缀对账（幂等）→ 从 IndexedDB 水合全部 store */
async function bootstrap(): Promise<void> {
  await seedDemoData()
  await stampDbVersion()
  // 兜底：让在册标本编号前缀与采集地当前代码一致（改代码/合并中途失败后的重跑，已一致则不动）
  await siteStore.getState().reconcilePrefixes()
  await siteStore.getState().hydrate()
  await specimenStore.getState().hydrate()
  await storageStore.getState().hydrate()
  await determinationStore.getState().hydrate()
}

void bootstrap()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </React.StrictMode>
)
