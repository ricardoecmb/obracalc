import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Custom error thrown when an unauthenticated request is made to a protected resource.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Não autorizado: faça login para continuar.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Validates the current session and returns the authenticated user's ID.
 * Throws UnauthorizedError if no valid session exists.
 *
 * @returns The authenticated user's ID
 * @throws {UnauthorizedError} If the session is invalid or missing
 */
export async function requireAuth(): Promise<string> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new UnauthorizedError("Sessão expirada ou não autenticada.");
  }

  return session.user.id;
}

/**
 * Retrieves the currently authenticated user from the database, including
 * user preferences and professional profile.
 * Throws UnauthorizedError if unauthenticated or if the user is not found.
 *
 * @returns The user record with preferences and professional profile (without passwordHash)
 * @throws {UnauthorizedError} If unauthenticated or user not found
 */
export async function getCurrentUser() {
  const userId = await requireAuth();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      preferences: true,
      professionalProfile: true,
    },
  });

  if (!user) {
    throw new UnauthorizedError("Usuário não encontrado.");
  }

  // Omit the password hash from the returned object for security
  const { passwordHash: _, ...safeUser } = user;
  return safeUser;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Hashes a plaintext password using bcrypt with 12 salt rounds.
 *
 * @param password - The plaintext password to hash
 * @returns A promise resolving to the bcrypt hash string
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Compares a plaintext password against a bcrypt hash.
 *
 * @param password - The plaintext password to test
 * @param hash - The bcrypt hash to verify against
 * @returns A promise resolving to true if matching, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
