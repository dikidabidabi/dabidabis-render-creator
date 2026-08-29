import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fallbackName, fetchProfileMap, signAvatar } from "@/lib/social.server";

export type NoteAuthorInfo = { id: string; name: string; avatar: string | null };

/** Nama + URL foto profil (signed) untuk penulis catatan presentasi. */
export const getNoteAuthors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(input ?? { ids: [] }),
  )
  .handler(async ({ data, context }): Promise<NoteAuthorInfo[]> => {
    if (data.ids.length === 0) return [];
    const profiles = await fetchProfileMap(context.supabase, data.ids);
    return Promise.all(
      data.ids.map(async (id) => {
        const p = profiles.get(id) ?? null;
        return {
          id,
          name: fallbackName(p, id),
          avatar: await signAvatar(context.supabase, p?.avatar_url ?? null),
        };
      }),
    );
  });
