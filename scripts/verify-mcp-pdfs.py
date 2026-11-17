"""Independent proof checks; does not claim PDF/X or printer qualification."""
import json
from pathlib import Path
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
directory = root / 'test-results' / 'book-workflow'
results = []
for format_name, width, height in [('a4', 210, 297), ('a5', 148, 210)]:
    path = directory / f'{format_name}.pdf'
    reader = PdfReader(path)
    text_parts = []
    fonts = set()
    image_count = 0
    for index, page in enumerate(reader.pages):
        actual = (float(page.mediabox.width) * 25.4 / 72, float(page.mediabox.height) * 25.4 / 72)
        assert abs(actual[0] - width) < .001 and abs(actual[1] - height) < .001, actual
        trim = (float(page.trimbox.width) * 25.4 / 72, float(page.trimbox.height) * 25.4 / 72)
        assert abs(trim[0] - width) < .001 and abs(trim[1] - height) < .001, trim
        text = page.extract_text()
        assert f'Ellenőrző PDF • {index + 1} •' in text, (path, index, text[-200:])
        text_parts.append(text)
        for font_ref in page['/Resources'].get('/Font', {}).values():
            font = font_ref.get_object()
            for child in font.get('/DescendantFonts', [font]):
                child = child.get_object()
                descriptor = child.get('/FontDescriptor')
                assert descriptor is not None, font
                descriptor = descriptor.get_object()
                embedded = any(k in descriptor for k in ['/FontFile', '/FontFile2', '/FontFile3'])
                assert embedded, descriptor
                fonts.add(str(child.get('/BaseFont')))
        for item in page['/Resources'].get('/XObject', {}).values():
            if item.get_object().get('/Subtype') == '/Image':
                image_count += 1
    joined = '\n'.join(text_parts)
    assert 'Árvíztűrő tükörfúrógép' in joined
    assert 'Őszinte örömöt' in joined
    assert image_count >= 30, image_count
    (directory / f'{format_name}-text.txt').write_text(joined, encoding='utf8')
    results.append({'file': str(path), 'pages': len(reader.pages), 'allPageSizesMm': [width, height],
                    'trimBoxMm': [width, height], 'allFontsEmbedded': True, 'fonts': sorted(fonts), 'hungarianAccents': True,
                    'pageOrder': True, 'imageOccurrences': image_count, 'pdfX': False, 'printReady': False})
assert results[0]['pages'] != results[1]['pages'], 'Expected separate A4/A5 layout, not scaled A4'
(directory / 'pdf-validation.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps(results, ensure_ascii=False, indent=2))
