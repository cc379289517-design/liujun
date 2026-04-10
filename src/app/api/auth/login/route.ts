import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { employeeId, password } = await req.json();

  if (!employeeId || !password) {
    return NextResponse.json({ error: "请输入工号和密码" }, { status: 400 });
  }

  const profile = await prisma.profile.findUnique({
    where: { employeeId },
    include: { building: true },
  });

  if (!profile) {
    return NextResponse.json({ error: "工号不存在" }, { status: 401 });
  }

  if (profile.password !== password) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  const { password: _, ...user } = profile;
  return NextResponse.json(user);
}
