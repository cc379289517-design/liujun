import { WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY } from "@/lib/workbenchBackground";
import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

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

export async function GET(request: NextRequest) {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: WORKBENCH_PAGE_BACKGROUND_CONFIG_KEY },
      select: { value: true, updatedAt: true },
    });
    if (!config) {
      return new Response(null, { status: 404 });
    }
    const value = config.value.trim();
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

    const etag = `"${config.updatedAt.getTime()}-${image.body.byteLength}"`;
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
    console.error("[GET /api/config/background]", error);
    return new Response(null, { status: 500 });
  }
}
