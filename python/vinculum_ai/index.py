"""
Download and cache the pre-built Vinculum FAISS index from GitHub releases.

The index is generated from the official Vinculum documentation and published
as a release artifact on tsarna/vinculum. It is cached locally at:

    ~/.cache/vinculum-ai/index/{version}/

so that subsequent queries are instant — no re-download, no re-embedding.
"""

from __future__ import annotations

import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from urllib.error import HTTPError, URLError

RELEASES_BASE = "https://github.com/tsarna/vinculum/releases"
ARTIFACT = "vinculum-index.tar.gz"
CACHE_ROOT = Path.home() / ".cache" / "vinculum-ai" / "index"


def _artifact_url(version: str) -> str:
    if version == "latest":
        return f"{RELEASES_BASE}/latest/download/{ARTIFACT}"
    return f"{RELEASES_BASE}/download/{version}/{ARTIFACT}"


def cached_path(version: str) -> Path:
    return CACHE_ROOT / version


def ensure_index(version: str = "latest", refresh: bool = False) -> Path:
    """
    Return the path to a local FAISS index directory, downloading if needed.

    Args:
        version: "latest" or a specific release tag (e.g. "v1.2.0").
        refresh: Force re-download even if a cached copy already exists.

    Returns:
        Path to a directory containing index.faiss and index.pkl.
    """
    dest = cached_path(version)

    if dest.exists() and not refresh:
        return dest

    url = _artifact_url(version)
    action = "Refreshing" if dest.exists() else "Downloading"
    print(f"{action} Vinculum index ({version})…", file=sys.stderr)

    dest.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        urllib.request.urlretrieve(url, tmp_path)
    except HTTPError as e:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Could not download Vinculum index for version {version!r} "
            f"(HTTP {e.code}).\n"
            f"Check that the release exists and has a '{ARTIFACT}' asset:\n"
            f"  {url}"
        ) from e
    except URLError as e:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Network error while downloading index: {e.reason}"
        ) from e

    try:
        with tarfile.open(tmp_path) as tar:
            # The archive contains index.faiss and index.pkl directly at the root.
            # These are the two files produced by LangChain's FAISS.save_local().
            tar.extractall(dest)  # noqa: S202 — archive from our own releases
    finally:
        tmp_path.unlink(missing_ok=True)

    print(f"Index cached at {dest}", file=sys.stderr)
    return dest
