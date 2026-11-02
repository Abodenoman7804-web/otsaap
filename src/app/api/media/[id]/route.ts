import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers, media, messages, statuses } from "@/db/schema";
import { getAuthUser } from "@/lib/session";
import { readMediaFile } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Serve media only to its owner, members of conversations that reference it,
 * or viewers authorized by an active status that references it.
 */
export async function GET(request: Request, ctx: Ctx) {
  const me = await getAuthUser();
  if (!me) return new Response("unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const row = rows[0];
  if (!row) return new Response("not found", { status: 404 });

  let allowed = row.ownerId === me.id;

  if (!allowed) {
    const messageRows = await db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.mediaId, id));
    const conversationIds = [...new Set(messageRows.map((message) => message.conversationId))];

    if (conversationIds.length > 0) {
      const membershipRows = await db
        .select({ id: conversationMembers.id })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.userId, me.id),
            inArray(conversationMembers.conversationId, conversationIds),
          ),
        )
        .limit(1);
      allowed = membershipRows.length > 0;
    }
  }

  if (!allowed) {
    const activeStatusRows = await db
      .select({ userId: statuses.userId, audience: statuses.audience })
      .from(statuses)
      .where(and(eq(statuses.mediaId, id), gt(statuses.expiresAt, new Date())));

    for (const status of activeStatusRows) {
      if (status.userId === me.id || status.audience === "everyone") {
        allowed = true;
        break;
      }

      if (status.audience === "contacts") {
        const myMemberships = await db
          .select({ conversationId: conversationMembers.conversationId })
          .from(conversationMembers)
          .where(eq(conversationMembers.userId, me.id));
        const myConversationIds = myMemberships.map((membership) => membership.conversationId);

        if (myConversationIds.length === 0) continue;

        const sharedMembership = await db
          .select({ id: conversationMembers.id })
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.userId, status.userId),
              inArray(conversationMembers.conversationId, myConversationIds),
            ),
          )
          .limit(1);
        if (sharedMembership.length > 0) {
          allowed = true;
          break;
        }
      }
    }
  }

  if (!allowed) return new Response("forbidden", { status: 403 });

  const bytes = await readMediaFile(id);
  if (!bytes) return new Response("not found", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const safeName = row.fileName.replace(/["\\\r\n]/g, "_");
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
    },
  });
}
