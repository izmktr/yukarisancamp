from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class NextBotConfig:
    token: str
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

        input_channel_name = os.getenv("NEXTBOT_INPUT_CHANNEL", "").strip() or "凸報告"
        scheduled_run_at = os.getenv("NEXTBOT_RUN_AT", "").strip() or None
        return cls(token=token, input_channel_name=input_channel_name, scheduled_run_at=scheduled_run_at)