import { useEffect, useRef } from 'react'
import { runAction } from '../actions/actionRegistry'

const CHORD_TIMEOUT_MS = 2000

export function formatShortcutEvent(event) {
  const key = event.key === ' ' ? 'Space' : event.key
  if (!key || ['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return ''

  const parts = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')

  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

function findActionByShortcut(shortcuts, scope, shortcut) {
  const entries = Object.entries(shortcuts?.[scope] || {})
  const match = entries.find(([, value]) => value === shortcut)
  return match?.[0] || ''
}

function getScopedShortcutEntries(shortcuts, scope) {
  return Object.entries(shortcuts?.[scope] || {})
    .filter(([, value]) => typeof value === 'string' && value.trim())
}

function findActionByShortcutInScopes(shortcuts, scopes, shortcut) {
  for (const scope of scopes) {
    const actionId = findActionByShortcut(shortcuts, scope, shortcut)
    if (actionId) return actionId
  }
  return ''
}

function hasChordPrefix(shortcuts, scopes, shortcut) {
  return scopes.some((scope) => (
    getScopedShortcutEntries(shortcuts, scope)
      .some(([, value]) => value.includes(' ') && value.split(/\s+/)[0] === shortcut)
  ))
}

function isTextEditingTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  const tagName = target.tagName?.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export default function useShortcutManager(scope, shortcuts, disabled = false) {
  const pendingChordRef = useRef(null)
  const chordTimerRef = useRef(null)

  const clearPendingChord = () => {
    pendingChordRef.current = null
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current)
      chordTimerRef.current = null
    }
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', { detail: null }))
  }

  const startPendingChord = (firstShortcut) => {
    clearPendingChord()
    pendingChordRef.current = firstShortcut
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', {
      detail: { shortcut: firstShortcut },
    }))
    chordTimerRef.current = setTimeout(clearPendingChord, CHORD_TIMEOUT_MS)
  }

  useEffect(() => {
    if (disabled) return undefined

    const handleKeyDown = (event) => {
      if (event.repeat) return
      const shortcut = formatShortcutEvent(event)
      if (!shortcut) return

      const scopes = [scope, 'global']

      if (pendingChordRef.current) {
        event.preventDefault()
        event.stopPropagation()

        if (shortcut === 'Escape') {
          clearPendingChord()
          return
        }

        const chordShortcut = `${pendingChordRef.current} ${shortcut}`
        clearPendingChord()
        const chordActionId = findActionByShortcutInScopes(shortcuts, scopes, chordShortcut)
        if (!chordActionId) return

        runAction(chordActionId)
        return
      }

      if (
        isTextEditingTarget(event.target)
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && (shortcut === 'Space' || event.key.length === 1)
      ) {
        return
      }

      if (hasChordPrefix(shortcuts, scopes, shortcut)) {
        event.preventDefault()
        event.stopPropagation()
        startPendingChord(shortcut)
        return
      }

      const actionId = findActionByShortcutInScopes(shortcuts, scopes, shortcut)
      if (!actionId) return
      if (isTextEditingTarget(event.target) && actionId === 'global.undoDelete') return

      event.preventDefault()
      event.stopPropagation()
      runAction(actionId)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      clearPendingChord()
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [disabled, scope, shortcuts])
}
