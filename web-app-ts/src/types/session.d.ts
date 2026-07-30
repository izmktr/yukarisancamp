import 'express-session';

declare module 'express-session' {
  interface SessionData {
    editingArticle?: any;
    user?: {
      googleUserId: string;
      displayName: string;
      role: 'admin' | 'user';
      discordServer?: string;
    };
  }
}
