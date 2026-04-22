import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { createCapperSessionToken } from './lib/auth-session-token';
import { findAllowedCapper, parseAllowedCapperEmails } from './lib/auth-allowlist';

const allowedCappers = parseAllowedCapperEmails(process.env.ALLOWED_CAPPER_EMAILS);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ profile }) {
      const email = typeof profile?.email === 'string' ? profile.email : null;
      return findAllowedCapper(email, allowedCappers) !== null;
    },
    async jwt({ token, profile }) {
      const email = typeof profile?.email === 'string'
        ? profile.email
        : typeof token.email === 'string'
          ? token.email
          : null;
      const capper = findAllowedCapper(email, allowedCappers);

      if (capper) {
        token.capperId = capper.capperId;
        token.sub = capper.capperId;
        token.authToken = createCapperSessionToken(
          {
            sub: capper.capperId,
            capperId: capper.capperId,
            displayName: typeof token.name === 'string' && token.name ? token.name : capper.capperId,
            email: capper.email,
          },
          process.env.NEXTAUTH_SECRET ?? '',
        );
      }

      return token;
    },
    async session({ session, token }) {
      if (typeof token.capperId === 'string') {
        session.capperId = token.capperId;
        session.user = {
          ...session.user,
          capperId: token.capperId,
        };
      }
      if (typeof token.authToken === 'string') {
        session.authToken = token.authToken;
      }
      return session;
    },
  },
});
