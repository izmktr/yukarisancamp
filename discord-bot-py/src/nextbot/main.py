from __future__ import annotations

from .config import NextBotConfig
from .runtime import NextBotApp


def main() -> None:
    config = NextBotConfig.from_env()
    app = NextBotApp(config.token, config.input_channel_name, config.scheduled_run_at)
    app.run()


if __name__ == "__main__":
    main()