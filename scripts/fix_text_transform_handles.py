from pathlib import Path

path = Path('src/MemoryBookEditor.tsx')
text = path.read_text(encoding='utf-8')

text = text.replace("  const [selectedTextFontSize, setSelectedTextFontSize] = useState<number | null>(null);\n", "", 1)

old_handlers = """    const syncSelectionState = () => {\n      const activeObjects = canvas.getActiveObjects();\n      const activeObject = canvas.getActiveObject();\n      setHasSelection(activeObjects.length > 0);\n      setSelectedTextFontSize(\n        activeObject instanceof fabric.IText\n          ? Math.round(activeObject.fontSize || 22)\n          : null\n      );\n    };\n\n    canvas.on('selection:created', syncSelectionState);\n    canvas.on('selection:updated', syncSelectionState);\n    canvas.on('selection:cleared', syncSelectionState);"""
new_handlers = """    const configureTextObject = (object: fabric.FabricObject) => {\n      if (!(object instanceof fabric.IText)) return;\n\n      object.set({\n        borderColor: '#2563eb',\n        cornerColor: '#ffffff',\n        cornerStrokeColor: '#2563eb',\n        cornerStyle: 'circle',\n        cornerSize: 20,\n        transparentCorners: false,\n        padding: 8,\n        centeredRotation: true,\n      });\n      object.setControlsVisibility({\n        tl: true,\n        tr: true,\n        bl: true,\n        br: true,\n        ml: false,\n        mr: false,\n        mt: false,\n        mb: false,\n        mtr: true,\n      });\n      object.setCoords();\n    };\n\n    const keepTextInsideCanvas = (object: fabric.FabricObject) => {\n      if (!(object instanceof fabric.IText)) return;\n\n      object.setCoords();\n      let bounds = object.getBoundingRect();\n\n      if (bounds.width > CANVAS_WIDTH || bounds.height > CANVAS_HEIGHT) {\n        const factor = Math.min(\n          CANVAS_WIDTH / Math.max(bounds.width, 1),\n          CANVAS_HEIGHT / Math.max(bounds.height, 1)\n        );\n        object.set({\n          scaleX: (object.scaleX || 1) * factor,\n          scaleY: (object.scaleY || 1) * factor,\n        });\n        object.setCoords();\n        bounds = object.getBoundingRect();\n      }\n\n      let deltaX = 0;\n      let deltaY = 0;\n      if (bounds.left < 0) deltaX = -bounds.left;\n      else if (bounds.left + bounds.width > CANVAS_WIDTH) {\n        deltaX = CANVAS_WIDTH - (bounds.left + bounds.width);\n      }\n      if (bounds.top < 0) deltaY = -bounds.top;\n      else if (bounds.top + bounds.height > CANVAS_HEIGHT) {\n        deltaY = CANVAS_HEIGHT - (bounds.top + bounds.height);\n      }\n\n      if (deltaX || deltaY) {\n        object.set({\n          left: (object.left || 0) + deltaX,\n          top: (object.top || 0) + deltaY,\n        });\n        object.setCoords();\n      }\n    };\n\n    const syncSelectionState = () => {\n      const activeObject = canvas.getActiveObject();\n      setHasSelection(canvas.getActiveObjects().length > 0);\n      if (activeObject) configureTextObject(activeObject);\n    };\n\n    canvas.on('selection:created', syncSelectionState);\n    canvas.on('selection:updated', syncSelectionState);\n    canvas.on('selection:cleared', syncSelectionState);\n    canvas.on('object:moving', (event) => {\n      if (event.target) keepTextInsideCanvas(event.target);\n    });\n    canvas.on('object:modified', (event) => {\n      if (event.target) keepTextInsideCanvas(event.target);\n    });"""
if old_handlers not in text:
    raise SystemExit('selection block not found')
text = text.replace(old_handlers, new_handlers, 1)

old_modified = """    canvas.on('object:modified', () =>\n      handlersRef.current.handleStructuralMutation()\n    );"""
new_modified = """    canvas.on('object:modified', () =>\n      handlersRef.current.handleStructuralMutation()\n    );"""
# Keep existing structural mutation listener; the new object:modified listener only constrains geometry.
if old_modified not in text:
    raise SystemExit('object modified listener not found')

