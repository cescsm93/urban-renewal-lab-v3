"""Create local bge-m3 vectors for PDF chunks, including OCR chunks as they arrive."""

import argparse
import hashlib
import json
import math
import pathlib
import sqlite3
import struct
import time
import urllib.request

from index_local_pdfs import DATABASE


MODEL = 'bge-m3:latest'
OLLAMA = 'http://127.0.0.1:11434/api/embed'


def content_hash(content):
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def pending_chunks(db):
    rows = db.execute('''SELECT f.rowid, f.content, v.content_hash, v.model
        FROM pdf_fts f LEFT JOIN pdf_vectors v ON v.rowid=f.rowid ORDER BY f.rowid''').fetchall()
    return [(rowid, content, content_hash(content)) for rowid, content, saved_hash, model in rows
            if saved_hash != content_hash(content) or model != MODEL]


def embed_batch(texts):
    request = urllib.request.Request(
        OLLAMA, data=json.dumps({'model': MODEL, 'input': texts}, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=180) as response:
        vectors = json.load(response).get('embeddings')
    if not isinstance(vectors, list) or len(vectors) != len(texts) or any(len(row) != 1024 for row in vectors):
        raise RuntimeError('Ollama returned an unexpected embedding batch')
    return vectors


def sparse_remaining(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='pdf_ocr_pages'").fetchone():
        return 0
    total = db.execute('SELECT coalesce(sum(pages-text_pages),0) FROM pdf_documents').fetchone()[0]
    processed = db.execute('SELECT count(*) FROM pdf_ocr_pages').fetchone()[0]
    return max(0, total - processed)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch-size', type=int, default=8)
    parser.add_argument('--limit-batches', type=int, default=0)
    parser.add_argument('--follow-ocr', action='store_true')
    parser.add_argument('--database', type=pathlib.Path, default=DATABASE)
    args = parser.parse_args()
    if args.batch_size < 1 or args.batch_size > 32:
        raise SystemExit('batch-size must be between 1 and 32')
    db = sqlite3.connect(args.database, timeout=30)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA busy_timeout=30000')
    batches = total_indexed = 0
    while True:
        pending = pending_chunks(db)
        if not pending:
            remaining = sparse_remaining(db)
            print(json.dumps({'indexed_this_run': total_indexed, 'pending_chunks': 0,
                              'ocr_pages_remaining': remaining}), flush=True)
            if not args.follow_ocr or remaining == 0:
                break
            time.sleep(30)
            continue
        for offset in range(0, len(pending), args.batch_size):
            batch = pending[offset:offset + args.batch_size]
            while True:
                try:
                    vectors = embed_batch([content for _, content, _ in batch])
                    break
                except Exception as error:
                    print(json.dumps({'retrying_local_ollama_after_seconds': 30,
                                      'error_type': type(error).__name__}), flush=True)
                    time.sleep(30)
            now = int(time.time())
            entries = []
            for (rowid, _, digest), vector in zip(batch, vectors):
                norm = math.sqrt(sum(value * value for value in vector))
                if not norm:
                    raise RuntimeError('Ollama returned a zero vector')
                entries.append((rowid, digest, MODEL, 1024, norm,
                                struct.pack('<1024f', *vector), now))
            with db:
                db.executemany('''INSERT INTO pdf_vectors(rowid,content_hash,model,dims,norm,embedding,created_at)
                    VALUES(?,?,?,?,?,?,?) ON CONFLICT(rowid) DO UPDATE SET
                    content_hash=excluded.content_hash,model=excluded.model,dims=excluded.dims,
                    norm=excluded.norm,embedding=excluded.embedding,created_at=excluded.created_at''', entries)
            batches += 1
            total_indexed += len(batch)
            if batches % 10 == 0 or args.limit_batches and batches >= args.limit_batches:
                print(json.dumps({'indexed_this_run': total_indexed, 'pending_at_start': len(pending),
                                  'ocr_pages_remaining': sparse_remaining(db)}), flush=True)
            if args.limit_batches and batches >= args.limit_batches:
                db.close()
                return
    db.close()


if __name__ == '__main__':
    main()
