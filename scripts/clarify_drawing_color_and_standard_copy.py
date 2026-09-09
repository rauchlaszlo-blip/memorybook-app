from pathlib import Path

editor_path = Path('src/MemoryBookEditor.tsx')
editor = editor_path.read_text(encoding='utf-8')
old_color = '''              {!isErasing && (\n                <input\n                  type="color"\n                  aria-label={copy.brushColor}\n                  value={brushColor}\n                  onChange={(e) => setBrushColor(e.target.value)}\n                />\n              )}'''
new_color = '''              {!isErasing && (\n                <label\n                  style={{\n                    display: 'inline-flex',\n                    alignItems: 'center',\n                    gap: 8,\n                    padding: '0 10px',\n                    border: '1px solid #cbd5e1',\n                    borderRadius: 6,\n                    background: '#fff',\n                    cursor: 'pointer',\n                  }}\n                >\n                  <span>{copy.brushColor}</span>\n                  <input\n                    type="color"\n                    aria-label={copy.brushColor}\n                    value={brushColor}\n                    onChange={(e) => setBrushColor(e.target.value)}\n                    style={{\n                      width: 38,\n                      height: 30,\n                      padding: 1,\n                      border: '1px solid #94a3b8',\n                      borderRadius: 5,\n                      background: '#fff',\n                      cursor: 'pointer',\n                    }}\n                  />\n                </label>\n              )}'''
if old_color not in editor:
    raise SystemExit('Color picker target not found')
editor = editor.replace(old_color, new_color, 1)
editor_path.write_text(editor, encoding='utf-8')

landing_path = Path('src/LandingPage.tsx')
landing = landing_path.read_text(encoding='utf-8')
old_copy = "standardText: 'Minden meghívott saját oldalt kap. Megírja, megszerkeszti és elküldi neked.',"
new_copy = "standardText: 'Minden meghívott saját oldalt kap. Megírja, megszerkeszti és visszaküldi neked.',"
if old_copy not in landing:
    raise SystemExit('Landing standard copy target not found')
landing = landing.replace(old_copy, new_copy, 1)
landing_path.write_text(landing, encoding='utf-8')
