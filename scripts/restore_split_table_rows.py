"""Keep long MinerU table rows intact when a character chunk boundary splits them."""

import hashlib
import json
import sqlite3
from collections import defaultdict

from clean_mineru_middle import block_text
from index_local_pdfs import PROJECT


DATABASE = PROJECT / '.local-data' / 'policy-mineru-index.sqlite'
CACHE = PROJECT / '.local-data' / 'mineru-cache'


def main():
    db = sqlite3.connect(DATABASE, timeout=30)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA busy_timeout=30000')
    indexed = defaultdict(list)
    for path, page, content in db.execute('SELECT path,page,content FROM pdf_fts'):
        indexed[(path, page)].append(content)
    added = 0
    for path, size, mtime_ns in db.execute('SELECT path,size,mtime_ns FROM pdf_documents').fetchall():
        signature = f'{path}:{size}:{mtime_ns}'
        cache_file = CACHE / (hashlib.sha256(signature.encode('utf-8')).hexdigest() + '.json')
        if not cache_file.exists():
            continue
        document = json.loads(cache_file.read_text(encoding='utf-8'))
        rows = []
        for page in document.get('pages', []):
            page_number = page['page_idx'] + 1
            chunks = indexed[(path, page_number)]
            for block in page.get('blocks', []):
                if block.get('type') != 'table':
                    continue
                lines = [line.strip() for line in block_text(block).splitlines() if line.strip()]
                if not lines:
                    continue
                header = lines[0]
                for line in lines:
                    if not any(line in chunk for chunk in chunks):
                        content = f'资料：{path.rsplit("/", 1)[-1]}\n【表格完整行补录】\n表头：{header}\n{line}'
                        rows.append((path, page_number, content, '表格完整行补录'))
                        chunks.append(content)
        if rows:
            with db:
                db.executemany('INSERT INTO pdf_fts(path,page,content,tags) VALUES(?,?,?,?)', rows)
                db.execute('UPDATE pdf_documents SET chunks=chunks+? WHERE path=?', (len(rows), path))
            added += len(rows)
    db.close()
    print(json.dumps({'restored_table_rows': added}, ensure_ascii=False))


if __name__ == '__main__':
    main()