old_font_handlers = """  const handleSelectedTextFontSize = (fontSize: number) => {\n    const canvas = fabricRef.current;\n    const object = canvas?.getActiveObject();\n    if (!canvas || !(object instanceof fabric.IText)) return;\n\n    object.set({ fontSize });\n    object.setCoords();\n    canvas.requestRenderAll();\n    setSelectedTextFontSize(fontSize);\n    handleStructuralMutation();\n  };\n\n  const handleMoveSelectedText = () => {\n    const canvas = fabricRef.current;\n    const object = canvas?.getActiveObject();\n    if (!canvas || !(object instanceof fabric.IText)) return;\n\n    if (object.isEditing) object.exitEditing();\n    canvas.setActiveObject(object);\n    object.setCoords();\n    canvas.requestRenderAll();\n  };\n\n"""
if old_font_handlers not in text:
    raise SystemExit('old text handlers not found')
text = text.replace(old_font_handlers, '', 1)

old_controls = """          {selectedTextFontSize !== null && (\n            <>\n              <label\n                style={{\n                  display: 'inline-flex',\n                  alignItems: 'center',\n                  gap: 6,\n                  padding: '0 8px',\n                  border: '1px solid #cbd5e1',\n                  borderRadius: 6,\n                  background: '#fff',\n                }}\n              >\n                <span>{copy.textSize}</span>\n                <input\n                  type=\"range\"\n                  aria-label={copy.textSize}\n                  min=\"12\"\n                  max=\"72\"\n                  value={selectedTextFontSize}\n                  onChange={(event) => handleSelectedTextFontSize(Number(event.target.value))}\n                />\n                <span>{selectedTextFontSize}</span>\n              </label>\n              <button onClick={handleMoveSelectedText}>{copy.moveText}</button>\n            </>\n          )}\n\n"""
if old_controls not in text:
    raise SystemExit('old toolbar text controls not found')
text = text.replace(old_controls, '', 1)

old_text_props = """      fill: '#1F2937',\n      editable: true,\n    });"""
new_text_props = """      fill: '#1F2937',\n      editable: true,\n      borderColor: '#2563eb',\n      cornerColor: '#ffffff',\n      cornerStrokeColor: '#2563eb',\n      cornerStyle: 'circle',\n      cornerSize: 20,\n      transparentCorners: false,\n      padding: 8,\n      centeredRotation: true,\n    });\n    text.setControlsVisibility({\n      tl: true,\n      tr: true,\n      bl: true,\n      br: true,\n      ml: false,\n      mr: false,\n      mt: false,\n      mb: false,\n      mtr: true,\n    });"""
if old_text_props not in text:
    raise SystemExit('new text properties anchor not found')
text = text.replace(old_text_props, new_text_props, 1)

old_render = """        canvas.renderAll();\n\n        const initialJson = JSON.stringify(canvas.toJSON());"""
new_render = """        canvas.getObjects().forEach((object) => {\n          if (object instanceof fabric.IText) {\n            object.set({\n              borderColor: '#2563eb',\n              cornerColor: '#ffffff',\n              cornerStrokeColor: '#2563eb',\n              cornerStyle: 'circle',\n              cornerSize: 20,\n              transparentCorners: false,\n              padding: 8,\n              centeredRotation: true,\n            });\n            object.setControlsVisibility({\n              tl: true, tr: true, bl: true, br: true,\n              ml: false, mr: false, mt: false, mb: false, mtr: true,\n            });\n            object.setCoords();\n          }\n        });\n        canvas.renderAll();\n\n        const initialJson = JSON.stringify(canvas.toJSON());"""
if old_render not in text:
    raise SystemExit('page render anchor not found')
text = text.replace(old_render, new_render, 1)

text = text.replace(
"touchAction: isDrawing || isErasing ? 'none' : 'manipulation',",
"touchAction: isDrawing || isErasing || hasSelection ? 'none' : 'manipulation',",
1,
)

path.write_text(text, encoding='utf-8')
