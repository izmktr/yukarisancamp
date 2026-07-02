from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class BotConfig:
    token: str
    env_file: Path
    supabase_url: str
    supabase_secret_key: str

    @classmethod
    def from_env(cls, env_file_name: str = ".env.local") -> "BotConfig":
        base_dir = Path(__file__).resolve().parent.parent
        env_file = base_dir / env_file_name
        load_dotenv(env_file)

        token = os.getenv("DISCORD_TOKEN", "").strip() or os.getenv("DISCORD_BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "Discord のトークンが見つかりません。.env.local に DISCORD_TOKEN または DISCORD_BOT_TOKEN を設定してください"
            )

        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        if not supabase_url:
            raise RuntimeError("SUPABASE_URL が見つかりません。.env.local を確認してください")

        supabase_secret_key = os.getenv("SUPABASE_SECRET_KEY", "").strip()
        if not supabase_secret_key:
            raise RuntimeError("SUPABASE_SECRET_KEY が見つかりません。.env.local を確認してください")

        return cls(
            token=token,
            env_file=env_file,
            supabase_url=supabase_url,
            supabase_secret_key=supabase_secret_key,
        )
