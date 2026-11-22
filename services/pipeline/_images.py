"""Small image helpers shared by engines and verify."""
from __future__ import annotations

from functools import cache


@cache
def register_heif() -> bool:
    """Let Pillow open HEIC/HEIF uploads (iPhone photos) when pillow-heif is installed."""
    try:
        from pillow_heif import register_heif_opener
    except ImportError:
        return False
    register_heif_opener()
    return True
