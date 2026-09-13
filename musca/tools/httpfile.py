"""Seekable HTTP file object backed by Range requests.

Lets pyarrow read selected row-groups of a multi-GB remote Arrow/Feather file
without downloading the whole thing.
"""
import io
import requests


class HttpRangeFile(io.RawIOBase):
    def __init__(self, url, block_size=1 << 22, timeout=120):
        self.url = url
        self.pos = 0
        self.block_size = block_size
        self.timeout = timeout
        self.session = requests.Session()
        r = self.session.head(url, allow_redirects=True, timeout=timeout)
        self.size = int(r.headers.get("Content-Length", 0))
        self.accept_ranges = r.headers.get("Accept-Ranges", "")
        self._cache = {}
        self.bytes_downloaded = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        elif whence == io.SEEK_END:
            self.pos = self.size + offset
        return self.pos

    def tell(self):
        return self.pos

    def _block(self, idx):
        if idx not in self._cache:
            start = idx * self.block_size
            end = min(start + self.block_size, self.size) - 1
            if end < start:
                return b""
            r = self.session.get(
                self.url,
                headers={"Range": f"bytes={start}-{end}"},
                timeout=self.timeout,
            )
            r.raise_for_status()
            self.bytes_downloaded += len(r.content)
            self._cache[idx] = r.content
            if len(self._cache) > 6:
                self._cache.pop(next(iter(self._cache)))
        return self._cache[idx]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0:
            return b""
        out = bytearray()
        while len(out) < n and self.pos < self.size:
            idx, off = divmod(self.pos, self.block_size)
            blk = self._block(idx)
            if not blk:
                break
            take = min(n - len(out), len(blk) - off)
            out += blk[off:off + take]
            self.pos += take
        return bytes(out)

    def readinto(self, b):
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)
