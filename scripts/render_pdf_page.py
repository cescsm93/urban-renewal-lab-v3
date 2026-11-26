"""Render one page of a locally indexed PDF for the authenticated LAN viewer."""

import sys

import pymupdf


def main():
    if len(sys.argv) != 3:
        raise SystemExit(2)
    page_number = int(sys.argv[2])
    with pymupdf.open(sys.argv[1]) as document:
        if page_number < 1 or page_number > len(document):
            raise SystemExit(2)
        page = document[page_number - 1]
        zoom = min(1.6, 1800 / max(page.rect.width, page.rect.height))
        image = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        sys.stdout.buffer.write(image.tobytes('png'))


if __name__ == '__main__':
    main()
