import { useState, useCallback, useRef, useEffect } from 'react'
import { getParagraphStatus, getParagraphStatusBatch } from '../services/api'

// 全局在途请求与状态缓存（跨组件共享）
const statusCache = new Map()
const inFlightPromises = new Map()

export function useParagraphStatus(projectId) {
  const [statuses, setStatuses] = useState({})
  const [loadingMap, setLoadingMap] = useState({})

  const fetchStatus = useCallback(async (uuid) => {
    if (!projectId || !uuid) return null
    if (statusCache.has(uuid)) {
      setStatuses(prev => ({ ...prev, [uuid]: statusCache.get(uuid) }))
      return statusCache.get(uuid)
    }
    if (inFlightPromises.has(uuid)) {
      return inFlightPromises.get(uuid)
    }

    setLoadingMap(prev => ({ ...prev, [uuid]: true }))
    const promise = getParagraphStatus(projectId, uuid)
      .then(res => {
        statusCache.set(uuid, res)
        setStatuses(prev => ({ ...prev, [uuid]: res }))
        return res
      })
      .catch(err => {
        console.error(`Failed to fetch status for ${uuid}:`, err)
        return null
      })
      .finally(() => {
        inFlightPromises.delete(uuid)
        setLoadingMap(prev => ({ ...prev, [uuid]: false }))
      })

    inFlightPromises.set(uuid, promise)
    return promise
  }, [projectId])

  const fetchStatusBatch = useCallback(async (uuids) => {
    if (!projectId || !uuids || !uuids.length) return {}
    const missing = uuids.filter(u => u && !statusCache.has(u) && !inFlightPromises.has(u))
    
    if (missing.length === 0) {
      const cachedRes = {}
      uuids.forEach(u => {
        if (statusCache.has(u)) cachedRes[u] = statusCache.get(u)
      })
      setStatuses(prev => ({ ...prev, ...cachedRes }))
      return cachedRes
    }

    try {
      const resBatch = await getParagraphStatusBatch(projectId, missing)
      Object.entries(resBatch).forEach(([u, res]) => {
        statusCache.set(u, res)
      })
      setStatuses(prev => ({ ...prev, ...resBatch }))
      return resBatch
    } catch (err) {
      console.error('Failed to fetch batch paragraph status:', err)
      return {}
    }
  }, [projectId])

  const invalidateCache = useCallback((uuid) => {
    if (uuid) {
      statusCache.delete(uuid)
    } else {
      statusCache.clear()
    }
    window.dispatchEvent(new CustomEvent('paragraph-status-invalidated', { detail: { uuid } }))
  }, [])

  useEffect(() => {
    const handleInvalidate = (e) => {
      const targetUuid = e?.detail?.uuid
      if (targetUuid) {
        statusCache.delete(targetUuid)
      } else {
        statusCache.clear()
      }
      setStatuses(prev => ({ ...prev }))
    }
    window.addEventListener('paragraph-status-invalidated', handleInvalidate)
    return () => window.removeEventListener('paragraph-status-invalidated', handleInvalidate)
  }, [])

  return {
    statuses,
    loadingMap,
    fetchStatus,
    fetchStatusBatch,
    invalidateCache
  }
}
