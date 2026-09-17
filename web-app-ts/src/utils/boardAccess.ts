type Article = {
  authorid?: unknown;
  author_id?: unknown;
  visibility?: unknown;
  authorclanid?: unknown;
  setting?: unknown;
};

type User = { googleUserId?: unknown; discordServer?: unknown } | undefined;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function canEditArticle(article: Article, user: User): boolean {
  const userId = text(user?.googleUserId);
  const authorId = text(article.author_id ?? article.authorid);
  return userId.length > 0 && authorId.length > 0 && userId === authorId;
}

export function canViewArticle(article: Article, user: User): boolean {
  const visibility = text(article.visibility).toLowerCase();
  if (visibility === 'all') return true;
  if (!text(user?.googleUserId)) return false;
  if (canEditArticle(article, user)) return true;
  if (visibility !== 'clan') return false;

  const setting = article.setting && typeof article.setting === 'object'
    ? article.setting as Record<string, unknown> : {};
  const clanId = text(article.authorclanid) || text(setting.discord_server);
  return clanId.length > 0 && clanId === text(user?.discordServer);
}
