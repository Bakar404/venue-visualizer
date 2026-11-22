import os
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOCAL_WEB_URL = "http://localhost:3000"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    dev: bool = False
    web_url: str = LOCAL_WEB_URL
    inline_jobs: bool = False
    engine_limits: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Resolve symlinks (e.g. macOS /var -> /private/var) so storage path checks hold.
        object.__setattr__(self, "data_dir", Path(self.data_dir).expanduser().resolve())

    @classmethod
    def from_env(cls) -> "Settings":
        prefix = "VV_ENGINE_CONCURRENCY_"
        limits = {}
        for key, value in os.environ.items():
            if key.startswith(prefix):
                if not value.isdecimal() or not 1 <= int(value) <= 32:
                    raise ValueError(f"{key} must be an integer from 1 to 32")
                limits[f"engine:{key.removeprefix(prefix).lower()}"] = int(value)
        return cls(
            data_dir=Path(os.environ.get("VV_DATA_DIR") or REPO / "data").expanduser().resolve(),
            dev=os.environ.get("VV_DEV") == "1",
            web_url=os.environ.get("VV_WEB_URL") or LOCAL_WEB_URL,
            inline_jobs=os.environ.get("VV_INLINE_JOBS") == "1",
            engine_limits=limits,
        )
