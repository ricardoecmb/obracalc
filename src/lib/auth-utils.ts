import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });

    if (!user) {
      return {
        id: session.user.id || "",
        name: session.user.name || "Usuário",
        email: session.user.email,
        image: session.user.image,
      };
    }

    return user;
  } catch (error) {
    console.error("Failed to retrieve current user:", error);
    try {
      const session = await auth();
      if (session?.user?.email) {
        return {
          id: session.user.id || "",
          name: session.user.name || "Usuário",
          email: session.user.email,
          image: session.user.image,
        };
      }
    } catch {
      // Ignore fallback error
    }
    return null;
  }
}
