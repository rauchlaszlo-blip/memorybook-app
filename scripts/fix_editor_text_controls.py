from pathlib import Path

editor_path = Path('src/MemoryBookEditor.tsx')
editor = editor_path.read_text(encoding='utf-8')

editor = editor.replace(
"""  const [hasSelection, setHasSelection] = useState(false);\n  const [canUndo, setCanUndo] = useState(false);""",
"""  const [hasSelection, setHasSelection] = useState(false);\n  const [selectedTextFontSize, setSelectedTextFontSize] = useState<number | null>(null);\n  const [canUndo, setCanUndo] = useState(false);""",
1,
)

old_selection = """    canvas.on('selection:created', () =>\n      setHasSelection(\n        (fabricRef.current?.getActiveObjects().length ?? 0) > 0\n      )\n    );\n    canvas.on('selection:updated', () =>\n      setHasSelection(\n        (fabricRef.current?.getActiveObjects().length ?? 0) > 0\n      )\n    );\n    canvas.on('selection:cleared', () => setHasSelection(false));"""
new_selection = """    const syncSelectionState = () => {\n      const activeObjects = canvas.getActiveObjects();\n      const activeObject = canvas.getActiveObject();\n      setHasSelection(activeObjects.length > 0);\n      setSelectedTextFontSize(\n        activeObject instanceof fabric.IText\n          ? Math.round(activeObject.fontSize || 22)\n          : null\n      );\n    };\n\n    canvas.on('selection:created', syncSelectionState);\n    canvas.on('selection:updated', syncSelectionState);\n    canvas.on('selection:cleared', syncSelectionState);"""
if old_selection not in editor:
    raise SystemExit('Selection handler target not found')
editor = editor.replace(old_selection, new_selection, 1)

anchor = """  const handleDeleteSelected = () => {\n    const canvas = fabricRef.current;\n    if (!canvas) return;\n\n    const activeObjects = canvas.getActiveObjects();\n    if (activeObjects.length === 0) return;\n\n    canvas.remove(...activeObjects);\n    canvas.discardActiveObject();\n    canvas.renderAll();\n  };\n"""
insert = anchor + """\n  const handleSelectedTextFontSize = (fontSize: number) => {\n    const canvas = fabricRef.current;\n    const object = canvas?.getActiveObject();\n    if (!canvas || !(object instanceof fabric.IText)) return;\n\n    object.set({ fontSize });\n    object.setCoords();\n    canvas.requestRenderAll();\n    setSelectedTextFontSize(fontSize);\n    handleStructuralMutation();\n  };\n\n  const handleMoveSelectedText = () => {\n    const canvas = fabricRef.current;\n    const object = canvas?.getActiveObject();\n    if (!canvas || !(object instanceof fabric.IText)) return;\n\n    if (object.isEditing) object.exitEditing();\n    canvas.setActiveObject(object);\n    object.setCoords();\n    canvas.requestRenderAll();\n  };\n"""
if anchor not in editor:
    raise SystemExit('Delete handler anchor not found')
editor = editor.replace(anchor, insert, 1)

old_controls = """          {hasSelection && (\n            <>\n              <button onClick={handleBringForward}>{copy.bringForward}</button>\n              <button onClick={handleSendBackwards}>{copy.sendBackward}</button>\n              <button onClick={handleDeleteSelected}>{copy.delete}</button>\n            </>\n          )}"""
new_controls = """          {selectedTextFontSize !== null && (\n            <>\n              <label\n                style={{\n                  display: 'inline-flex',\n                  alignItems: 'center',\n                  gap: 6,\n                  padding: '0 8px',\n                  border: '1px solid #cbd5e1',\n                  borderRadius: 6,\n                  background: '#fff',\n                }}\n              >\n                <span>{copy.textSize}</span>\n                <input\n                  type=\"range\"\n                  aria-label={copy.textSize}\n                  min=\"12\"\n                  max=\"72\"\n                  value={selectedTextFontSize}\n                  onChange={(event) => handleSelectedTextFontSize(Number(event.target.value))}\n                />\n                <span>{selectedTextFontSize}</span>\n              </label>\n              <button onClick={handleMoveSelectedText}>{copy.moveText}</button>\n            </>\n          )}\n\n          {hasSelection && (\n            <>\n              <button onClick={handleBringForward}>{copy.bringForward}</button>\n              <button onClick={handleSendBackwards}>{copy.sendBackward}</button>\n              <button onClick={handleDeleteSelected}>{copy.delete}</button>\n            </>\n          )}"""
if old_controls not in editor:
    raise SystemExit('Selection controls target not found')
editor = editor.replace(old_controls, new_controls, 1)

old_save = """          <button\n            onClick={() =>\n              enqueueSave(currentPageIdRef.current).catch(() => {})\n            }\n            disabled={\n              saveStatus === 'saved' ||\n              saveStatus === 'saving' ||\n              saveStatus === 'conflict'\n            }\n          >\n            {copy.saveNow}\n          </button>\n"""
if old_save not in editor:
    raise SystemExit('Manual save button target not found')
editor = editor.replace(old_save, '', 1)

editor_path.write_text(editor, encoding='utf-8')

i18n_path = Path('src/inviteEditorI18n.ts')
i18n = i18n_path.read_text(encoding='utf-8')
i18n = i18n.replace("      brushWidth: 'Ecset vastagsága',", "      brushWidth: 'Ecset vastagsága',\n      textSize: 'Szöveg mérete',\n      moveText: 'Szöveg mozgatása',", 1)
i18n = i18n.replace("      brushWidth: 'Brush width',", "      brushWidth: 'Brush width',\n      textSize: 'Text size',\n      moveText: 'Move text',", 1)
i18n = i18n.replace("      brushWidth: 'Pinselbreite',", "      brushWidth: 'Pinselbreite',\n      textSize: 'Textgröße',\n      moveText: 'Text verschieben',", 1)
i18n_path.write_text(i18n, encoding='utf-8')
