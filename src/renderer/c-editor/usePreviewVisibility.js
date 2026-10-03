import { useEffect, useRef, useState } from 'react'

const visibleCallbacks = new Map()
const nearCallbacks = new Map()
let visibleObserver = null
let nearObserver = null

function getObserver(kind) {
  if (typeof IntersectionObserver === 'undefined') return null
  if (kind === 'visible' && !visibleObserver) {
    visibleObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => visibleCallbacks.get(entry.target)?.(entry.isIntersecting))
    }, { threshold: 0.01 })
  }
  if (kind === 'near' && !nearObserver) {
    nearObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => nearCallbacks.get(entry.target)?.(entry.isIntersecting))
    }, { rootMargin: '600px 0px', threshold: 0 })
  }
  return kind === 'visible' ? visibleObserver : nearObserver
}

export default function usePreviewVisibility() {
  const elementRef = useRef(null)
  const observerUnavailable = typeof IntersectionObserver === 'undefined'
  const [isNear, setIsNear] = useState(observerUnavailable)
  const [isVisible, setIsVisible] = useState(observerUnavailable)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return undefined
    const nextVisibleObserver = getObserver('visible')
    const nextNearObserver = getObserver('near')
    if (!nextVisibleObserver || !nextNearObserver) return undefined

    visibleCallbacks.set(element, setIsVisible)
    nearCallbacks.set(element, setIsNear)
    nextVisibleObserver.observe(element)
    nextNearObserver.observe(element)
    return () => {
      nextVisibleObserver.unobserve(element)
      nextNearObserver.unobserve(element)
      visibleCallbacks.delete(element)
      nearCallbacks.delete(element)
    }
  }, [])

  return { elementRef, isNear, isVisible }
}
