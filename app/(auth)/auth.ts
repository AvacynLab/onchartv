import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { resolveAuthSecret } from "@/lib/auth/secret";
import { resolveCredentialsUser } from "@/lib/auth/credentials-verify";
import {
  createGuestUser,
  createUser,
  getTestUserPlaintextPassword,
  getUser,
} from "@/lib/db/queries";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  // biome-ignore lint/nursery/useConsistentTypeDefinitions: "Required"
  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

const authSecret = resolveAuthSecret();

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  /**
   * Inject the resolved authentication secret so credentials-based sessions
   * stay stable across development, Playwright, and production deployments.
   */
  secret: authSecret,
  providers: [
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        const normalisedEmail =
          typeof email === "string" ? email.trim() : "";
        const candidatePassword =
          typeof password === "string" ? password : "";

        if (!normalisedEmail || !candidatePassword) {
          return null;
        }

        /**
         * Always pass the live query helpers so the credentials resolver reuses
         * the same in-memory store instance that the server actions populate
         * during Playwright runs. Without these overrides Turbopack can load a
         * fresh module graph for the NextAuth handler which previously caused
         * logins to fail because the newly imported queries module could not
         * see the user created during registration.
         */
        const resolvedUser = await resolveCredentialsUser(
          normalisedEmail,
          candidatePassword,
          {
            getUser,
            createUser,
            getTestUserPlaintextPassword,
          }
        );

        if (!resolvedUser?.id) {
          return null;
        }

        const safeEmail = resolvedUser.email ?? normalisedEmail;

        /**
         * Strip sensitive columns such as the hashed password before handing
         * the object back to NextAuth. Only the identifier, email and the
         * custom user type are required downstream during session enrichment.
         */
        return {
          id: resolvedUser.id,
          email: safeEmail,
          type: "regular" as const,
          name: safeEmail,
        };
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: "guest" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
