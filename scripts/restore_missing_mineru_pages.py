"""Restore pages missed by MinerU from the prior local OCR index, with a label.

Run only after MinerU's full document pass finishes. Re-running is safe.
"""

import argparse
import hashlib
import json
import pathlib
import sqlite3

from clean_mineru_middle import clean_document
from index_local_pdfs import PROJECT


OLD = PROJECT / '.local-data' / 'policy-pdf-index.sqlite'
NEW = PROJECT / '.local-data' / 'policy-mineru-index.sqlite'


def restore(old_path, new_path, include_short=False):
    old = sqlite3.connect(f'file:{old_path.as_posix()}?mode=ro', uri=True)
    new = sqlite3.connect(new_path, timeout=30)
    new.execute('PRAGMA journal_mode=WAL')
    new.execute('PRAGMA busy_timeout=30000')
    documents = dict(new.execute('SELECT path,pages FROM pdf_documents'))
    covered = set(new.execute('SELECT path,page FROM pdf_fts'))
    supplemented = set(new.execute("SELECT path,page FROM pdf_fts WHERE content LIKE '【旧OCR补充%'"))
    short_pages = set()
    if include_short:
        old_lengths = {(path, page): chars for path, page, chars in old.execute(
            'SELECT path,page,sum(length(content)) FROM pdf_fts GROUP BY path,page')}
        for path, size, mtime_ns in new.execute('SELECT path,size,mtime_ns FROM pdf_documents'):
            signature = f'{path}:{size}:{mtime_ns}'
            cache_file = PROJECT / '.local-data' / 'mineru-cache' / (
                hashlib.sha256(signature.encode('utf-8')).hexdigest() + '.json')
            if not cache_file.exists():
                continue
            pages, _, _ = clean_document(json.loads(cache_file.read_text(encoding='utf-8')), path)
            short_pages.update((path, page['page']) for page in pages
                if page['text'] and old_lengths.get((path, page['page']), 0) > 200
                and len(page['text']) * 2 < old_lengths[(path, page['page'])])
    supplements = {}
    for path, page, content in old.execute('SELECT path,page,content FROM pdf_fts'):
        missing = (path, page) not in covered
        short = (path, page) in short_pages
        if path in documents and page <= documents[path] and (missing or short) and (path, page) not in supplemented:
            supplements.setdefault(path, []).append((path, page,
                ('【旧OCR补充：MinerU未提取此页正文，需人工核对】\n' if missing else
                 '【旧OCR补充：MinerU此页文字明显较少，需人工核对】\n') + content,
                '旧OCR补充'))
    inserted = 0
    for path, rows in supplements.items():
        with new:
            new.executemany('INSERT INTO pdf_fts(path,page,content,tags) VALUES(?,?,?,?)', rows)
            new.execute('UPDATE pdf_documents SET chunks=chunks+? WHERE path=?', (len(rows), path))
        inserted += len(rows)
    old.close()
    new.close()
    return {'documents': len(supplements), 'restored_chunks': inserted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old', type=pathlib.Path, default=OLD)
    parser.add_argument('--new', type=pathlib.Path, default=NEW)
    parser.add_argument('--include-short', action='store_true')
    args = parser.parse_args()
    print(json.dumps(restore(args.old, args.new, args.include_short), ensure_ascii=False))


if __name__ == '__main__':
    main()
