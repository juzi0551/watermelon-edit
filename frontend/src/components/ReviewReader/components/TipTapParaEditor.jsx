import React, { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Heading } from '@tiptap/extension-heading'


import './TipTapParaEditor.css'

export function TipTapParaEditor({
  para,
  initialContent,
  onContentChange,
  onSplitAndInsert,
  onMergeWithPrev,
  currentBodyFontSize = 16,
  isCh,
  chapterObj,
  isEditing = false,
  editingCaretPos,
  onEditorReady,
}) {
  const isUpdatingFromProps = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            class: 'novel-para-content',
          },
        },
        heading: false,
      }),
      TextStyle,
      Color,
      Heading.configure({
        levels: [1, 2, 3, 4, 5, 6],
      }),
    ],
    content: initialContent || '',
    editorProps: {
      attributes: {
        class: 'tiptap-novel-editor',
        style: `font-size: ${currentBodyFontSize}px; line-height: 1.9; outline: none;`,
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          if (!editor) return true

          const { selection } = editor.state
          const { from } = selection
          const cursorOffset = Math.max(0, from - 1)

          const fullText = editor.getText()
          const textBefore = fullText.slice(0, cursorOffset)
          const textAfter = fullText.slice(cursorOffset)

          onSplitAndInsert?.(para, textBefore, textAfter)
          return true
        }

        if (event.key === 'Backspace') {
          if (!editor) return false
          const { selection } = editor.state
          const isAtStart = selection.empty && selection.from === 1
          const rawText = editor.getText()
          const isEmpty = rawText.trim() === ''

          if (isAtStart || isEmpty) {
            event.preventDefault()
            onMergeWithPrev?.(para, rawText, isEmpty)
            return true
          }
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      if (isUpdatingFromProps.current) return
      // ✍️ 修复 B1: 输出纯文本 Clean Plain Text，摒弃 HTML 标签源码
      const cleanText = editor.getText()
      onContentChange?.(cleanText)
    },
    onFocus: ({ editor }) => {
      if (window) window.__activeTipTapEditor = editor
    },
    onSelectionUpdate: ({ editor }) => {
      if (window) window.__activeTipTapEditor = editor
    },
  })

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor)
    }
  }, [editor, onEditorReady])

  useEffect(() => {
    if (editor && isEditing) {
      if (window) window.__activeTipTapEditor = editor
      const pos = editingCaretPos == null ? 0 : editingCaretPos
      requestAnimationFrame(() => {
        try {
          editor.commands.focus(pos === 0 ? 'start' : 'end')
        } catch {}
      })
    }
  }, [editor, isEditing, editingCaretPos])

  useEffect(() => {
    if (editor && initialContent !== undefined) {
      const currentText = editor.getText()
      if (currentText !== initialContent) {
        isUpdatingFromProps.current = true
        editor.commands.setContent(initialContent || '')
        isUpdatingFromProps.current = false
      }
    }
  }, [editor, initialContent])

  if (!editor) return null

  return (
    <div className={`tiptap-para-wrapper ${isCh ? 'is-chapter-para' : ''}`}>
      <EditorContent editor={editor} />
    </div>
  )
}

