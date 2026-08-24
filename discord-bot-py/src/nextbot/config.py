from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class NextBotConfig:
    token: str
    supabase_url: str
    supabase_secret_key: str
    yukalink_common_key: str
    input_channel_name: str = "凸報告"
    scheduled_run_at: str | None = None

    @classmethod
    def from_env(cls, env_file_name: str = ".env.local") -> "NextBotConfig":
        base_dir = Path(__file__).resolve().parent
        env_file = base_dir / env_file_name
        load_dotenv(env_file)

        token = os.getenv("DISCORD_TOKEN", "").strip() or os.getenv("DISCORD_BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "Discord のトークンが見つかりません。.env.local に DISCORD_TOKEN または DISCORD_BOT_TOKEN を設定してください"
            )

        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        supabase_secret_key = os.getenv("SUPABASE_SECRET_KEY", "").strip()
        if not supabase_url or not supabase_secret_key:
            raise RuntimeError(
                "Supabase の接続情報が見つかりません。.env.local に SUPABASE_URL と SUPABASE_SECRET_KEY を設定してください"
            )

        yukalink_common_key = os.getenv("YUKALINK_COMMON_KEY", "").strip()
        if not yukalink_common_key:
            raise RuntimeError(
                "YUKALINK_COMMON_KEY が見つかりません。.env.local に設定してください"
            )

        input_channel_name = os.getenv("NEXTBOT_INPUT_CHANNEL", "").strip() or "凸報告"
        scheduled_run_at = os.getenv("NEXTBOT_RUN_AT", "").strip() or None
        return cls(
            token=token,
            supabase_url=supabase_url,
            supabase_secret_key=supabase_secret_key,
            yukalink_common_key=yukalink_common_key,
            input_channel_name=input_channel_name,
            scheduled_run_at=scheduled_run_at,
        )