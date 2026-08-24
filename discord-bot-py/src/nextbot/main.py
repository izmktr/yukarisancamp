from __future__ import annotations

from .config import NextBotConfig
from .runtime import NextBotApp


def main() -> None:
    config = NextBotConfig.from_env()
    app = NextBotApp(
        token=config.token,
        supabase_url=config.supabase_url,
        supabase_secret_key=config.supabase_secret_key,
        yukalink_common_key=config.yukalink_common_key,
        input_channel_name=config.input_channel_name,
        scheduled_run_at=config.scheduled_run_at,
    )
    app.run()


if __name__ == "__main__":
    main()