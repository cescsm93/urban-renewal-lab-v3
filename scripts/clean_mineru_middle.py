"""Convert local MinerU Middle JSON into page-aware text for retrieval.

The source PDF is never modified. Keep physical page numbers as metadata while
excluding layout-only header/footer/page-number blocks from indexed content.
"""

import argparse
import json
from html.parser import HTMLParser
from pathlib import Path


LAYOUT_ONLY = {"header", "footer", "page_number"}
TEXT_BLOCKS = {"text", "doc_title", "paragraph_title", "list", "list_item", "code", "table", "table_caption", "image_caption", "footnote"}


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in {"td", "th"}:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.cell is not None and self.row is not None:
            self.row.append(" ".join(" ".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(" | ".join(self.row))
            self.row = None


def values(node):
    if isinstance(node, str):
        if "<tr" in node.lower():
            table = TableRows()
            table.feed(node)
            if table.rows:
                return table.rows
        return [node.strip()] if node.strip() else []
    if isinstance(node, list):
        return [part for child in node for part in values(child)]
    if not isinstance(node, dict):
        return []
    if isinstance(node.get("html"), str):
        table = TableRows()
        table.feed(node["html"])
        if table.rows:
            return table.rows
    return values(node.get("content", node.get("text", [])))


def block_text(block):
    parts = values(block.get("content", []))
    return "\n".join(parts) if block.get("type") == "table" else " ".join(parts)


def overlapping_chunks(text, size=1600, overlap=160):
    """Cover every character; retain physical page boundaries and overlap."""
    text = text.strip()
    if not text:
        return []
    pieces = []
    for start in range(0, len(text), size - overlap):
        pieces.append(text[start:start + size])
        if start + size >= len(text):
            break
    return pieces


def source_tags(source, headings):
    folders = [part for part in Path(source).parts[:-1] if part not in {".", ".."}]
    clean_headings = [" ".join(title.split())[:80] for title in headings if title.strip()]
    return list(dict.fromkeys([*folders[-2:], *clean_headings[-4:]]))


def clean_document(document, source=""):
    if document.get("schema") != "docvortex.middle":
        raise ValueError("Expected MinerU Middle JSON (docvortex.middle)")
    pages = []
    removed = {}
    skipped = {}
    for page in document.get("pages", []):
        paragraphs = []
        headings = []
        for block in page.get("blocks", []):
            kind = block.get("type")
            if kind in LAYOUT_ONLY:
                removed[kind] = removed.get(kind, 0) + 1
            elif kind in TEXT_BLOCKS:
                content = block_text(block)
                if content:
                    paragraphs.append(content)
                    if kind in {"doc_title", "paragraph_title"}:
                        headings.append(content)
                elif kind == "table":
                    skipped["unreadable_table"] = skipped.get("unreadable_table", 0) + 1
            else:
                skipped[kind or "unknown"] = skipped.get(kind or "unknown", 0) + 1
        text = "\n".join(paragraphs)
        pages.append({"page": page["page_idx"] + 1, "text": text,
                      "tags": source_tags(source, headings), "chunks": overlapping_chunks(text)})
    return pages, removed, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Local MinerU Middle JSON")
    parser.add_argument("output", type=Path, help="Local cleaned page JSON")
    args = parser.parse_args()
    document = json.loads(args.input.read_text(encoding="utf-8"))
    pages, removed, skipped = clean_document(document, args.input.stem)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"pages": pages, "removed": removed, "skipped": skipped}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pages": len(pages), "chars": sum(len(page["text"]) for page in pages), "removed": removed, "skipped": skipped}, ensure_ascii=False))


if __name__ == "__main__":
    main()
