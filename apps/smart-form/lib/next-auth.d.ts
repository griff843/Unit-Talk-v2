declare module 'next-auth' {
  interface DefaultSession {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    expires: string;
  }

  interface Session {
    capperId?: string;
    authToken?: string;
    user?: DefaultSession['user'] & {
      capperId?: string;
    };
  }

  interface AuthConfig {
    secret?: string;
    providers?: unknown[];
    pages?: {
      signIn?: string;
    };
    callbacks?: {
      signIn?: (params: { profile?: { email?: unknown } | null }) => boolean | Promise<boolean>;
      jwt?: (params: {
        token: import('next-auth/jwt').JWT;
        profile?: { email?: unknown } | null;
      }) => import('next-auth/jwt').JWT | Promise<import('next-auth/jwt').JWT>;
      session?: (params: {
        session: Session;
        token: import('next-auth/jwt').JWT;
      }) => Session | Promise<Session>;
    };
  }

  export default function NextAuth(config: AuthConfig): {
    handlers: {
      GET: unknown;
      POST: unknown;
    };
    auth: unknown;
    signIn: unknown;
    signOut: unknown;
  };
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string;
    name?: string | null;
    email?: string | null;
    capperId?: string;
    authToken?: string;
  }
}

declare module 'next-auth/react' {
  import type { Session } from 'next-auth';

  export function SessionProvider(props: {
    children: import('react').ReactNode;
  }): import('react').ReactElement;

  export function signIn(
    provider?: string,
    options?: { callbackUrl?: string; redirectTo?: string },
  ): Promise<unknown>;

  export function useSession(): {
    data: Session | null;
    status: 'authenticated' | 'loading' | 'unauthenticated';
  };

  export function getSession(): Promise<Session | null>;
}

declare module 'next-auth/providers/google' {
  export default function Google(config: {
    clientId?: string;
    clientSecret?: string;
  }): unknown;
}
