from pathlib import Path
import runpy

patch = Path('scripts/patch-memory-identity.py')
code = patch.read_text(encoding='utf-8')
code = code.replace(
    "  inviteMeta: { marginBottom: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, lineHeight: 1.4 },",
    "  inviteMeta: { marginBottom: 10, color: '#64748b', fontSize: 12, lineHeight: 1.45 },",
)
exec(compile(code, str(patch), 'exec'), {'__name__': '__main__'})
runpy.run_path('scripts/patch-expired-invite-reassignment.py', run_name='__main__')
