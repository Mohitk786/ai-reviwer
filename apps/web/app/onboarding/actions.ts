'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getEnv } from '@repo/shared';
import { getContainer } from '@/server/container';
import { getSession } from '@/server/session';

async function requireSessionUserId(): Promise<string> {
  const env = getEnv();
  const session = await getSession(env.SESSION_SECRET);
  if (!session) redirect('/');
  return session.userId;
}

const enableSchema = z.object({
  installationId: z.string().min(1),
  githubId: z.coerce.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().min(1),
});

const disableSchema = z.object({
  repositoryId: z.string().min(1),
});

export async function enableRepoAction(formData: FormData): Promise<void> {
  const userId = await requireSessionUserId();
  const input = enableSchema.parse(Object.fromEntries(formData));
  const c = await getContainer();

  await c.repositories.enable({ userId, ...input });

  revalidatePath('/onboarding');
}

export async function disableRepoAction(formData: FormData): Promise<void> {
  const userId = await requireSessionUserId();
  const { repositoryId } = disableSchema.parse(Object.fromEntries(formData));
  const c = await getContainer();

  await c.repositories.disable({ userId, repositoryId });

  revalidatePath('/onboarding');
}
