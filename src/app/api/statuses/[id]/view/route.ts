import { and, eq, gt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { statusViews, statuses } from "@/db/schema";
import { errorResponse, requireAuthUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function getVisibleStatusId(statusId: number, userId: number) {
  const rows = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(
      and(
        eq(statuses.id, statusId),
        gt(statuses.expiresAt, new Date()),
        or(
          eq(statuses.userId, userId),
          eq(statuses.audience, "everyone"),
          and(
            eq(statuses.audience, "contacts"),
            sql`exists (
              select 1
              from conversation_members viewer_member
              join conversation_members owner_member
                on owner_member.conversation_id = viewer_member.conversation_id
              where viewer_member.user_id = ${userId}
                and owner_member.user_id = ${statuses.userId}
            )`,
          ),
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

function parseStatusId(id: string) {
  const statusId = Number(id);
  return Number.isSafeInteger(statusId) && statusId > 0 ? statusId : null;
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const me = await requireAuthUser();
    const { id } = await ctx.params;
    const statusId = parseStatusId(id);
    if (statusId === null) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const visibleStatus = await getVisibleStatusId(statusId, me.id);
    if (!visibleStatus) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (visibleStatus.id !== statusId) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const statusRows = await db
      .select({ userId: statuses.userId })
      .from(statuses)
      .where(eq(statuses.id, statusId))
      .limit(1);

    if (statusRows[0]?.userId !== me.id) {
      await db
        .insert(statusViews)
        .values({ statusId, viewerId: me.id })
        .onConflictDoNothing();
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const me = await requireAuthUser();
    const { id } = await ctx.params;
    const statusId = parseStatusId(id);
    if (statusId === null) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const visibleStatus = await getVisibleStatusId(statusId, me.id);
    if (!visibleStatus) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const rows = await db
      .select({ id: statusViews.id })
      .from(statusViews)
      .where(and(eq(statusViews.statusId, statusId), eq(statusViews.viewerId, me.id)))
      .limit(1);

    return NextResponse.json({ viewed: rows.length > 0 });
  } catch (error) {
    return errorResponse(error);
  }
}
