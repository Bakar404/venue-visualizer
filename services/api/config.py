import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from pipeline.registry import dev_mode

REPO = Path(__file__).resolve().parents[2]
LOCAL_WEB_URL = "http://localhost:3000"


def _env_list(key: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in os.environ.get(key, "").split(",") if value.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    dev: bool = False
    web_url: str = LOCAL_WEB_URL
    inline_jobs: bool = False
    lan: bool = False
    lan_proxy_key: str | None = field(default=None, repr=False)
    engine_limits: dict[str, int] = field(default_factory=dict)
    allowed_hosts: tuple[str, ...] = field(default_factory=lambda: _env_list("VV_ALLOWED_HOSTS"))
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: _env_list("VV_ALLOWED_ORIGINS"))

    def __post_init__(self) -> None:
        # Resolve symlinks (e.g. macOS /var -> /private/var) so storage path checks hold.
        object.__setattr__(self, "data_dir", Path(self.data_dir).expanduser().resolve())
        if any("*" in host for host in self.allowed_hosts):
            raise ValueError("VV_ALLOWED_HOSTS must list exact hosts, not wildcards")
        if "*" in self.allowed_origins:
            raise ValueError("VV_ALLOWED_ORIGINS must list exact origins, not wildcards")

    @property
    def lan_mode(self) -> bool:
        """LAN mode is only on under `make dev-lan`, which sets VV_LAN=1 and a fresh proxy attestation key."""
        return self.lan and bool(self.lan_proxy_key)

    @property
    def web_port(self) -> int:
        return urlsplit(self.web_url).port or 3000

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
            dev=dev_mode(),
            web_url=os.environ.get("VV_WEB_URL") or LOCAL_WEB_URL,
            inline_jobs=os.environ.get("VV_INLINE_JOBS") == "1",
            lan=os.environ.get("VV_LAN") == "1",
            lan_proxy_key=os.environ.get("VV_LAN_PROXY_KEY") or None,
            engine_limits=limits,
        )
