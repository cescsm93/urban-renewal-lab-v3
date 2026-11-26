import sys
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from clean_mineru_middle import clean_document
from restore_missing_mineru_pages import restore


class MineruIndexTest(unittest.TestCase):
    def test_table_and_page_evidence_survive_layout_cleanup(self):
        document = {'schema': 'docvortex.middle', 'pages': [
            {'page_idx': 4, 'blocks': [
                {'type': 'header', 'content': [{'type': 'text', 'content': '重复页眉'}]},
                {'type': 'paragraph_title', 'content': [{'type': 'text', 'content': '养老服务'}]},
                {'type': 'table', 'content': [{'type': 'html', 'content': '<table><tr><th>名称</th><th>半径</th></tr><tr><td>养老站</td><td>500米</td></tr></table>'}]},
                {'type': 'page_number', 'content': [{'type': 'text', 'content': '5'}]},
                {'type': 'footer', 'content': [{'type': 'text', 'content': '重复页脚'}]},
            ]}
        ]}
        pages, removed, skipped = clean_document(document, '上海/政策.pdf')
        self.assertEqual(pages[0]['page'], 5)
        self.assertIn('养老站 | 500米', pages[0]['text'])
        self.assertIn('养老服务', pages[0]['tags'])
        self.assertNotIn('重复页眉', pages[0]['text'])
        self.assertEqual(removed, {'header': 1, 'page_number': 1, 'footer': 1})
        self.assertEqual(skipped, {})

    def test_old_ocr_only_restores_missing_page_once(self):
        with tempfile.TemporaryDirectory() as temp:
            old_path, new_path = Path(temp) / 'old.sqlite', Path(temp) / 'new.sqlite'
            with closing(sqlite3.connect(old_path)) as old:
                old.execute("CREATE VIRTUAL TABLE pdf_fts USING fts5(path UNINDEXED,page UNINDEXED,content,tokenize='trigram')")
                old.executemany('INSERT INTO pdf_fts VALUES(?,?,?)', [
                    ('policy.pdf', 1, '已有正文'), ('policy.pdf', 2, '扫描页正文')])
                old.commit()
            with closing(sqlite3.connect(new_path)) as new:
                new.execute('CREATE TABLE pdf_documents(path TEXT PRIMARY KEY,pages INTEGER,chunks INTEGER)')
                new.execute('INSERT INTO pdf_documents VALUES(?,?,?)', ('policy.pdf', 2, 1))
                new.execute("CREATE VIRTUAL TABLE pdf_fts USING fts5(path UNINDEXED,page UNINDEXED,content,tags,tokenize='trigram')")
                new.execute('INSERT INTO pdf_fts VALUES(?,?,?,?)', ('policy.pdf', 1, '已有正文', ''))
                new.commit()
            self.assertEqual(restore(old_path, new_path)['restored_chunks'], 1)
            self.assertEqual(restore(old_path, new_path)['restored_chunks'], 0)
            with closing(sqlite3.connect(new_path)) as new:
                self.assertEqual(new.execute('SELECT chunks FROM pdf_documents').fetchone()[0], 2)
                self.assertIn('旧OCR补充', new.execute('SELECT content FROM pdf_fts WHERE page=2').fetchone()[0])


if __name__ == '__main__':
    unittest.main()
