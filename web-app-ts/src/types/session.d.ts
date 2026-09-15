import 'express-session';

declare module 'express-session' {
  interface SessionData {
    editingArticle?: any;
    discordLinkChallenge?: {
      googleUserId: string;
      randomValue: string;
      createdAt: number;
    };
    user?: {
      googleUserId: string;
      displayName: string;
      role: 'admin' | 'user';
      discordServer?: string;
      isDevLogin?: boolean;
    };
  }
}
