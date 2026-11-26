"""Resume-friendly offline OCR for PDF pages without extractable text."""

import argparse
import json
import logging
import pathlib
import sqlite3
import time

import pymupdf
from rapidocr import RapidOCR

from index_local_pdfs import CONFIG, DATABASE, chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit-pages', type=int, default=0, help='Stop after this many pages; 0 means all')
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    vault = pathlib.Path(config['indexPath']).parent.parent
    db = sqlite3.connect(DATABASE)
    db.execute('PRAGMA journal_mode=WAL')
    logging.getLogger('RapidOCR').setLevel(logging.ERROR)
    engine = RapidOCR()
    rows = db.execute("SELECT path FROM pdf_documents WHERE status IN ('scan_only','mixed') ORDER BY CASE status WHEN 'scan_only' THEN 0 ELSE 1 END, path").fetchall()
    summary = {'documents': len(rows), 'attempted_pages': 0, 'recognized_pages': 0,
               'empty_pages': 0, 'errors': 0, 'characters': 0}
    for (relative,) in rows:
        try:
            document = pymupdf.open(vault / relative)
            if document.needs_pass:
                continue
        except Exception:
            summary['errors'] += 1
            continue
        for page_number, page in enumerate(document, 1):
            if len(page.get_text('text').strip()) >= 80:
                continue
            if db.execute('SELECT 1 FROM pdf_ocr_pages WHERE path=? AND page=?', (relative, page_number)).fetchone():
                continue
            try:
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
                result = engine(pixmap.tobytes('png'))
                recognized = '\n'.join(result.txts or ())
                pieces = list(chunks(recognized))
                status = 'ocr' if pieces else 'empty'
                with db:
                    db.executemany('INSERT INTO pdf_fts(path,page,content) VALUES(?,?,?)',
                                   [(relative, page_number, piece) for piece in pieces])
                    db.execute('INSERT INTO pdf_ocr_pages(path,page,status,chars,indexed_at) VALUES(?,?,?,?,?)',
                               (relative, page_number, status, len(recognized), int(time.time())))
                summary['recognized_pages' if pieces else 'empty_pages'] += 1
                summary['characters'] += len(recognized)
            except Exception:
                summary['errors'] += 1
                with db:
                    db.execute('INSERT INTO pdf_ocr_pages(path,page,status,chars,indexed_at) VALUES(?,?,?,?,?)',
                               (relative, page_number, 'error', 0, int(time.time())))
            summary['attempted_pages'] += 1
            if summary['attempted_pages'] % 10 == 0:
                print(json.dumps(summary), flush=True)
            if args.limit_pages and summary['attempted_pages'] >= args.limit_pages:
                db.close()
                print(json.dumps(summary), flush=True)
                return
    db.close()
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
