"""Build a separate, local MinerU policy index without replacing the live index.

Run with a small --limit first. Re-running skips unchanged files; source PDFs
and parsed JSON remain local. Use vectorize_local_pdfs.py --database to embed.
"""

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import time

from clean_mineru_middle import clean_document
from index_local_pdfs import CONFIG, PROJECT


DATABASE = PROJECT / '.local-data' / 'policy-mineru-index.sqlite'
CACHE = PROJECT / '.local-data' / 'mineru-cache'


def prepare(db):
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA busy_timeout=30000')
    db.execute('''CREATE TABLE IF NOT EXISTS pdf_documents (
        path TEXT PRIMARY KEY, size INTEGER, mtime_ns INTEGER, pages INTEGER,
        chunks INTEGER, status TEXT, indexed_at INTEGER)''')
    db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS pdf_fts USING fts5(path UNINDEXED, page UNINDEXED, content, tags, tokenize='trigram')")
    db.execute('''CREATE TABLE IF NOT EXISTS pdf_vectors (
        rowid INTEGER PRIMARY KEY, content_hash TEXT NOT NULL, model TEXT NOT NULL,
        dims INTEGER NOT NULL, norm REAL NOT NULL, embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL)''')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=0, help='Number of documents; 0 means all')
    parser.add_argument('--mineru-kit', default=os.getenv('MINERU_KIT') or shutil.which('mineru-kit'))
    parser.add_argument('--database', type=pathlib.Path, default=DATABASE)
    parser.add_argument('--cache-dir', type=pathlib.Path, default=CACHE)
    parser.add_argument('--path', help='Process one PDF path relative to the vault')
    parser.add_argument('--force', action='store_true', help='Reparse even when the PDF is unchanged')
    parser.add_argument('--vectorize', action='store_true', help='Embed all parsed chunks after indexing')
    args = parser.parse_args()
    if not args.mineru_kit:
        parser.error('MinerU executable missing: provide --mineru-kit')
    config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    vault = pathlib.Path(config['indexPath']).parent.parent
    pdfs = [vault / args.path] if args.path else sorted(vault.rglob('*.pdf'))
    args.database.parent.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.database, timeout=30)
    prepare(db)
    stats = {'total': len(pdfs), 'updated': 0, 'skipped': 0, 'failed': 0,
             'chunks': 0, 'layout_removed': {}, 'skipped_blocks': {}}
    for file in pdfs:
        relative = file.relative_to(vault).as_posix()
        stat = file.stat()
        previous = db.execute('SELECT size,mtime_ns,status FROM pdf_documents WHERE path=?', (relative,)).fetchone()
        if not args.force and previous == (stat.st_size, stat.st_mtime_ns, 'ready'):
            stats['skipped'] += 1
            continue
        signature = f'{relative}:{stat.st_size}:{stat.st_mtime_ns}'
        cache_file = args.cache_dir / (hashlib.sha256(signature.encode('utf-8')).hexdigest() + '.json')
        try:
            if not cache_file.exists():
                run = subprocess.run([args.mineru_kit, 'parse', str(file), '-o', str(cache_file),
                                      '--tier', 'standard', '--ocr-mode', 'auto', '--format', 'middle_json'],
                                     capture_output=True, timeout=1800)
                if run.returncode:
                    raise RuntimeError(f'MinerU exit {run.returncode}')
            document = json.loads(cache_file.read_text(encoding='utf-8'))
            pages, removed, skipped = clean_document(document, relative)
            if skipped.get('unreadable_table'):
                raise ValueError(f'{skipped["unreadable_table"]} table(s) had no extractable text')
            entries = []
            for page in pages:
                for chunk in page['chunks']:
                    tags = page['tags']
                    content = f"资料：{file.stem}\n" + (f"栏目：{'、'.join(tags[-4:])}\n" if tags else '') + chunk
                    entries.append((relative, page['page'], content, ' '.join(tags)))
            with db:
                db.execute('DELETE FROM pdf_vectors WHERE rowid IN (SELECT rowid FROM pdf_fts WHERE path=?)', (relative,))
                db.execute('DELETE FROM pdf_fts WHERE path=?', (relative,))
                db.executemany('INSERT INTO pdf_fts(path,page,content,tags) VALUES(?,?,?,?)', entries)
                db.execute('''INSERT INTO pdf_documents(path,size,mtime_ns,pages,chunks,status,indexed_at)
                    VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
                    size=excluded.size,mtime_ns=excluded.mtime_ns,pages=excluded.pages,
                    chunks=excluded.chunks,status=excluded.status,indexed_at=excluded.indexed_at''',
                    (relative, stat.st_size, stat.st_mtime_ns, len(pages), len(entries), 'ready', int(time.time())))
            stats['updated'] += 1
            stats['chunks'] += len(entries)
            for key, count in removed.items():
                stats['layout_removed'][key] = stats['layout_removed'].get(key, 0) + count
            for key, count in skipped.items():
                stats['skipped_blocks'][key] = stats['skipped_blocks'].get(key, 0) + count
        except Exception as error:
            stats['failed'] += 1
            print(json.dumps({'file': relative, 'error': str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        if (stats['updated'] + stats['failed']) % 10 == 0:
            print(json.dumps(stats, ensure_ascii=False), flush=True)
        if args.limit and stats['updated'] + stats['failed'] >= args.limit:
            break
    db.close()
    print(json.dumps(stats, ensure_ascii=False), flush=True)
    if args.vectorize:
        subprocess.run([sys.executable, str(PROJECT / 'scripts' / 'vectorize_local_pdfs.py'),
                        '--database', str(args.database)], check=True)
    if args.vectorize and not args.path and stats['failed'] == 0 and stats['updated'] + stats['skipped'] == len(pdfs):
        marker = PROJECT / '.local-data' / 'policy-mineru-ready.json'
        marker.write_text(json.dumps({'documents': len(pdfs), 'completed_at': int(time.time()),
                                      'database': str(args.database)}, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
