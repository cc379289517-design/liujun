import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

function dataUrlToResponseParts(value: string): { body: Uint8Array; contentType: string } | null {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return {
      body: new Uint8Array(Buffer.from(match[2], "base64")),
      contentType: match[1],
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { avatar: true, updatedAt: true },
    });

    if (!profile) {
      return new Response(null, { status: 404 });
    }

    const value = profile.avatar?.trim();
    if (!value) {
      return new Response(null, { status: 404 });
    }

    if (/^https?:\/\//.test(value) || value.startsWith("/")) {
      return Response.redirect(new URL(value, request.url), 307);
    }

    const image = dataUrlToResponseParts(value);
    if (!image) {
      return new Response(null, { status: 404 });
    }

    const etag = `"profile-avatar-${id}-${profile.updatedAt.getTime()}-${image.body.byteLength}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          ETag: etag,
        },
      });
    }

    const responseBody = image.body.buffer.slice(
      image.body.byteOffset,
      image.body.byteOffset + image.body.byteLength,
    ) as ArrayBuffer;
    return new Response(responseBody, {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Length": String(image.body.byteLength),
        "Content-Type": image.contentType,
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("[GET /api/profiles/[id]/avatar]", error);
    return new Response(null, { status: 500 });
  }
}
