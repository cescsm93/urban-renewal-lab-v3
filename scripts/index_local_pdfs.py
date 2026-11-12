"""Extract searchable text from PDFs into a local, git-ignored SQLite index."""

import json
import pathlib
import sqlite3
import sys
import time

import pymupdf


PROJECT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = PROJECT / '.local-data' / 'knowledge-config.json'
DATABASE = PROJECT / '.local-data' / 'policy-pdf-index.sqlite'


def chunks(text, size=1800, overlap=180):
    text = ' '.join(text.split())
    if len(text) < 80:
        return
    for start in range(0, len(text), size - overlap):
        piece = text[start:start + size]
        if len(piece) >= 80:
            yield piece
        if start + size >= len(text):
            break


def main():
    config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    vault = pathlib.Path(config['indexPath']).parent.parent
    if not vault.is_dir():
        raise SystemExit('Obsidian vault directory not found')
    pdfs = sorted(vault.rglob('*.pdf'))
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=NORMAL')
    db.execute('''CREATE TABLE IF NOT EXISTS pdf_documents (
        path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL,
        pages INTEGER NOT NULL, text_pages INTEGER NOT NULL, chunks INTEGER NOT NULL,
        status TEXT NOT NULL, indexed_at INTEGER NOT NULL
    )''')
    db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS pdf_fts USING fts5(path UNINDEXED, page UNINDEXED, content, tokenize='trigram')")
    db.execute('''CREATE TABLE IF NOT EXISTS pdf_ocr_pages (
        path TEXT NOT NULL, page INTEGER NOT NULL, status TEXT NOT NULL,
        chars INTEGER NOT NULL, indexed_at INTEGER NOT NULL,
        PRIMARY KEY(path, page)
    )''')
    db.execute('''CREATE TABLE IF NOT EXISTS pdf_vectors (
        rowid INTEGER PRIMARY KEY, content_hash TEXT NOT NULL, model TEXT NOT NULL,
        dims INTEGER NOT NULL, norm REAL NOT NULL, embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL
    )''')
    summary = {'pdfs': len(pdfs), 'updated': 0, 'skipped': 0, 'text_documents': 0,
               'scan_only': 0, 'failed': 0, 'pages': 0, 'text_pages': 0, 'chunks': 0}
    for number, file in enumerate(pdfs, 1):
        relative = file.relative_to(vault).as_posix()
        stat = file.stat()
        previous = db.execute('SELECT size, mtime_ns, status FROM pdf_documents WHERE path=?', (relative,)).fetchone()
        if previous and previous[:2] == (stat.st_size, stat.st_mtime_ns):
            summary['skipped'] += 1
            continue
        pages = text_pages = count = 0
        entries = []
        status = 'text'
        try:
            document = pymupdf.open(file)
            if document.needs_pass:
                status = 'locked'
            else:
                pages = len(document)
                for page_number, page in enumerate(document, 1):
                    text = page.get_text('text')
                    pieces = list(chunks(text))
                    if pieces:
                        text_pages += 1
                        entries.extend((relative, page_number, piece) for piece in pieces)
                        count += len(pieces)
                if text_pages == 0:
                    status = 'scan_only'
                elif text_pages < pages:
                    status = 'mixed'
        except Exception:
            status = 'error'
        with db:
            db.execute('DELETE FROM pdf_vectors WHERE rowid IN (SELECT rowid FROM pdf_fts WHERE path=?)', (relative,))
            db.execute('DELETE FROM pdf_fts WHERE path=?', (relative,))
            db.execute('DELETE FROM pdf_ocr_pages WHERE path=?', (relative,))
            db.executemany('INSERT INTO pdf_fts(path,page,content) VALUES(?,?,?)', entries)
            db.execute('''INSERT INTO pdf_documents(path,size,mtime_ns,pages,text_pages,chunks,status,indexed_at)
                VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
                size=excluded.size,mtime_ns=excluded.mtime_ns,pages=excluded.pages,
                text_pages=excluded.text_pages,chunks=excluded.chunks,status=excluded.status,
                indexed_at=excluded.indexed_at''',
                (relative, stat.st_size, stat.st_mtime_ns, pages, text_pages, count, status, int(time.time())))
        summary['updated'] += 1
        summary['pages'] += pages
        summary['text_pages'] += text_pages
        summary['chunks'] += count
        if status == 'scan_only':
            summary['scan_only'] += 1
        elif status in ('locked', 'error'):
            summary['failed'] += 1
        else:
            summary['text_documents'] += 1
        if number % 25 == 0:
            print(json.dumps({'processed': number, 'total': len(pdfs), 'chunks': summary['chunks']}), flush=True)
    db.close()
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
