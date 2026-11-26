"""Read-only coverage audit for the separate local MinerU index."""

import hashlib
import json
import pathlib
import sqlite3
from collections import defaultdict

from clean_mineru_middle import block_text, clean_document
from index_local_pdfs import CONFIG, PROJECT


DATABASE = PROJECT / '.local-data' / 'policy-mineru-index.sqlite'
CACHE = PROJECT / '.local-data' / 'mineru-cache'
OLD_DATABASE = PROJECT / '.local-data' / 'policy-pdf-index.sqlite'


def main():
    config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    vault = pathlib.Path(config['indexPath']).parent.parent
    db = sqlite3.connect(f'file:{DATABASE.as_posix()}?mode=ro', uri=True)
    rows = db.execute('SELECT path,size,mtime_ns,pages,chunks FROM pdf_documents').fetchall()
    indexed_pages = defaultdict(list)
    for path, page, content in db.execute('SELECT path,page,content FROM pdf_fts'):
        indexed_pages[(path, page)].append(content)
    old_pages = set()
    old_lengths = {}
    if OLD_DATABASE.exists():
        old_db = sqlite3.connect(f'file:{OLD_DATABASE.as_posix()}?mode=ro', uri=True)
        old_pages = set(old_db.execute('SELECT path,page FROM pdf_fts'))
        old_lengths = {(path, page): chars for path, page, chars in old_db.execute(
            'SELECT path,page,sum(length(content)) FROM pdf_fts GROUP BY path,page')}
        old_db.close()
    count = {'documents': len(rows), 'pages': 0, 'chunks': 0, 'tables': 0,
             'table_text_in_index': 0, 'empty_pages': 0, 'empty_pages_with_images': 0,
             'empty_pages_with_old_text': 0, 'uncovered_pages': 0,
             'restored_pages': 0, 'restored_table_rows': 0,
             'suspicious_short_pages': 0, 'image_blocks': 0,
             'missing_cache': 0, 'mismatched_pages': 0}
    problems = []
    short_samples = []
    for relative, size, mtime_ns, expected_pages, expected_chunks in rows:
        signature = f'{relative}:{size}:{mtime_ns}'
        cache_file = CACHE / (hashlib.sha256(signature.encode('utf-8')).hexdigest() + '.json')
        if not cache_file.exists():
            count['missing_cache'] += 1
            continue
        document = json.loads(cache_file.read_text(encoding='utf-8'))
        pages, _, skipped = clean_document(document, relative)
        count['pages'] += len(pages)
        count['chunks'] += sum(len(page['chunks']) for page in pages)
        count['empty_pages'] += sum(not page['text'] for page in pages)
        count['empty_pages_with_old_text'] += sum(not page['text'] and (relative, page['page']) in old_pages for page in pages)
        count['image_blocks'] += skipped.get('image', 0)
        restored_chunks = sum(content.startswith('【旧OCR补充') or '【表格完整行补录】' in content
                              for page in pages for content in indexed_pages[(relative, page['page'])])
        count['restored_table_rows'] += sum('【表格完整行补录】' in content
                                            for page in pages for content in indexed_pages[(relative, page['page'])])
        if len(pages) != expected_pages or sum(len(page['chunks']) for page in pages) + restored_chunks != expected_chunks:
            count['mismatched_pages'] += 1
        for source_page, cleaned_page in zip(document['pages'], pages):
            indexed = '\n'.join(indexed_pages[(relative, cleaned_page['page'])])
            if not indexed:
                count['uncovered_pages'] += 1
            if indexed.startswith('【旧OCR补充'):
                count['restored_pages'] += 1
            old_length = old_lengths.get((relative, cleaned_page['page']), 0)
            if cleaned_page['text'] and old_length > 200 and len(cleaned_page['text']) < old_length / 2:
                count['suspicious_short_pages'] += 1
                if len(short_samples) < 8:
                    short_samples.append({'path': relative, 'page': cleaned_page['page'],
                                          'old_chars': old_length, 'mineru_chars': len(cleaned_page['text'])})
            if not cleaned_page['text'] and any(block.get('type') == 'image' for block in source_page.get('blocks', [])):
                count['empty_pages_with_images'] += 1
            for block in source_page.get('blocks', []):
                if block.get('type') == 'table':
                    count['tables'] += 1
                    text = block_text(block)
                    if text and all(row.strip() in indexed for row in text.splitlines() if row.strip()):
                        count['table_text_in_index'] += 1
                    else:
                        missing_rows = [row for row in text.splitlines() if row.strip() and row.strip() not in indexed]
                        problems.append({'path': relative, 'page': cleaned_page['page'], 'kind': 'table',
                                         'missing_row_lengths': [len(row) for row in missing_rows[:5]],
                                         'longest_index_chunk': max((len(c) for c in indexed_pages[(relative, cleaned_page['page'])]), default=0)})
    db.close()
    print(json.dumps({'counts': count, 'sample_problems': problems[:10],
                      'short_samples': short_samples}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
