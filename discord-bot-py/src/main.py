from bot import BotConfig, SupabaseClient
from legacy_bot import LegacyDiscordBotApp


def main() -> None:
    config = BotConfig.from_env()
    supabase_client = SupabaseClient(config.supabase_url, config.supabase_secret_key)
    clanbattle_setting = supabase_client.fetch_clanbattle_setting()
    app = LegacyDiscordBotApp(config.token, clanbattle_setting)
    app.run()


if __name__ == "__main__":
    main()
